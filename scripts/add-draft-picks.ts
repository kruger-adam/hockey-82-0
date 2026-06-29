/**
 * Fetches 2026 NHL Draft picks (rounds 1-2) and adds them to current-rosters.json.
 * Top 10 picks get hand-researched ratings; the rest use a draft-position formula.
 *
 * Run: npx tsx scripts/add-draft-picks.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const API = "https://api-web.nhle.com/v1";

// Hand-researched ratings for top 10 picks based on scouting consensus.
// Calibrated to EA NHL scale (~79 = elite rookie, ~70 = solid first-rounder).
const TOP_10_RATINGS: Record<number, number> = {
  1:  79, // Gavin McKenna — generational LW, Penn State/WHL superstar
  2:  75, // Ivar Stenberg — elite Swedish league LW, high compete
  3:  74, // Caleb Malhotra — dominant OHL center, two-way
  4:  73, // Daxon Rudolph — shutdown WHL D, pro-ready frame
  5:  72, // Alberts Smits — elite skating D from DEL, Latvian
  6:  71, // Carson Carels — offensive WHL D with great shot
  7:  71, // Chase Reid — mobile OHL D, strong defensive instincts
  8:  70, // Viggo Bjorck — crafty Swedish center, high IQ
  9:  70, // Keaton Verhoeff — powerful NCAA D, North Dakota
  10: 69, // Wyatt Cullen — skilled NTDP LW, USA U-18 standout
};

// Formula for picks 11+: degrades gradually by pick number within each round
function draftRating(overallPick: number, round: number): number {
  if (round === 1) {
    // Picks 11-32: 68 down to 65
    return Math.max(65, Math.round(69 - (overallPick - 10) * 0.18));
  }
  if (round === 2) {
    // 62 down to 59
    return Math.max(59, Math.round(63 - (overallPick - 33) * 0.13));
  }
  return 57; // shouldn't reach here
}

// Normalize position codes from NHL API ("L"→"LW", "R"→"RW")
function normalizePos(code: string): string {
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return code; // C, D, G
}

async function fetchRound(year: number, round: number) {
  const res = await fetch(`${API}/draft/picks/${year}/${round}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Draft round ${round} → ${res.status}`);
  const d = await res.json();
  return d.picks as Array<Record<string, unknown>>;
}

async function main() {
  const rosterPath = join(process.cwd(), "src/lib/current-rosters.json");
  const rosters: Array<Record<string, unknown>> = JSON.parse(readFileSync(rosterPath, "utf8"));

  // Build team map
  const teamMap = new Map<string, Array<Record<string, unknown>>>();
  for (const team of rosters) {
    teamMap.set(team.abbrev as string, team.players as Array<Record<string, unknown>>);
  }

  let added = 0;
  let skipped = 0;

  for (const round of [1, 2]) {
    console.log(`\nFetching 2026 draft round ${round}...`);
    const picks = await fetchRound(2026, round);

    for (const pick of picks) {
      const overall = pick.overallPick as number;
      const abbrev = pick.teamAbbrev as string;
      const firstName = (pick.firstName as Record<string, string>)?.default ?? "";
      const lastName = (pick.lastName as Record<string, string>)?.default ?? "";
      if (!firstName && !lastName) { skipped++; continue; }
      const name = `${firstName} ${lastName}`.trim();
      const pos = normalizePos(pick.positionCode as string);
      const rating = overall <= 10 ? TOP_10_RATINGS[overall] : draftRating(overall, round);

      const players = teamMap.get(abbrev);
      if (!players) {
        console.log(`  No team found for ${abbrev}, skipping ${name}`);
        skipped++;
        continue;
      }

      // Don't add if already on roster (e.g. player signed and already in NHL API data)
      const alreadyOnRoster = players.some(
        (p) => (p.name as string).toLowerCase() === name.toLowerCase()
      );
      if (alreadyOnRoster) {
        console.log(`  ${name} already on ${abbrev} roster, skipping`);
        skipped++;
        continue;
      }

      players.push({
        id: -(overall), // negative ID = draft pick
        name,
        position: pos,
        gamesPlayed: 0,
        isDraftPick: true,
        draftYear: 2026,
        draftRound: round,
        draftPick: overall,
        amateurLeague: pick.amateurLeague,
        rating,
      });

      console.log(`  R${round} #${overall} ${name} (${pos}, ${pick.amateurLeague}) → ${abbrev} @ ${rating}`);
      added++;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  writeFileSync(rosterPath, JSON.stringify(rosters, null, 2));
  console.log(`\nAdded ${added} draft picks, skipped ${skipped}`);
  console.log(`Wrote ${rosterPath}`);
}

main().catch(console.error);
