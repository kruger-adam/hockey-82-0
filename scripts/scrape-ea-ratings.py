#!/usr/bin/env python3
"""
Scrapes NHL 26 EA ratings from nhlratings.net for all 32 teams
and merges them into src/lib/current-rosters.json.
Replaces our computed ratings with EA's official OVR values.
"""

import json, re, time, urllib.request, sys
from pathlib import Path

TEAM_SLUGS = {
    "ANA": "anaheim-ducks",
    "BOS": "boston-bruins",
    "BUF": "buffalo-sabres",
    "CGY": "calgary-flames",
    "CAR": "carolina-hurricanes",
    "CHI": "chicago-blackhawks",
    "COL": "colorado-avalanche",
    "CBJ": "columbus-blue-jackets",
    "DAL": "dallas-stars",
    "DET": "detroit-red-wings",
    "EDM": "edmonton-oilers",
    "FLA": "florida-panthers",
    "LAK": "los-angeles-kings",
    "MIN": "minnesota-wild",
    "MTL": "montreal-canadiens",
    "NSH": "nashville-predators",
    "NJD": "new-jersey-devils",
    "NYI": "new-york-islanders",
    "NYR": "new-york-rangers",
    "OTT": "ottawa-senators",
    "PHI": "philadelphia-flyers",
    "PIT": "pittsburgh-penguins",
    "SJS": "san-jose-sharks",
    "SEA": "seattle-kraken",
    "STL": "st-louis-blues",
    "TBL": "tampa-bay-lightning",
    "TOR": "toronto-maple-leafs",
    "UTA": "utah-hockey-club",
    "VAN": "vancouver-canucks",
    "VGK": "vegas-golden-knights",
    "WSH": "washington-capitals",
    "WPG": "winnipeg-jets",
}

POS_MAP = {"L": "LW", "R": "RW", "C": "C", "D": "D", "G": "G"}

def fetch_team(slug: str) -> list[dict]:
    url = f"https://www.nhlratings.net/teams/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode("utf-8", errors="ignore")

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
    players = []
    for row in rows:
        text = re.sub(r"<[^>]+>", " ", row).strip()
        text = re.sub(r"\s+", " ", text)
        # Pattern: "1. Firstname Lastname POS | #NUM Team OVR POT"
        # or       "1. Firstname Lastname POS | Team OVR POT" (no jersey #)
        m = re.match(r"\d+\.\s+(.+?)\s+(C|L|R|D|G)\s+\|[^|]*?\s+(\d+)\s+(?:High|Med|Low)", text)
        if m:
            name = m.group(1).strip()
            pos = POS_MAP.get(m.group(2), m.group(2))
            ovr = int(m.group(3))
            players.append({"name": name, "position": pos, "eaRating": ovr})
    return players

def normalize(name: str) -> str:
    """Lowercase, strip accents roughly, for fuzzy matching."""
    name = name.lower().strip()
    replacements = {"é": "e", "è": "e", "ê": "e", "ë": "e",
                    "á": "a", "à": "a", "ä": "a", "â": "a",
                    "ó": "o", "ö": "o", "ô": "o",
                    "ú": "u", "ü": "u", "û": "u",
                    "í": "i", "î": "i", "ï": "i",
                    "ñ": "n", "ç": "c", "ø": "o", "å": "a",
                    "š": "s", "ž": "z", "č": "c",}
    for k, v in replacements.items():
        name = name.replace(k, v)
    return name

def last_name(name: str) -> str:
    parts = normalize(name).split()
    return parts[-1] if parts else ""

def match_player(ea_name: str, roster_players: list[dict]) -> dict | None:
    ea_norm = normalize(ea_name)
    ea_last = last_name(ea_name)

    # Exact match
    for p in roster_players:
        if normalize(p["name"]) == ea_norm:
            return p

    # Last name + first initial
    ea_parts = ea_norm.split()
    if len(ea_parts) >= 2:
        ea_init = ea_parts[0][0]
        for p in roster_players:
            p_parts = normalize(p["name"]).split()
            if len(p_parts) >= 2 and p_parts[-1] == ea_last and p_parts[0][0] == ea_init:
                return p

    # Last name only (risky but last resort)
    matches = [p for p in roster_players if last_name(p["name"]) == ea_last]
    if len(matches) == 1:
        return matches[0]

    return None

def main():
    root = Path(__file__).parent.parent
    roster_path = root / "src/lib/current-rosters.json"
    rosters = json.loads(roster_path.read_text())

    total_matched = 0
    total_ea = 0
    total_unmatched_ea = 0
    total_unmatched_roster = 0

    for team in rosters:
        abbrev = team["abbrev"]
        slug = TEAM_SLUGS.get(abbrev)
        if not slug:
            print(f"  {abbrev}: no slug mapping, skipping")
            continue

        sys.stdout.write(f"Scraping {abbrev}... ")
        sys.stdout.flush()

        try:
            ea_players = fetch_team(slug)
        except Exception as e:
            print(f"FAILED: {e}")
            continue

        roster_players = team["players"]
        matched = 0
        unmatched_ea = []

        for ea in ea_players:
            total_ea += 1
            p = match_player(ea["name"], roster_players)
            if p:
                p["rating"] = ea["eaRating"]
                matched += 1
                total_matched += 1
            else:
                unmatched_ea.append(ea["name"])
                total_unmatched_ea += 1

        # Players in our roster with no EA match (keep computed rating)
        ea_names_norm = {normalize(e["name"]) for e in ea_players}
        unmatched_roster = [p["name"] for p in roster_players
                            if normalize(p["name"]) not in ea_names_norm
                            and last_name(p["name"]) not in {last_name(e["name"]) for e in ea_players}]
        total_unmatched_roster += len(unmatched_roster)

        print(f"{matched}/{len(ea_players)} matched", end="")
        if unmatched_ea:
            print(f" | EA-only: {', '.join(unmatched_ea[:3])}", end="")
        if unmatched_roster:
            print(f" | roster-only: {', '.join(unmatched_roster[:2])}", end="")
        print()

        # Also add EA-only players (players EA has that aren't in our NHL roster fetch)
        ea_names_set = {normalize(e["name"]) for e in ea_players}
        for ea in ea_players:
            if not match_player(ea["name"], roster_players):
                # Add as new player
                roster_players.append({
                    "id": -1,
                    "name": ea["name"],
                    "position": ea["position"],
                    "gamesPlayed": 0,
                    "rating": ea["eaRating"],
                })

        time.sleep(0.3)

    # Second pass: cross-team lookup for traded players still using computed ratings.
    # Build global map of normalized-name → EA rating from all players we collected.
    global_ea: dict[str, int] = {}
    global_ea_last: dict[str, list[tuple[str, int]]] = {}
    for team in rosters:
        for p in team["players"]:
            if "eaRating" in p or p.get("gamesPlayed", 1) == 0:
                # Only index players whose rating came from EA (heuristic: gamesPlayed==0 means EA-added)
                pass
        for p in team["players"]:
            norm = normalize(p["name"])
            last = last_name(p["name"])
            # We track all players regardless; we'll use the highest rating seen
            # (since a player on two teams means they were traded, prefer EA's current team rating)
            if norm not in global_ea or p["rating"] > global_ea[norm]:
                global_ea[norm] = p["rating"]
            if last not in global_ea_last:
                global_ea_last[last] = []
            global_ea_last[last].append((norm, p["rating"]))

    cross_fixed = 0
    for team in rosters:
        for p in team["players"]:
            # If this player appears twice in the data (once with EA rating, once with computed),
            # find their best rating from any team
            norm = normalize(p["name"])
            last = last_name(p["name"])
            if norm in global_ea and global_ea[norm] > p["rating"]:
                p["rating"] = global_ea[norm]
                cross_fixed += 1

    roster_path.write_text(json.dumps(rosters, indent=2))
    print(f"\nDone. EA matched: {total_matched}/{total_ea} | "
          f"EA-only added: {total_unmatched_ea} | "
          f"roster-only (kept computed): {total_unmatched_roster} | "
          f"cross-team fixed: {cross_fixed}")
    print(f"Wrote {roster_path}")

if __name__ == "__main__":
    main()
