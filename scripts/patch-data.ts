/**
 * Patches player-data.json:
 * 1. Renames "Utah Hockey Club" → "Phoenix/Arizona Coyotes" for 2000s and 2010s
 * 2. Fetches missing Calgary Flames 2020s and New Jersey Devils 2020s data
 *
 * Run with: npx tsx scripts/patch-data.ts
 */

import * as fs from "fs";
import * as path from "path";
import { SEASON_GPG, NEUTRAL_GPG, MIN_TOTAL_GP_SKATER, MIN_TOTAL_GP_GOALIE, DECADES } from "./fetch-players";

const DATA_PATH = path.join(process.cwd(), "src/lib/player-data.json");

// ── Helpers (duplicated from fetch-players to keep this script self-contained) ──

function seasonString(year: number): string {
  return `${year}${year + 1}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchSeasonStats(tricode: string, year: number): Promise<any | null> {
  const url = `https://api-web.nhle.com/v1/club-stats/${tricode}/${seasonString(year)}/2`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(2000 * Math.pow(2, attempt)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

function nhlPositionToOurs(code: string): string[] {
  switch (code) {
    case "C": return ["C"];
    case "L": return ["LW"];
    case "R": return ["RW"];
    case "D": return ["D"];
    default:  return ["C"];
  }
}

interface AccSkater {
  name: string; position: string[];
  totalGoals: number; totalAssists: number; totalPlusMinus: number; totalGP: number;
  bestGoals: number; bestAssists: number; bestPlusMinus: number; bestGP: number; bestYear: number; bestScore: number;
}
interface AccGoalie {
  name: string; weightedSvPct: number; weightedGaa: number; totalGP: number;
  bestSvPct: number; bestGaa: number; bestGP: number; bestYear: number;
}

function accumulateSeason(stats: any, skaterMap: Map<number, AccSkater>, goalieMap: Map<number, AccGoalie>, year: number) {
  for (const s of stats.skaters ?? []) {
    if (s.gamesPlayed < 1) continue;
    const name = `${s.firstName.default} ${s.lastName.default}`;
    if (!skaterMap.has(s.playerId)) {
      skaterMap.set(s.playerId, { name, position: nhlPositionToOurs(s.positionCode),
        totalGoals: 0, totalAssists: 0, totalPlusMinus: 0, totalGP: 0,
        bestGoals: 0, bestAssists: 0, bestPlusMinus: 0, bestGP: 0, bestYear: year, bestScore: -1 });
    }
    const acc = skaterMap.get(s.playerId)!;
    acc.totalGoals     += s.goals;
    acc.totalAssists   += s.assists;
    acc.totalPlusMinus += s.plusMinus;
    acc.totalGP        += s.gamesPlayed;
    const score = 3 * s.goals + 2 * s.assists;
    if (score > acc.bestScore) {
      acc.bestScore = score; acc.bestGoals = s.goals; acc.bestAssists = s.assists;
      acc.bestPlusMinus = s.plusMinus; acc.bestGP = s.gamesPlayed; acc.bestYear = year;
    }
  }
  for (const g of stats.goalies ?? []) {
    if (g.gamesPlayed < 1 || !g.savePercentage) continue;
    const name = `${g.firstName.default} ${g.lastName.default}`;
    if (!goalieMap.has(g.playerId)) {
      goalieMap.set(g.playerId, { name, weightedSvPct: 0, weightedGaa: 0, totalGP: 0,
        bestSvPct: 0, bestGaa: 0, bestGP: 0, bestYear: year });
    }
    const acc = goalieMap.get(g.playerId)!;
    acc.weightedSvPct += g.savePercentage * g.gamesPlayed;
    acc.weightedGaa   += (g.goalsAgainstAverage ?? 0) * g.gamesPlayed;
    acc.totalGP       += g.gamesPlayed;
    if (g.savePercentage > acc.bestSvPct) {
      acc.bestSvPct = g.savePercentage; acc.bestGaa = g.goalsAgainstAverage ?? 0;
      acc.bestGP = g.gamesPlayed; acc.bestYear = g.gamesPlayed;
    }
  }
}

function buildPlayers(skaterMap: Map<number, AccSkater>, goalieMap: Map<number, AccGoalie>, displayName: string, decade: string) {
  const players: any[] = [];
  for (const acc of skaterMap.values()) {
    if (acc.totalGP < MIN_TOTAL_GP_SKATER) continue;
    players.push({
      name: acc.name, position: acc.position, team: displayName, decade,
      goals:     Math.round((acc.totalGoals     / acc.totalGP) * 82),
      assists:   Math.round((acc.totalAssists   / acc.totalGP) * 82),
      plusMinus: Math.round((acc.totalPlusMinus / acc.totalGP) * 82),
      bestGoals: acc.bestScore >= 0 ? acc.bestGoals : undefined,
      bestAssists: acc.bestScore >= 0 ? acc.bestAssists : undefined,
      bestPlusMinus: acc.bestScore >= 0 ? acc.bestPlusMinus : undefined,
      bestGP: acc.bestScore >= 0 ? acc.bestGP : undefined,
      bestYear: acc.bestScore >= 0 ? acc.bestYear : undefined,
      rating: 0,
    });
  }
  for (const acc of goalieMap.values()) {
    if (acc.totalGP < MIN_TOTAL_GP_GOALIE) continue;
    players.push({
      name: acc.name, position: ["G"], team: displayName, decade,
      savePercentage: Math.round((acc.weightedSvPct / acc.totalGP) * 1000) / 1000,
      gaa: Math.round((acc.weightedGaa / acc.totalGP) * 100) / 100,
      bestSavePercentage: acc.bestSvPct > 0 ? Math.round(acc.bestSvPct * 1000) / 1000 : undefined,
      bestGaa: acc.bestSvPct > 0 ? Math.round(acc.bestGaa * 100) / 100 : undefined,
      bestGP: acc.bestSvPct > 0 ? acc.bestGP : undefined,
      bestYear: acc.bestSvPct > 0 ? acc.bestYear : undefined,
      rating: 0,
    });
  }
  return players;
}

async function fetchTeamDecade(tricode: string, displayName: string, decade: string) {
  const years = DECADES[decade];
  const skaterMap = new Map<number, AccSkater>();
  const goalieMap = new Map<number, AccGoalie>();
  let fetched = 0;
  for (const year of years) {
    const stats = await fetchSeasonStats(tricode, year);
    if (stats) { accumulateSeason(stats, skaterMap, goalieMap, year); fetched++; }
    process.stdout.write(`\r  ${displayName} ${decade}: fetched ${fetched} seasons (year ${year})   `);
  }
  console.log();
  return buildPlayers(skaterMap, goalieMap, displayName, decade);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

  // 1. Rename Utah Hockey Club → Phoenix/Arizona Coyotes for 2000s and 2010s
  console.log("\n1. Renaming Utah Hockey Club entries...");
  for (const decade of ["2000s", "2010s"]) {
    if (data[decade]["Utah Hockey Club"]) {
      const players = data[decade]["Utah Hockey Club"].map((p: any) => ({ ...p, team: "Phoenix/Arizona Coyotes" }));
      data[decade]["Phoenix/Arizona Coyotes"] = players;
      delete data[decade]["Utah Hockey Club"];
      console.log(`   ${decade}: renamed ${players.length} players`);
    }
  }

  // 2. Fetch Calgary Flames 2020s
  console.log("\n2. Fetching Calgary Flames 2020s (CGY)...");
  const calgaryPlayers = await fetchTeamDecade("CGY", "Calgary Flames", "2020s");
  if (calgaryPlayers.length > 0) {
    data["2020s"]["Calgary Flames"] = calgaryPlayers;
    console.log(`   Added ${calgaryPlayers.length} players`);
  } else {
    console.log("   ⚠ No players returned");
  }

  // 3. Fetch New Jersey Devils 2020s
  console.log("\n3. Fetching New Jersey Devils 2020s (NJD)...");
  const njPlayers = await fetchTeamDecade("NJD", "New Jersey Devils", "2020s");
  if (njPlayers.length > 0) {
    data["2020s"]["New Jersey Devils"] = njPlayers;
    console.log(`   Added ${njPlayers.length} players`);
  } else {
    console.log("   ⚠ No players returned");
  }

  // Write output
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  const totalPlayers = Object.values(data).flatMap(Object.values as any).flat().length;
  const totalCombos = Object.values(data).flatMap(Object.keys as any).length;
  console.log(`\n✓ Written to ${DATA_PATH}`);
  console.log(`  ${totalPlayers} players across ${totalCombos} team-decade combos`);
}

main().catch(console.error);
