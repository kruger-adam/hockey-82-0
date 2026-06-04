/**
 * Fetches player stats from the NHL API for each team-decade combo,
 * aggregates across seasons, and writes src/lib/player-data.json.
 *
 * Run with: npx tsx scripts/fetch-players.ts
 *
 * Rate-limiting: 1 req/sec to be polite to the NHL API.
 */

import * as fs from "fs";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

export const DECADES: Record<string, number[]> = {
  "1960s": [1960, 1961, 1962, 1963, 1964, 1965, 1966, 1967, 1968, 1969],
  "1970s": [1970, 1971, 1972, 1973, 1974, 1975, 1976, 1977, 1978, 1979],
  "1980s": [1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989],
  "1990s": [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999],
  "2000s": [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009],
  "2010s": [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019],
};

// All franchises to include. Key = the canonical tricode used for API calls
// when no era override applies. Value = display name shown in the game.
//
// Current 32 NHL teams + notable defunct/relocated franchises with rich histories.
export const TEAMS: Record<string, string> = {
  // ── Original Six ──────────────────────────────────────────────
  BOS: "Boston Bruins",
  CHI: "Chicago Blackhawks",
  DET: "Detroit Red Wings",
  MTL: "Montreal Canadiens",
  NYR: "New York Rangers",
  TOR: "Toronto Maple Leafs",

  // ── Current franchises (32 teams as of 2024-25) ───────────────
  ANA: "Anaheim Ducks",
  BUF: "Buffalo Sabres",
  CAR: "Carolina Hurricanes",
  CBJ: "Columbus Blue Jackets",
  CGY: "Calgary Flames",
  COL: "Colorado Avalanche",
  DAL: "Dallas Stars",
  EDM: "Edmonton Oilers",
  FLA: "Florida Panthers",
  LAK: "Los Angeles Kings",
  MIN: "Minnesota Wild",
  NJD: "New Jersey Devils",
  NSH: "Nashville Predators",
  NYI: "New York Islanders",
  OTT: "Ottawa Senators",
  PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins",
  SEA: "Seattle Kraken",
  SJS: "San Jose Sharks",
  STL: "St. Louis Blues",
  TBL: "Tampa Bay Lightning",
  UTA: "Utah Hockey Club",
  VAN: "Vancouver Canucks",
  VGK: "Vegas Golden Knights",
  WPG: "Winnipeg Jets",
  WSH: "Washington Capitals",

  // ── Defunct / relocated (kept as separate historical entries) ──
  ATF: "Atlanta Flames",       // → Calgary Flames 1980
  ATL: "Atlanta Thrashers",    // → Winnipeg Jets 2011
  HFD: "Hartford Whalers",     // → Carolina Hurricanes 1997
  MNS: "Minnesota North Stars",// → Dallas Stars 1993
  QUE: "Quebec Nordiques",     // → Colorado Avalanche 1995
  WPO: "Winnipeg Jets (Orig)", // original Jets 1979-96 → Phoenix Coyotes
};

// Per-decade tricode overrides: some current franchises existed under a
// different tricode (or didn't exist yet). Omitting a decade means the
// franchise didn't exist / has no data for that era.
export const TRICODE_BY_ERA: Record<string, Partial<Record<string, string>>> = {
  // Carolina Hurricanes only existed from 1997-98 onward — no override needed,
  // the default CAR tricode naturally returns empty for pre-1997 seasons.
  // Hartford Whalers (separate entry below) covers the HFD era.
  // "Carolina Hurricanes": {},

  // Dallas Stars only from 1993-94 onward — Minnesota North Stars entry covers earlier.
  // DAL returns empty for 1993 and prior seasons naturally.
  // "Dallas Stars": {},

  // Colorado Avalanche only from 1995-96 onward — Quebec Nordiques entry covers earlier.
  // "Colorado Avalanche": {},

  // New Jersey Devils were Kansas City Scouts (1974-76) → Colorado Rockies (1976-82) → NJD
  "New Jersey Devils": { "1970s": "CLR", "1980s": "NJD", "1990s": "NJD", "2000s": "NJD", "2010s": "NJD" },

  // Calgary Flames were Atlanta Flames through 1979-80
  "Calgary Flames": { "1970s": "ATF", "1980s": "CGY", "1990s": "CGY", "2000s": "CGY", "2010s": "CGY" },

  // Winnipeg Jets (current) were Atlanta Thrashers through 2010-11
  "Winnipeg Jets": { "2000s": "ATL", "2010s": "WPG" },

  // Utah Hockey Club were Arizona Coyotes (2014-24) / Phoenix Coyotes (1996-2014)
  // Original Winnipeg Jets → Phoenix 1996. For historical data use WPO for old Jets.
  "Utah Hockey Club": { "2010s": "ARI", "2000s": "PHX" },

  // Original Winnipeg Jets only existed 1979-96 (use separate WPO entry)
  "Winnipeg Jets (Orig)": { "1980s": "WPG", "1990s": "WPG" },

  // Atlanta Flames only existed 1972-80
  "Atlanta Flames": { "1970s": "ATF" },

  // Atlanta Thrashers only existed 1999-2011
  "Atlanta Thrashers": { "2000s": "ATL" },

  // Hartford Whalers only existed 1979-97
  "Hartford Whalers": { "1980s": "HFD", "1990s": "HFD" },

  // Minnesota North Stars only existed 1967-93
  "Minnesota North Stars": { "1970s": "MNS", "1980s": "MNS", "1990s": "MNS" },

  // Quebec Nordiques only existed 1972-95
  "Quebec Nordiques": { "1970s": "QUE", "1980s": "QUE", "1990s": "QUE" },

  // Newer expansions — don't try decades before they existed
  "Anaheim Ducks":      { "1990s": "ANA", "2000s": "ANA", "2010s": "ANA" },
  "Columbus Blue Jackets": { "2000s": "CBJ", "2010s": "CBJ" },
  "Florida Panthers":   { "1990s": "FLA", "2000s": "FLA", "2010s": "FLA" },
  "Minnesota Wild":     { "2000s": "MIN", "2010s": "MIN" },
  "Nashville Predators":{ "1990s": "NSH", "2000s": "NSH", "2010s": "NSH" },
  "Ottawa Senators":    { "1990s": "OTT", "2000s": "OTT", "2010s": "OTT" },
  "San Jose Sharks":    { "1990s": "SJS", "2000s": "SJS", "2010s": "SJS" },
  "Seattle Kraken":     { "2010s": "SEA" },
  "Tampa Bay Lightning":{ "1990s": "TBL", "2000s": "TBL", "2010s": "TBL" },
  "Vegas Golden Knights":{ "2010s": "VGK" },
};

// Minimum total GP with the franchise that decade to be included at all.
// Keeps out cup-of-coffee callups while weighted averaging handles partial seasons.
export const MIN_TOTAL_GP_SKATER = 10;
export const MIN_TOTAL_GP_GOALIE = 10;

// Era adjustment: neutral baseline and goals-per-game by season start year.
// Scores are adjusted so a player's points reflect what they'd produce in a
// neutral ~6.0 GPG environment. Source: NHL historical records.
export const NEUTRAL_GPG = 6.0;
export const SEASON_GPG: Record<number, number> = {
  1960: 5.8, 1961: 5.8, 1962: 5.8, 1963: 5.9, 1964: 5.9,
  1965: 6.3, 1966: 6.2, 1967: 5.7, 1968: 5.9, 1969: 5.7,
  1970: 6.2, 1971: 6.2, 1972: 6.6, 1973: 6.6, 1974: 6.9,
  1975: 7.0, 1976: 6.5, 1977: 6.5, 1978: 7.1, 1979: 7.2,
  1980: 7.7, 1981: 8.0, 1982: 7.9, 1983: 7.9, 1984: 7.8,
  1985: 8.0, 1986: 7.5, 1987: 7.5, 1988: 7.4, 1989: 7.3,
  1990: 7.3, 1991: 7.0, 1992: 7.3, 1993: 6.4, 1994: 6.5,
  1995: 6.4, 1996: 6.2, 1997: 5.9, 1998: 5.9, 1999: 5.9,
  2000: 5.6, 2001: 5.4, 2002: 5.2, 2003: 5.1, 2004: 5.1,
  2005: 6.2, 2006: 5.9, 2007: 5.7, 2008: 5.9, 2009: 5.6,
  2010: 5.7, 2011: 5.5, 2012: 5.6, 2013: 5.5, 2014: 5.3,
  2015: 5.5, 2016: 5.8, 2017: 5.9, 2018: 6.0, 2019: 6.1,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface NHLSkaterRow {
  playerId: number;
  firstName: { default: string };
  lastName: { default: string };
  positionCode: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  plusMinus: number;
}

interface NHLGoalieRow {
  playerId: number;
  firstName: { default: string };
  lastName: { default: string };
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  goalsAgainstAverage?: number;
  savePercentage?: number;
}

interface NHLSeasonStats {
  skaters: NHLSkaterRow[];
  goalies: NHLGoalieRow[];
}

// Decade-average accumulator for skaters
interface AccSkater {
  name: string;
  position: string[];
  totalGoals: number;
  totalAssists: number;
  totalPlusMinus: number;
  totalGP: number;
  // Best single season tracking
  bestGoals: number;
  bestAssists: number;
  bestPlusMinus: number;
  bestGP: number;
  bestYear: number;
  bestEraAdjPts: number; // comparison key only
}

// Weighted average accumulator for goalies (weighted by games played)
interface AccGoalie {
  name: string;
  weightedSvPct: number; // sum(svPct * gp)
  weightedGaa: number;   // sum(gaa * gp)
  totalGP: number;
  // Best single season tracking (by SV%)
  bestSvPct: number;
  bestGaa: number;
  bestGP: number;
  bestYear: number;
}

// Output format — stats are per-82-game pace; rating computed dynamically in players.ts
export interface PlayerData {
  name: string;
  position: string[];
  team: string;
  decade: string;
  // Decade average (per 82 games)
  goals?: number;
  assists?: number;
  plusMinus?: number;
  savePercentage?: number;
  gaa?: number;
  // Best single season (actual totals)
  bestGoals?: number;
  bestAssists?: number;
  bestPlusMinus?: number;
  bestGP?: number;
  bestYear?: number;
  bestSavePercentage?: number;
  bestGaa?: number;
  rating: number;       // placeholder — overridden by players.ts at runtime
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function seasonString(year: number): string {
  return `${year}${year + 1}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Global semaphore — caps total in-flight requests across all concurrent work. */
class Semaphore {
  private slots: number;
  private queue: (() => void)[] = [];
  constructor(slots: number) { this.slots = slots; }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    if (this.queue.length > 0) this.queue.shift()!();
    else this.slots++;
  }
}

const MAX_CONCURRENT = 15;
const sem = new Semaphore(MAX_CONCURRENT);

async function fetchSeasonStats(tricode: string, year: number, retries = 2): Promise<NHLSeasonStats | null> {
  const url = `https://api-web.nhle.com/v1/club-stats/${tricode}/${seasonString(year)}/2`;
  await sem.acquire();
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        if (!res.ok) return null;
        return await res.json() as NHLSeasonStats;
      } catch {
        if (attempt < retries) await sleep(300);
      }
    }
    return null;
  } finally {
    sem.release();
  }
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

// ── Progress ──────────────────────────────────────────────────────────────────

function renderProgress(done: number, total: number, current: string, startMs: number) {
  const pct = done / total;
  const elapsed = (Date.now() - startMs) / 1000;
  const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
  const barWidth = 28;
  const filled = Math.round(pct * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const etaStr = eta > 0 ? `ETA ${Math.ceil(eta)}s` : "…";
  const line = `[${bar}] ${done}/${total} (${Math.round(pct * 100)}%) | ${etaStr} | ${current.slice(0, 36)}`;
  process.stdout.write(`\r${line.padEnd(90)}`);
}

// ── Accumulation ──────────────────────────────────────────────────────────────

const MIN_GP_BEST_SKATER = 20; // min games in a season to qualify as "best season"
const MIN_GP_BEST_GOALIE = 20;

function accumulateSeason(
  stats: NHLSeasonStats,
  skaterMap: Map<number, AccSkater>,
  goalieMap: Map<number, AccGoalie>,
  year: number
) {
  const gpg = SEASON_GPG[year] ?? NEUTRAL_GPG;
  const eraFactor = NEUTRAL_GPG / gpg;

  for (const s of stats.skaters) {
    if (s.gamesPlayed < 1) continue;
    const name = `${s.firstName.default} ${s.lastName.default}`;
    const pos = nhlPositionToOurs(s.positionCode);
    if (!skaterMap.has(s.playerId)) {
      skaterMap.set(s.playerId, {
        name, position: pos,
        totalGoals: 0, totalAssists: 0, totalPlusMinus: 0, totalGP: 0,
        bestGoals: 0, bestAssists: 0, bestPlusMinus: 0, bestGP: 0, bestYear: year, bestEraAdjPts: -1,
      });
    }
    const acc = skaterMap.get(s.playerId)!;
    acc.totalGoals     += s.goals;
    acc.totalAssists   += s.assists;
    acc.totalPlusMinus += s.plusMinus;
    acc.totalGP        += s.gamesPlayed;

    if (s.gamesPlayed >= MIN_GP_BEST_SKATER) {
      const eraAdjPts = (s.goals + s.assists) * eraFactor;
      if (eraAdjPts > acc.bestEraAdjPts) {
        acc.bestEraAdjPts  = eraAdjPts;
        acc.bestGoals      = s.goals;
        acc.bestAssists    = s.assists;
        acc.bestPlusMinus  = s.plusMinus;
        acc.bestGP         = s.gamesPlayed;
        acc.bestYear       = year;
      }
    }
  }

  for (const g of stats.goalies) {
    if (g.gamesPlayed < 1 || !g.savePercentage) continue;
    const name = `${g.firstName.default} ${g.lastName.default}`;
    if (!goalieMap.has(g.playerId)) {
      goalieMap.set(g.playerId, {
        name, weightedSvPct: 0, weightedGaa: 0, totalGP: 0,
        bestSvPct: 0, bestGaa: 0, bestGP: 0, bestYear: year,
      });
    }
    const acc = goalieMap.get(g.playerId)!;
    acc.weightedSvPct += g.savePercentage * g.gamesPlayed;
    acc.weightedGaa   += (g.goalsAgainstAverage ?? 0) * g.gamesPlayed;
    acc.totalGP       += g.gamesPlayed;

    if (g.gamesPlayed >= MIN_GP_BEST_GOALIE && g.savePercentage > acc.bestSvPct) {
      acc.bestSvPct = g.savePercentage;
      acc.bestGaa   = g.goalsAgainstAverage ?? 0;
      acc.bestGP    = g.gamesPlayed;
      acc.bestYear  = year;
    }
  }
}

function buildPlayers(
  skaterMap: Map<number, AccSkater>,
  goalieMap: Map<number, AccGoalie>,
  displayName: string,
  decade: string
): PlayerData[] {
  const players: PlayerData[] = [];

  for (const acc of Array.from(skaterMap.values())) {
    if (acc.totalGP < MIN_TOTAL_GP_SKATER) continue;
    players.push({
      name: acc.name,
      position: acc.position,
      team: displayName,
      decade,
      goals:     Math.round((acc.totalGoals     / acc.totalGP) * 82),
      assists:   Math.round((acc.totalAssists   / acc.totalGP) * 82),
      plusMinus: Math.round((acc.totalPlusMinus / acc.totalGP) * 82),
      bestGoals:     acc.bestEraAdjPts >= 0 ? acc.bestGoals     : undefined,
      bestAssists:   acc.bestEraAdjPts >= 0 ? acc.bestAssists   : undefined,
      bestPlusMinus: acc.bestEraAdjPts >= 0 ? acc.bestPlusMinus : undefined,
      bestGP:        acc.bestEraAdjPts >= 0 ? acc.bestGP        : undefined,
      bestYear:      acc.bestEraAdjPts >= 0 ? acc.bestYear      : undefined,
      rating: 0,
    });
  }

  for (const acc of Array.from(goalieMap.values())) {
    if (acc.totalGP < MIN_TOTAL_GP_GOALIE) continue;
    const svPct = acc.weightedSvPct / acc.totalGP;
    const gaa   = acc.weightedGaa   / acc.totalGP;
    players.push({
      name: acc.name,
      position: ["G"],
      team: displayName,
      decade,
      savePercentage: Math.round(svPct * 1000) / 1000,
      gaa:            Math.round(gaa   * 100)  / 100,
      bestSavePercentage: acc.bestSvPct > 0 ? Math.round(acc.bestSvPct * 1000) / 1000 : undefined,
      bestGaa:            acc.bestSvPct > 0 ? Math.round(acc.bestGaa   * 100)  / 100  : undefined,
      bestGP:             acc.bestSvPct > 0 ? acc.bestGP   : undefined,
      bestYear:           acc.bestSvPct > 0 ? acc.bestYear : undefined,
      rating: 0,
    });
  }

  return players;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const teamEntries = Object.entries(TEAMS);

  // Flatten to individual (tricode, team, decade, year) fetch requests
  type FetchRequest = { tricode: string; displayName: string; decade: string; year: number };
  const requests: FetchRequest[] = [];

  for (const [decadeName, years] of Object.entries(DECADES)) {
    for (const [defaultTricode, displayName] of teamEntries) {
      const eraOverrides = TRICODE_BY_ERA[displayName];
      if (eraOverrides && !(decadeName in eraOverrides)) continue;
      const tricode = eraOverrides?.[decadeName] ?? defaultTricode;
      for (const year of years) {
        requests.push({ tricode, displayName, decade: decadeName, year });
      }
    }
  }

  const total = requests.length;
  const progressPath = path.join(process.cwd(), "scrape-progress.json");
  console.log(`\nFetching ${total} season requests across ${total / 10} team-decade combos`);
  console.log(`Concurrency: ${MAX_CONCURRENT} | Writing progress to scrape-progress.json\n`);

  const start = Date.now();
  let done = 0;

  // Group results: key = "decade|displayName"
  const grouped = new Map<string, { displayName: string; decade: string; skaterMap: Map<number, AccSkater>; goalieMap: Map<number, AccGoalie> }>();

  // Fire all requests concurrently through the semaphore
  await Promise.all(requests.map(async (req) => {
    const stats = await fetchSeasonStats(req.tricode, req.year);
    done++;

    const key = `${req.decade}|${req.displayName}`;
    if (!grouped.has(key)) {
      grouped.set(key, { displayName: req.displayName, decade: req.decade, skaterMap: new Map(), goalieMap: new Map() });
    }
    if (stats) accumulateSeason(stats, grouped.get(key)!.skaterMap, grouped.get(key)!.goalieMap, req.year);

    const label = `${req.decade} ${req.displayName}`;
    renderProgress(done, total, label, start);

    // Write progress file every 20 requests
    if (done % 20 === 0 || done === total) {
      const elapsed = (Date.now() - start) / 1000;
      const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
      fs.writeFileSync(progressPath, JSON.stringify({
        done, total, pct: Math.round(done / total * 100),
        elapsedSec: Math.round(elapsed), etaSec: Math.round(eta),
        current: label,
      }));
    }
  }));

  console.log(`\n\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // Assemble output
  const output: Record<string, Record<string, PlayerData[]>> = {};
  for (const { displayName, decade, skaterMap, goalieMap } of Array.from(grouped.values())) {
    const players = buildPlayers(skaterMap, goalieMap, displayName, decade);
    if (players.length === 0) continue;
    output[decade] ??= {};
    output[decade][displayName] = players;
  }

  const outPath = path.join(process.cwd(), "src/lib/player-data.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  fs.unlinkSync(progressPath); // clean up

  const totalPlayers = Object.values(output).flatMap(Object.values).flat().length;
  console.log(`✓ Written to ${outPath}`);
  console.log(`  ${totalPlayers} players across ${Object.values(output).flatMap(Object.keys).length} team-decade combos`);
}

// Only run when executed directly, not when imported
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch(console.error);
}
