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

    # Phase 1: scrape all EA ratings into a global map BEFORE touching roster data.
    # This lets us do cross-team lookups (e.g. Woll traded to PHI but EA still lists him on TOR).
    global_ea: dict[str, int] = {}  # normalized name → EA OVR

    for abbrev, slug in TEAM_SLUGS.items():
        sys.stdout.write(f"Scraping {abbrev}... ")
        sys.stdout.flush()
        try:
            ea_players = fetch_team(slug)
            for ea in ea_players:
                norm = normalize(ea["name"])
                # Keep highest rating seen across all teams (handles duplicate listings)
                if norm not in global_ea or ea["eaRating"] > global_ea[norm]:
                    global_ea[norm] = ea["eaRating"]
            print(f"{len(ea_players)} players")
        except Exception as e:
            print(f"FAILED: {e}")
        time.sleep(0.3)

    print(f"\nGlobal EA map: {len(global_ea)} unique players\n")

    # Phase 2: apply EA ratings to NHL API rosters.
    for team in rosters:
        roster_players = team["players"]
        matched = 0
        unmatched_roster = []

        for p in roster_players:
            norm = normalize(p["name"])
            if norm in global_ea:
                p["rating"] = global_ea[norm]
                matched += 1
                total_matched += 1
            else:
                # Try last-name-only as fallback
                last = last_name(p["name"])
                last_matches = [(k, v) for k, v in global_ea.items() if k.split()[-1] == last]
                if len(last_matches) == 1:
                    p["rating"] = last_matches[0][1]
                    matched += 1
                    total_matched += 1
                else:
                    unmatched_roster.append(p["name"])
                    total_unmatched_roster += 1

        total_ea += len(roster_players)
        print(f"{team['abbrev']}: {matched}/{len(roster_players)} matched EA ratings", end="")
        if unmatched_roster:
            print(f" | kept computed: {', '.join(unmatched_roster[:3])}", end="")
        print()

    roster_path.write_text(json.dumps(rosters, indent=2))
    print(f"\nDone. EA matched: {total_matched}/{total_ea} roster slots | "
          f"kept computed: {total_unmatched_roster}")
    print(f"Wrote {roster_path}")

if __name__ == "__main__":
    main()
