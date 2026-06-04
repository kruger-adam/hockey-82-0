/**
 * Fetches only the team-decade combos missing from player-data.json
 * and merges them in. Lower concurrency (5) to avoid rate limiting.
 *
 * Run with: npx tsx scripts/patch-missing.ts
 */

import * as fs from "fs";
import * as path from "path";
import { TEAMS, DECADES, TRICODE_BY_ERA, SEASON_GPG, NEUTRAL_GPG, MIN_TOTAL_GP_SKATER, MIN_TOTAL_GP_GOALIE } from "./fetch-players";

const OUT_PATH = path.join(process.cwd(), "src/lib/player-data.json");
const existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));

// Find missing team-decade combos
const missing: { tricode: string; displayName: string; decade: string; years: number[] }[] = [];

for (const [decadeName, years] of Object.entries(DECADES)) {
  for (const [defaultTricode, displayName] of Object.entries(TEAMS)) {
    const eraOverrides = TRICODE_BY_ERA[displayName];
    if (eraOverrides && !(decadeName in eraOverrides)) continue;
    const tricode = eraOverrides?.[decadeName] ?? defaultTricode;
    if (!existing[decadeName]?.[displayName]) {
      missing.push({ tricode, displayName, decade: decadeName, years });
    }
  }
}

console.log(`\nFound ${missing.length} missing team-decade combos. Fetching with concurrency=5...\n`);

// ── Helpers (duplicated from fetch-players.ts) ────────────────────────────────

const MIN_GP_BEST_SKATER = 20;
const MIN_GP_BEST_GOALIE = 20;

class Semaphore {
  private slots: number;
  private queue: (() => void)[] = [];
  constructor(slots: number) { this.slots = slots; }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise(r => this.queue.push(r));
  }
  release() {
    if (this.queue.length > 0) this.queue.shift()!();
    else this.slots++;
  }
}

let sem = new Semaphore(8);

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function seasonString(year: number) { return `${year}${year + 1}`; }

async function fetchSeason(tricode: string, year: number, maxRetries = 5, initialBackoffMs = 2000) {
  const url = `https://api-web.nhle.com/v1/club-stats/${tricode}/${seasonString(year)}/2`;
  await sem.acquire();
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          await sleep(initialBackoffMs * Math.pow(2, attempt));
          continue;
        }
        if (!res.ok) return null;
        return await res.json() as any;
      } catch {
        if (attempt < maxRetries) await sleep(500 * (attempt + 1));
      }
    }
    return null;
  } finally {
    sem.release();
  }
}

function nhlPos(code: string): string[] {
  switch (code) {
    case "C": return ["C"]; case "L": return ["LW"];
    case "R": return ["RW"]; case "D": return ["D"]; default: return ["C"];
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

let done = 0;
const total = missing.length;

const failedYears: { tricode: string; displayName: string; decade: string; year: number }[] = [];

async function fetchCombo(entry: typeof missing[0]) {
  const { tricode, displayName, decade, years } = entry;

  const skaterMap = new Map<number, any>();
  const goalieMap = new Map<number, any>();

  await Promise.all(years.map(async (year) => {
    const stats = await fetchSeason(tricode, year);
    if (!stats) {
      failedYears.push({ tricode, displayName, decade, year });
      return;
    }

    const gpg = SEASON_GPG[year] ?? NEUTRAL_GPG;
    const eraFactor = NEUTRAL_GPG / gpg;

    for (const s of stats.skaters ?? []) {
      if (s.gamesPlayed < 1) continue;
      const name = `${s.firstName.default} ${s.lastName.default}`;
      if (!skaterMap.has(s.playerId)) {
        skaterMap.set(s.playerId, {
          name, position: nhlPos(s.positionCode),
          totalGoals: 0, totalAssists: 0, totalPlusMinus: 0, totalGP: 0,
          bestGoals: 0, bestAssists: 0, bestPlusMinus: 0, bestGP: 0, bestYear: year, bestEraAdjPts: -1,
        });
      }
      const acc = skaterMap.get(s.playerId)!;
      acc.totalGoals += s.goals; acc.totalAssists += s.assists;
      acc.totalPlusMinus += s.plusMinus; acc.totalGP += s.gamesPlayed;
      if (s.gamesPlayed >= MIN_GP_BEST_SKATER) {
        const eraAdj = (s.goals + s.assists) * eraFactor;
        if (eraAdj > acc.bestEraAdjPts) {
          acc.bestEraAdjPts = eraAdj; acc.bestGoals = s.goals;
          acc.bestAssists = s.assists; acc.bestPlusMinus = s.plusMinus;
          acc.bestGP = s.gamesPlayed; acc.bestYear = year;
        }
      }
    }

    for (const g of stats.goalies ?? []) {
      if (g.gamesPlayed < 1 || !g.savePercentage) continue;
      const name = `${g.firstName.default} ${g.lastName.default}`;
      if (!goalieMap.has(g.playerId)) {
        goalieMap.set(g.playerId, { name, weightedSvPct: 0, weightedGaa: 0, totalGP: 0, bestSvPct: 0, bestGaa: 0, bestGP: 0, bestYear: year });
      }
      const acc = goalieMap.get(g.playerId)!;
      acc.weightedSvPct += g.savePercentage * g.gamesPlayed;
      acc.weightedGaa += (g.goalsAgainstAverage ?? 0) * g.gamesPlayed;
      acc.totalGP += g.gamesPlayed;
      if (g.gamesPlayed >= MIN_GP_BEST_GOALIE && g.savePercentage > acc.bestSvPct) {
        acc.bestSvPct = g.savePercentage; acc.bestGaa = g.goalsAgainstAverage ?? 0;
        acc.bestGP = g.gamesPlayed; acc.bestYear = year;
      }
    }
  }));

  const players: any[] = [];

  for (const acc of skaterMap.values()) {
    if (acc.totalGP < MIN_TOTAL_GP_SKATER) continue;
    players.push({
      name: acc.name, position: acc.position, team: displayName, decade,
      goals:     Math.round((acc.totalGoals / acc.totalGP) * 82),
      assists:   Math.round((acc.totalAssists / acc.totalGP) * 82),
      plusMinus: Math.round((acc.totalPlusMinus / acc.totalGP) * 82),
      bestGoals:     acc.bestEraAdjPts >= 0 ? acc.bestGoals     : undefined,
      bestAssists:   acc.bestEraAdjPts >= 0 ? acc.bestAssists   : undefined,
      bestPlusMinus: acc.bestEraAdjPts >= 0 ? acc.bestPlusMinus : undefined,
      bestGP:        acc.bestEraAdjPts >= 0 ? acc.bestGP        : undefined,
      bestYear:      acc.bestEraAdjPts >= 0 ? acc.bestYear      : undefined,
      rating: 0,
    });
  }

  for (const acc of goalieMap.values()) {
    if (acc.totalGP < MIN_TOTAL_GP_GOALIE) continue;
    players.push({
      name: acc.name, position: ["G"], team: displayName, decade,
      savePercentage: Math.round(acc.weightedSvPct / acc.totalGP * 1000) / 1000,
      gaa:            Math.round(acc.weightedGaa   / acc.totalGP * 100)  / 100,
      bestSavePercentage: acc.bestSvPct > 0 ? Math.round(acc.bestSvPct * 1000) / 1000 : undefined,
      bestGaa:            acc.bestSvPct > 0 ? Math.round(acc.bestGaa   * 100)  / 100  : undefined,
      bestGP:             acc.bestSvPct > 0 ? acc.bestGP   : undefined,
      bestYear:           acc.bestSvPct > 0 ? acc.bestYear : undefined,
      rating: 0,
    });
  }

  done++;
  process.stdout.write(`\r[${done}/${total}] ${decade} ${displayName.padEnd(30)}`);
  return { decade, displayName, players };
}

async function main() {
  const results = await Promise.all(missing.map(fetchCombo));

  for (const { decade, displayName, players } of results) {
    if (players.length === 0) continue;
    existing[decade] ??= {};
    existing[decade][displayName] = players;
  }

  if (failedYears.length > 0) {
    console.log(`\n⚠ ${failedYears.length} individual year-requests failed after all retries (those seasons may have incomplete player data):`);
    for (const f of failedYears) {
      console.log(`  ${f.decade} ${f.displayName} (${f.tricode}) ${f.year}-${f.year + 1}`);
    }
    console.log(`\nRun: npx tsx scripts/fetch-players.ts  for a full clean rescrape if you need complete data.`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
  const added = results.filter(r => r.players.length > 0).length;
  console.log(`\nDone. Added ${added} team-decade combos.`);
}

main().catch(console.error);
