import type { PlayerRecord, TeamRoster } from "../../scripts/fetch-current-rosters";
import rostersData from "./current-rosters.json";

export type { PlayerRecord, TeamRoster };

export const ALL_TEAMS: TeamRoster[] = rostersData as TeamRoster[];

// Best lineup for simulation: pick best C, LW, RW, 2 D, best G
export function getTeamStrength(players: PlayerRecord[]): number {
  const pick = (pos: string[], n: number) =>
    [...players]
      .filter(p => pos.includes(p.position))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, n);

  const lineup = [
    ...pick(["C"], 1),
    ...pick(["LW"], 1),
    ...pick(["RW"], 1),
    ...pick(["D"], 2),
    ...pick(["G"], 1),
  ];

  if (lineup.length < 3) return 50;
  return lineup.reduce((s, p) => s + p.rating, 0) / lineup.length;
}

export interface StandingsRow {
  abbrev: string;
  name: string;
  conf: string;
  div: string;
  color: string;
  w: number;
  l: number;
  otl: number;
  pts: number;
  gp: number;
  strength: number;
}

function winProb(a: number, b: number): number {
  return 1 / (1 + Math.exp(-(a - b) * 0.12));
}

export function simulateLeagueSeason(
  teams: TeamRoster[],
  userAbbrev: string,
  userPlayers: PlayerRecord[]
): StandingsRow[] {
  const strengths: Record<string, number> = {};
  for (const t of teams) {
    const players = t.abbrev === userAbbrev ? userPlayers : t.players;
    strengths[t.abbrev] = getTeamStrength(players);
  }

  const rows: Record<string, StandingsRow> = {};
  for (const t of teams) {
    rows[t.abbrev] = { abbrev: t.abbrev, name: t.name, conf: t.conf, div: t.div, color: t.color, w: 0, l: 0, otl: 0, pts: 0, gp: 0, strength: strengths[t.abbrev] };
  }

  const abbrevs = teams.map(t => t.abbrev);
  for (let i = 0; i < abbrevs.length; i++) {
    for (let j = i + 1; j < abbrevs.length; j++) {
      const a = abbrevs[i], b = abbrevs[j];
      // Play 2-3 times (avg ~2.6 → 82 games across 31 opponents ≈ 2.65 games each)
      const numGames = Math.random() < 0.6 ? 3 : 2;
      for (let g = 0; g < numGames; g++) {
        const wp = winProb(strengths[a], strengths[b]);
        const close = Math.abs(strengths[a] - strengths[b]) < 8;
        const goesToOT = close && Math.random() < 0.28;
        if (goesToOT) {
          // OT: still influenced by rating but tighter
          const otWp = 0.5 + (wp - 0.5) * 0.4;
          if (Math.random() < otWp) {
            rows[a].w++; rows[a].pts += 2; rows[b].otl++; rows[b].pts += 1;
          } else {
            rows[b].w++; rows[b].pts += 2; rows[a].otl++; rows[a].pts += 1;
          }
        } else {
          if (Math.random() < wp) {
            rows[a].w++; rows[a].pts += 2; rows[b].l++;
          } else {
            rows[b].w++; rows[b].pts += 2; rows[a].l++;
          }
        }
        rows[a].gp++; rows[b].gp++;
      }
    }
  }

  // Normalize to 82 GP (scale proportionally if off)
  for (const row of Object.values(rows)) {
    const scale = 82 / row.gp;
    row.w = Math.round(row.w * scale);
    row.l = Math.round(row.l * scale);
    row.otl = 82 - row.w - row.l;
    row.pts = row.w * 2 + row.otl;
    row.gp = 82;
  }

  return Object.values(rows).sort((a, b) => b.pts - a.pts || b.w - a.w);
}

export interface PlayoffSeed {
  abbrev: string;
  name: string;
  color: string;
  strength: number;
  seed: number;
}

export interface BracketSeries {
  top: PlayoffSeed;
  bottom: PlayoffSeed;
  winner?: PlayoffSeed;
  topWins: number;
  bottomWins: number;
  games: number;
}

export interface PlayoffBracket {
  east: { r1: BracketSeries[]; r2: BracketSeries[]; cf: BracketSeries };
  west: { r1: BracketSeries[]; r2: BracketSeries[]; cf: BracketSeries };
  scf: BracketSeries;
  champion?: PlayoffSeed;
}

function seedConference(rows: StandingsRow[], conf: string): PlayoffSeed[] {
  const divs = [...new Set(rows.filter(r => r.conf === conf).map(r => r.div))];
  const confTeams = rows.filter(r => r.conf === conf);

  // Top 3 per division
  const div1 = confTeams.filter(r => r.div === divs[0]).slice(0, 3);
  const div2 = confTeams.filter(r => r.div === divs[1]).slice(0, 3);

  // Wild cards: next 2 best in conf not already seeded
  const seededAbbrevs = new Set([...div1, ...div2].map(r => r.abbrev));
  const wildcards = confTeams.filter(r => !seededAbbrevs.has(r.abbrev)).slice(0, 2);

  const toSeed = (r: StandingsRow, seed: number): PlayoffSeed => ({
    abbrev: r.abbrev, name: r.name, color: r.color, strength: r.strength, seed,
  });

  // Division leaders sorted by pts, then the rest
  const leaders = [div1[0], div2[0]].sort((a, b) => b.pts - a.pts);
  return [
    toSeed(leaders[0], 1), toSeed(leaders[1], 2),
    toSeed(div1[1], 3), toSeed(div1[2], 4),
    toSeed(div2[1], 5), toSeed(div2[2], 6),
    toSeed(wildcards[0], 7), toSeed(wildcards[1], 8),
  ];
}

function simulateSeries(a: PlayoffSeed, b: PlayoffSeed): BracketSeries {
  const wp = winProb(a.strength, b.strength);
  let aW = 0, bW = 0;
  while (aW < 4 && bW < 4) {
    if (Math.random() < wp) aW++; else bW++;
  }
  return {
    top: a, bottom: b,
    winner: aW > bW ? a : b,
    topWins: aW, bottomWins: bW,
    games: aW + bW,
  };
}

export function simulatePlayoffs(standings: StandingsRow[]): PlayoffBracket {
  const east = seedConference(standings, "Eastern");
  const west = seedConference(standings, "Western");

  // R1: 1v8, 2v7, 3v6, 4v5  (but actual NHL seeding is by division)
  // Real: 1st div leader vs WC2 (lower seed), 2nd div leader vs WC1, 3rd vs 2nd in each div
  // Seeds: [D1_1st, D2_1st, D1_2nd, D1_3rd, D2_2nd, D2_3rd, WC1, WC2]
  const mkR1 = (seeds: PlayoffSeed[]): BracketSeries[] => [
    simulateSeries(seeds[0], seeds[7]), // 1st place div leader vs WC2
    simulateSeries(seeds[2], seeds[3]), // div1: 2nd vs 3rd
    simulateSeries(seeds[1], seeds[6]), // 2nd place div leader vs WC1
    simulateSeries(seeds[4], seeds[5]), // div2: 2nd vs 3rd
  ];

  const eR1 = mkR1(east);
  const wR1 = mkR1(west);

  const mkR2 = (r1: BracketSeries[]): BracketSeries[] => [
    simulateSeries(r1[0].winner!, r1[1].winner!),
    simulateSeries(r1[2].winner!, r1[3].winner!),
  ];

  const eR2 = mkR2(eR1);
  const wR2 = mkR2(wR1);

  const eCF = simulateSeries(eR2[0].winner!, eR2[1].winner!);
  const wCF = simulateSeries(wR2[0].winner!, wR2[1].winner!);
  const scf = simulateSeries(eCF.winner!, wCF.winner!);

  return {
    east: { r1: eR1, r2: eR2, cf: eCF },
    west: { r1: wR1, r2: wR2, cf: wCF },
    scf,
    champion: scf.winner,
  };
}

// Age-adjusted trade value — younger players are worth more.
// Peak value is ages 24-27; youth premium for prospects, penalty for aging veterans.
export function playerAge(p: PlayerRecord): number {
  if (!p.birthDate) return 27; // default to peak age if unknown
  const birth = new Date(p.birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function ageBonus(age: number): number {
  if (age <= 19) return 15;
  if (age === 20) return 12;
  if (age === 21) return 9;
  if (age === 22) return 6;
  if (age === 23) return 3;
  if (age <= 27)  return 0;  // peak
  if (age === 28) return -3;
  if (age === 29) return -7;
  if (age === 30) return -11;
  if (age === 31) return -15;
  if (age === 32) return -19;
  if (age === 33) return -22;
  if (age === 34) return -24;
  return -26; // 35+
}

export function tradeValue(p: PlayerRecord): number {
  return p.rating + ageBonus(playerAge(p));
}

// Fairness threshold in trade-value points (not raw rating points)
export const TRADE_FAIRNESS_THRESHOLD = 4;

export function isTradeFlat(given: PlayerRecord[], received: PlayerRecord[]): boolean {
  if (given.length === 0 || received.length === 0) return false;
  const giveVal = given.reduce((s, p) => s + tradeValue(p), 0);
  const recvVal = received.reduce((s, p) => s + tradeValue(p), 0);
  return Math.abs(giveVal - recvVal) <= TRADE_FAIRNESS_THRESHOLD;
}

export function tradeDiff(given: PlayerRecord[], received: PlayerRecord[]): number {
  const giveVal = given.reduce((s, p) => s + tradeValue(p), 0);
  const recvVal = received.reduce((s, p) => s + tradeValue(p), 0);
  return recvVal - giveVal;
}
