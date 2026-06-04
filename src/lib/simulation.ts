import type { Player, Position } from "./players";

export interface Roster {
  C: Player | null;
  LW: Player | null;
  RW: Player | null;
  D1: Player | null;
  D2: Player | null;
  G: Player | null;
}

export type RosterSlot = keyof Roster;

export const ROSTER_SLOTS: { slot: RosterSlot; label: string; positions: Position[] }[] = [
  { slot: "C", label: "Centre", positions: ["C"] },
  { slot: "LW", label: "Left Wing", positions: ["LW"] },
  { slot: "RW", label: "Right Wing", positions: ["RW"] },
  { slot: "D1", label: "Defence", positions: ["D"] },
  { slot: "D2", label: "Defence", positions: ["D"] },
  { slot: "G", label: "Goalie", positions: ["G"] },
];

export function isRosterComplete(roster: Roster): boolean {
  return Object.values(roster).every((p) => p !== null);
}

export function getRosterRating(roster: Roster): number {
  const players = Object.values(roster).filter((p): p is Player => p !== null);
  if (players.length === 0) return 0;
  return players.reduce((sum, p) => sum + p.rating, 0) / players.length;
}

// Win probability uses a sigmoid curve so elite teams truly dominate.
// League-average opponent is rating 65. k=0.1 means:
//   rating 75 → ~73% win rate (~60W), rating 85 → ~88% (~72W),
//   rating 92 → ~94% (~77W), making 82-0 genuinely rare but possible.
function simulateGame(roster: Roster): boolean {
  const skaters = [roster.C, roster.LW, roster.RW, roster.D1, roster.D2].filter(
    (p): p is Player => p !== null
  );
  const goalie = roster.G;

  const skaterRating =
    skaters.length > 0 ? skaters.reduce((s, p) => s + p.rating, 0) / skaters.length : 65;
  const goalieRating = goalie ? goalie.rating : 65;

  // Goalies carry outsized weight in hockey (~30%)
  const teamRating = skaterRating * 0.7 + goalieRating * 0.3;
  const ratingDiff = teamRating - 65;
  const winProb = 1 / (1 + Math.exp(-ratingDiff * 0.1));

  return Math.random() < winProb;
}

export interface SimulationResult {
  wins: number;
  losses: number;
  record: string;
  gameLog: boolean[];
}

export function simulateSeason(roster: Roster): SimulationResult {
  const gameLog: boolean[] = [];
  for (let i = 0; i < 82; i++) {
    gameLog.push(simulateGame(roster));
  }
  const wins = gameLog.filter(Boolean).length;
  const losses = 82 - wins;
  return { wins, losses, record: `${wins}-${losses}`, gameLog };
}
