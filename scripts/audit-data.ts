/**
 * Audits player-data.json against the expected team-decade combos
 * defined in fetch-players.ts. Reports missing combos and thin combos.
 *
 * Run with: npx tsx scripts/audit-data.ts
 */

import * as fs from "fs";
import * as path from "path";
import { TEAMS, DECADES, TRICODE_BY_ERA } from "./fetch-players";

const OUT_PATH = path.join(process.cwd(), "src/lib/player-data.json");
const data = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));

const MIN_PLAYERS = 5; // flag combos with suspiciously few players

type Issue = { type: "missing" | "thin"; decade: string; team: string; count?: number };
const issues: Issue[] = [];

const expected: { decade: string; team: string }[] = [];

for (const [decadeName] of Object.entries(DECADES)) {
  for (const [defaultTricode, displayName] of Object.entries(TEAMS)) {
    const eraOverrides = TRICODE_BY_ERA[displayName];
    if (eraOverrides && !(decadeName in eraOverrides)) continue;
    expected.push({ decade: decadeName, team: displayName });
  }
}

for (const { decade, team } of expected) {
  const players: any[] | undefined = data[decade]?.[team];
  if (!players) {
    issues.push({ type: "missing", decade, team });
  } else if (players.length < MIN_PLAYERS) {
    issues.push({ type: "thin", decade, team, count: players.length });
  }
}

// Summary
console.log(`\n=== player-data.json audit ===`);
console.log(`Expected combos : ${expected.length}`);
const present = expected.filter(({ decade, team }) => data[decade]?.[team]).length;
console.log(`Present         : ${present}`);
console.log(`Missing         : ${issues.filter(i => i.type === "missing").length}`);
console.log(`Thin (<${MIN_PLAYERS} players): ${issues.filter(i => i.type === "thin").length}`);

const missing = issues.filter(i => i.type === "missing");
if (missing.length > 0) {
  console.log(`\n── Missing team-decade combos ──`);
  for (const { decade, team } of missing) {
    console.log(`  ✗ ${decade}  ${team}`);
  }
}

const thin = issues.filter(i => i.type === "thin");
if (thin.length > 0) {
  console.log(`\n── Thin combos (< ${MIN_PLAYERS} players) ──`);
  for (const { decade, team, count } of thin) {
    console.log(`  ⚠ ${decade}  ${team}  (${count} players)`);
  }
}

// Per-decade breakdown
console.log(`\n── Per-decade team counts ──`);
for (const decade of Object.keys(DECADES)) {
  const teams = data[decade] ? Object.keys(data[decade]) : [];
  const exp = expected.filter(e => e.decade === decade).length;
  const playerCount = teams.reduce((sum, t) => sum + (data[decade][t]?.length ?? 0), 0);
  const flag = teams.length < exp ? " ⚠" : " ✓";
  console.log(`  ${decade}: ${teams.length}/${exp} teams, ${playerCount} total players${flag}`);
}

if (issues.length === 0) {
  console.log(`\n✓ All expected combos present and populated.`);
} else {
  console.log(`\n${issues.length} issue(s) found. Re-run fetch-players.ts to fill gaps.`);
}
