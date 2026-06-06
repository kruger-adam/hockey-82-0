import type { Roster } from "./simulation";
import type { Player } from "./players";
import type { SeriesResult, GameScore, PlayerSeriesStats } from "./versus-types";

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getRating(p: Player, mode: "avg" | "best"): number {
  return mode === "best" ? p.bestRating : p.rating;
}

function goalRate(p: Player, mode: "avg" | "best"): number {
  if (mode === "best") return (p.bestGoals ?? 0) / Math.max(1, p.bestGP ?? 82);
  return (p.goals ?? 0) / 82;
}

function assistRate(p: Player, mode: "avg" | "best"): number {
  if (mode === "best") return (p.bestAssists ?? 0) / Math.max(1, p.bestGP ?? 82);
  return (p.assists ?? 0) / 82;
}

function pickWeighted(items: Player[], weights: number[]): Player | null {
  if (items.length === 0) return null;
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function getSkaters(roster: Roster): Player[] {
  return [roster.C, roster.LW, roster.RW, roster.D1, roster.D2].filter(
    (p): p is Player => p !== null
  );
}

function expectedGoals(skaters: Player[], goalie: Player | null, mode: "avg" | "best"): number {
  const skaterAvg =
    skaters.length > 0
      ? skaters.reduce((s, p) => s + getRating(p, mode), 0) / skaters.length
      : 65;
  const goalieRating = goalie ? getRating(goalie, mode) : 65;
  return Math.max(1.0, Math.min(6.0, 3.0 + (skaterAvg - goalieRating) * 0.05));
}

type RawStats = PlayerSeriesStats & {
  goalsAgainst: number;
  shotsAgainst: number;
  gamesPlayed: number;
};

function initStats(roster: Roster): Map<string, RawStats> {
  const map = new Map<string, RawStats>();
  const all = [roster.C, roster.LW, roster.RW, roster.D1, roster.D2, roster.G].filter(
    (p): p is Player => p !== null
  );
  for (const p of all) {
    map.set(p.name, {
      name: p.name,
      position: [...p.position],
      goals: 0,
      assists: 0,
      points: 0,
      plusMinus: 0,
      goalsAgainst: 0,
      shotsAgainst: 0,
      gamesPlayed: 0,
    });
  }
  return map;
}

function assignGoals(
  skaters: Player[],
  numGoals: number,
  stats: Map<string, RawStats>,
  mode: "avg" | "best"
): void {
  for (let i = 0; i < numGoals; i++) {
    if (skaters.length === 0) continue;
    const scorer = pickWeighted(skaters, skaters.map((p) => Math.max(0.01, goalRate(p, mode))));
    if (!scorer) continue;
    const ss = stats.get(scorer.name)!;
    ss.goals++;
    ss.points++;

    const r = Math.random();
    const numAssists = r < 0.1 ? 0 : r < 0.35 ? 1 : 2;
    const used = new Set([scorer.name]);
    for (let a = 0; a < numAssists; a++) {
      const candidates = skaters.filter((p) => !used.has(p.name));
      if (!candidates.length) break;
      const assister = pickWeighted(
        candidates,
        candidates.map((p) => Math.max(0.01, assistRate(p, mode)))
      );
      if (!assister) break;
      used.add(assister.name);
      const as = stats.get(assister.name)!;
      as.assists++;
      as.points++;
    }
  }
}

function simulateSingleGame(
  roster1: Roster,
  roster2: Roster,
  mode: "avg" | "best",
  stats1: Map<string, RawStats>,
  stats2: Map<string, RawStats>
): GameScore {
  const sk1 = getSkaters(roster1);
  const sk2 = getSkaters(roster2);
  const g1 = roster1.G;
  const g2 = roster2.G;

  const exp1 = expectedGoals(sk1, g2, mode);
  const exp2 = expectedGoals(sk2, g1, mode);

  let goals1 = poissonSample(exp1);
  let goals2 = poissonSample(exp2);

  let overtime = false;
  if (goals1 === goals2) {
    overtime = true;
    if (Math.random() < exp1 / (exp1 + exp2 + 0.001)) goals1++;
    else goals2++;
  }

  assignGoals(sk1, goals1, stats1, mode);
  assignGoals(sk2, goals2, stats2, mode);

  for (let i = 0; i < goals1; i++) {
    shuffle(sk1).slice(0, Math.min(3, sk1.length)).forEach((p) => stats1.get(p.name)!.plusMinus++);
    shuffle(sk2).slice(0, Math.min(3, sk2.length)).forEach((p) => stats2.get(p.name)!.plusMinus--);
  }
  for (let i = 0; i < goals2; i++) {
    shuffle(sk2).slice(0, Math.min(3, sk2.length)).forEach((p) => stats2.get(p.name)!.plusMinus++);
    shuffle(sk1).slice(0, Math.min(3, sk1.length)).forEach((p) => stats1.get(p.name)!.plusMinus--);
  }

  const shots1 = goals2 + 20 + Math.floor(Math.random() * 12);
  const shots2 = goals1 + 20 + Math.floor(Math.random() * 12);
  if (g1) {
    const gs = stats1.get(g1.name)!;
    gs.shotsAgainst += shots1;
    gs.goalsAgainst += goals2;
    gs.gamesPlayed++;
  }
  if (g2) {
    const gs = stats2.get(g2.name)!;
    gs.shotsAgainst += shots2;
    gs.goalsAgainst += goals1;
    gs.gamesPlayed++;
  }

  return { p1Goals: goals1, p2Goals: goals2, overtime, winner: goals1 > goals2 ? "p1" : "p2" };
}

function finalizeStats(raw: Map<string, RawStats>): PlayerSeriesStats[] {
  return Array.from(raw.values()).map((s) => {
    const result: PlayerSeriesStats = {
      name: s.name,
      position: s.position,
      goals: s.goals,
      assists: s.assists,
      points: s.points,
      plusMinus: s.plusMinus,
    };
    if (s.position.includes("G") && s.gamesPlayed > 0) {
      result.svPct = s.shotsAgainst > 0 ? (s.shotsAgainst - s.goalsAgainst) / s.shotsAgainst : 1;
      result.gaa = s.goalsAgainst / s.gamesPlayed;
    }
    return result;
  });
}

export function simulateSeries(
  roster1: Roster,
  roster2: Roster,
  mode: "avg" | "best" = "avg"
): SeriesResult {
  const stats1 = initStats(roster1);
  const stats2 = initStats(roster2);
  const games: GameScore[] = [];
  let p1Wins = 0, p2Wins = 0;

  while (p1Wins < 4 && p2Wins < 4) {
    const game = simulateSingleGame(roster1, roster2, mode, stats1, stats2);
    games.push(game);
    if (game.winner === "p1") p1Wins++;
    else p2Wins++;
  }

  const p1Stats = finalizeStats(stats1);
  const p2Stats = finalizeStats(stats2);

  const skaters = [...p1Stats, ...p2Stats].filter((s) => !s.position.includes("G"));
  const mvp = skaters.reduce(
    (best, s) => (s.points > best.points ? s : best),
    skaters[0] ?? { name: "N/A", points: 0 }
  );

  return {
    p1Wins,
    p2Wins,
    seriesWinner: p1Wins > p2Wins ? "p1" : "p2",
    games,
    p1Stats,
    p2Stats,
    mvp: mvp.name,
  };
}
