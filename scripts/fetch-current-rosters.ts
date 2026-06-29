/**
 * Fetches current NHL rosters + season stats from the NHL public API
 * and outputs src/lib/current-rosters.json.
 *
 * Run: npx tsx scripts/fetch-current-rosters.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";

const API = "https://api-web.nhle.com/v1";

// 32 current NHL teams with division/conference info and primary color for UI
const TEAMS = [
  // Atlantic
  { abbrev: "BOS", name: "Boston Bruins",           conf: "Eastern", div: "Atlantic",     color: "#FFB81C" },
  { abbrev: "BUF", name: "Buffalo Sabres",           conf: "Eastern", div: "Atlantic",     color: "#003087" },
  { abbrev: "DET", name: "Detroit Red Wings",        conf: "Eastern", div: "Atlantic",     color: "#CE1126" },
  { abbrev: "FLA", name: "Florida Panthers",         conf: "Eastern", div: "Atlantic",     color: "#041E42" },
  { abbrev: "MTL", name: "Montreal Canadiens",       conf: "Eastern", div: "Atlantic",     color: "#AF1E2D" },
  { abbrev: "OTT", name: "Ottawa Senators",          conf: "Eastern", div: "Atlantic",     color: "#E31837" },
  { abbrev: "TBL", name: "Tampa Bay Lightning",      conf: "Eastern", div: "Atlantic",     color: "#002868" },
  { abbrev: "TOR", name: "Toronto Maple Leafs",      conf: "Eastern", div: "Atlantic",     color: "#00205B" },
  // Metropolitan
  { abbrev: "CAR", name: "Carolina Hurricanes",      conf: "Eastern", div: "Metropolitan", color: "#CC0000" },
  { abbrev: "CBJ", name: "Columbus Blue Jackets",    conf: "Eastern", div: "Metropolitan", color: "#002654" },
  { abbrev: "NJD", name: "New Jersey Devils",        conf: "Eastern", div: "Metropolitan", color: "#CE1126" },
  { abbrev: "NYI", name: "New York Islanders",       conf: "Eastern", div: "Metropolitan", color: "#F47D30" },
  { abbrev: "NYR", name: "New York Rangers",         conf: "Eastern", div: "Metropolitan", color: "#0038A8" },
  { abbrev: "PHI", name: "Philadelphia Flyers",      conf: "Eastern", div: "Metropolitan", color: "#F74902" },
  { abbrev: "PIT", name: "Pittsburgh Penguins",      conf: "Eastern", div: "Metropolitan", color: "#FCB514" },
  { abbrev: "WSH", name: "Washington Capitals",      conf: "Eastern", div: "Metropolitan", color: "#041E42" },
  // Central
  { abbrev: "CHI", name: "Chicago Blackhawks",       conf: "Western", div: "Central",      color: "#CF0A2C" },
  { abbrev: "COL", name: "Colorado Avalanche",       conf: "Western", div: "Central",      color: "#6F263D" },
  { abbrev: "DAL", name: "Dallas Stars",             conf: "Western", div: "Central",      color: "#006847" },
  { abbrev: "MIN", name: "Minnesota Wild",           conf: "Western", div: "Central",      color: "#154734" },
  { abbrev: "NSH", name: "Nashville Predators",      conf: "Western", div: "Central",      color: "#FFB81C" },
  { abbrev: "STL", name: "St. Louis Blues",          conf: "Western", div: "Central",      color: "#002F87" },
  { abbrev: "UTA", name: "Utah Hockey Club",         conf: "Western", div: "Central",      color: "#6CACE4" },
  { abbrev: "WPG", name: "Winnipeg Jets",            conf: "Western", div: "Central",      color: "#041E42" },
  // Pacific
  { abbrev: "ANA", name: "Anaheim Ducks",            conf: "Western", div: "Pacific",      color: "#F47A38" },
  { abbrev: "CGY", name: "Calgary Flames",           conf: "Western", div: "Pacific",      color: "#C8102E" },
  { abbrev: "EDM", name: "Edmonton Oilers",          conf: "Western", div: "Pacific",      color: "#FF4C00" },
  { abbrev: "LAK", name: "Los Angeles Kings",        conf: "Western", div: "Pacific",      color: "#111111" },
  { abbrev: "SJS", name: "San Jose Sharks",          conf: "Western", div: "Pacific",      color: "#006D75" },
  { abbrev: "SEA", name: "Seattle Kraken",           conf: "Western", div: "Pacific",      color: "#001628" },
  { abbrev: "VAN", name: "Vancouver Canucks",        conf: "Western", div: "Pacific",      color: "#00205B" },
  { abbrev: "VGK", name: "Vegas Golden Knights",     conf: "Western", div: "Pacific",      color: "#B4975A" },
];

// Rating formula matching src/lib/players.ts (2020s decade)
const NEUTRAL_GPG = 6.0;
const ERA_FACTOR = NEUTRAL_GPG / 6.2; // 2020s decade GPG

function skaterRating(goals82: number, assists82: number, plusMinus82: number, isD: boolean): number {
  const pts = goals82 + assists82;
  const eraAdj = pts * ERA_FACTOR;
  const posMult = isD ? 1.6 : 1.0;
  const score = eraAdj * posMult + plusMinus82 * 0.2;
  return Math.round(Math.min(100, Math.max(20, 35 + (score / 120) * 65)));
}

function goalieRating(savePct: number, gaa: number): number {
  const avgSv = 0.906;
  const refGaa = 2.9;
  const svMult = 2000;
  const score = 65 + (savePct - avgSv) * svMult + (refGaa - gaa) * 6;
  return Math.round(Math.min(100, Math.max(30, score)));
}

function per82(stat: number, gp: number): number {
  if (gp < 1) return 0;
  return Math.round((stat / gp) * 82 * 10) / 10;
}

async function get(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function fetchTeam(team: typeof TEAMS[0]) {
  const [roster, stats] = await Promise.all([
    get(`/roster/${team.abbrev}/current`),
    get(`/club-stats/${team.abbrev}/now`),
  ]);

  // Build stats map by player ID
  const statsMap = new Map<number, Record<string, number>>();
  for (const s of [...stats.skaters, ...stats.goalies]) {
    statsMap.set(s.playerId, s);
  }

  const players: PlayerRecord[] = [];

  // Forwards
  for (const p of roster.forwards ?? []) {
    const s = statsMap.get(p.id) ?? {};
    // Use full season GP (gamesPlayed from stats) but fall back to 1 only if truly missing
    // This avoids inflating per-82 for players traded mid-season with few games on this team
    const gp = Math.max(s.gamesPlayed ?? 0, 1);
    const g82 = per82(s.goals ?? 0, gp);
    const a82 = per82(s.assists ?? 0, gp);
    const pm82 = per82(s.plusMinus ?? 0, gp);
    // Normalize NHL API position codes: L→LW, R→RW
    const rawPos = (p.positionCode ?? "C") as string;
    const pos: "C" | "LW" | "RW" = rawPos === "L" ? "LW" : rawPos === "R" ? "RW" : "C";
    players.push({
      id: p.id,
      name: `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim(),
      position: pos,
      gamesPlayed: gp,
      goals82: g82,
      assists82: a82,
      plusMinus82: pm82,
      rating: skaterRating(g82, a82, pm82, false),
    });
  }

  // Defensemen
  for (const p of roster.defensemen ?? []) {
    const s = statsMap.get(p.id) ?? {};
    const gp = s.gamesPlayed ?? 1;
    const g82 = per82(s.goals ?? 0, gp);
    const a82 = per82(s.assists ?? 0, gp);
    const pm82 = per82(s.plusMinus ?? 0, gp);
    players.push({
      id: p.id,
      name: `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim(),
      position: "D" as const,
      gamesPlayed: gp,
      goals82: g82,
      assists82: a82,
      plusMinus82: pm82,
      rating: skaterRating(g82, a82, pm82, true),
    });
  }

  // Goalies
  for (const p of roster.goalies ?? []) {
    const s = statsMap.get(p.id) ?? {};
    const gp = s.gamesPlayed ?? 1;
    const sv = s.savePercentage ?? 0.906;
    const gaa = s.goalsAgainstAverage ?? 2.9;
    players.push({
      id: p.id,
      name: `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim(),
      position: "G" as const,
      gamesPlayed: gp,
      savePercentage: sv,
      goalsAgainstAverage: gaa,
      rating: goalieRating(sv, gaa),
    });
  }

  return players;
}

export interface PlayerRecord {
  id: number;
  name: string;
  position: "C" | "LW" | "RW" | "D" | "G";
  gamesPlayed: number;
  goals82?: number;
  assists82?: number;
  plusMinus82?: number;
  savePercentage?: number;
  goalsAgainstAverage?: number;
  rating: number;
}

export interface TeamRoster {
  abbrev: string;
  name: string;
  conf: string;
  div: string;
  color: string;
  players: PlayerRecord[];
}

async function main() {
  const rosters: TeamRoster[] = [];

  for (const team of TEAMS) {
    process.stdout.write(`Fetching ${team.abbrev}... `);
    try {
      const players = await fetchTeam(team);
      rosters.push({ ...team, players });
      console.log(`${players.length} players`);
    } catch (e) {
      console.error(`FAILED: ${e}`);
      rosters.push({ ...team, players: [] });
    }
    // Small delay to be polite to the API
    await new Promise(r => setTimeout(r, 150));
  }

  const out = join(process.cwd(), "src/lib/current-rosters.json");
  writeFileSync(out, JSON.stringify(rosters, null, 2));
  console.log(`\nWrote ${out}`);
}

main().catch(console.error);
