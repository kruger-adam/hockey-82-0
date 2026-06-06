import type { Roster } from "./simulation";

export interface VsPlayerState {
  id: string;
  roster: Roster;
  respinTeamUsed: boolean;
  respinDecadeUsed: boolean;
  ready: boolean;
}

export interface SpinState {
  decade: string;
  team: string;
}

export type GameStatus = "waiting" | "ready_check" | "drafting" | "complete";

export interface GameSession {
  id: string;
  status: GameStatus;
  p1: VsPlayerState;
  p2: VsPlayerState | null;
  currentTurn: "p1" | "p2";
  pickNumber: number;
  currentSpin: SpinState | null;
  draftedNames: string[];
  statsMode: "avg" | "best";
  result: SeriesResult | null;
  createdAt: number;
  turnDeadline: number | null;
  readyDeadline: number | null;
  lastRespin: "team" | "decade" | null;
  botRole: "p1" | "p2" | null;
  rematchRequestedBy: "p1" | "p2" | null;
  rematchRoomCode: string | null;
  rematchDeadline: number | null;
}

export interface SeriesResult {
  p1Wins: number;
  p2Wins: number;
  seriesWinner: "p1" | "p2";
  games: GameScore[];
  p1Stats: PlayerSeriesStats[];
  p2Stats: PlayerSeriesStats[];
  mvp: string;
}

export interface GameScore {
  p1Goals: number;
  p2Goals: number;
  overtime: boolean;
  winner: "p1" | "p2";
}

export interface PlayerSeriesStats {
  name: string;
  position: string[];
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  svPct?: number;
  gaa?: number;
}
