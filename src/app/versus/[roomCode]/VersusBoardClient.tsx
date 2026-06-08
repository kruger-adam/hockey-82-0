"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { GameSession, PlayerSeriesStats, SeriesResult } from "@/lib/versus-types";
import type { Player, Position } from "@/lib/players";
import type { RosterSlot } from "@/lib/simulation";
import { ROSTER_SLOTS } from "@/lib/simulation";
import { getPlayersForTeamDecade, getAllTeamDecadeCombos } from "@/lib/players";
import Ably from "ably";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOrCreateUserId(): string {
  try {
    let id = localStorage.getItem("hockey-user-id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("hockey-user-id", id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

const POSITION_COLORS: Record<Position, string> = {
  C:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  LW: "bg-green-500/20 text-green-300 border-green-500/30",
  RW: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  D:  "bg-orange-500/20 text-orange-300 border-orange-500/30",
  G:  "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

const SLOT_POSITION: Record<RosterSlot, Position> = {
  C: "C", LW: "LW", RW: "RW", D1: "D", D2: "D", G: "G",
};

const TEAM_ABBR: Record<string, string> = {
  "Anaheim Ducks": "ANA", "Mighty Ducks of Anaheim": "ANA", "Atlanta Thrashers": "ATL",
  "Atlanta Flames": "ATL", "Arizona Coyotes": "ARI", "Phoenix Coyotes": "PHX",
  "Boston Bruins": "BOS", "Buffalo Sabres": "BUF", "Calgary Flames": "CGY",
  "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL",
  "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL", "Detroit Red Wings": "DET",
  "Edmonton Oilers": "EDM", "Florida Panthers": "FLA", "Hartford Whalers": "HFD",
  "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Minnesota North Stars": "MIN",
  "Montreal Canadiens": "MTL", "Nashville Predators": "NSH", "New Jersey Devils": "NJD",
  "New York Islanders": "NYI", "New York Rangers": "NYR", "Ottawa Senators": "OTT",
  "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "Quebec Nordiques": "QUE",
  "San Jose Sharks": "SJS", "Seattle Kraken": "SEA", "St. Louis Blues": "STL",
  "Tampa Bay Lightning": "TBL", "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA",
  "Vancouver Canucks": "VAN", "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH",
  "Winnipeg Jets": "WPG",
};

function teamAbbr(team: string) { return TEAM_ABBR[team] ?? team.substring(0, 3).toUpperCase(); }
function decadeShort(d: string) { const m = d.match(/\d{2}(\d{2})s/); return m ? `${m[1]}'s` : d; }
function seasonLabel(y: number) { return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; }

function statLine(p: Player, mode: "avg" | "best"): string {
  if (p.position.includes("G")) {
    if (mode === "best" && p.bestSavePercentage != null && p.bestYear != null) {
      return `.${Math.round(p.bestSavePercentage * 1000)} SV% · ${p.bestGaa?.toFixed(2)} GAA · ${seasonLabel(p.bestYear)}`;
    }
    return `.${Math.round((p.savePercentage ?? 0) * 1000)} SV% · ${p.gaa?.toFixed(2)} GAA`;
  }
  if (mode === "best" && p.bestGoals != null && p.bestYear != null) {
    return `${p.bestGoals}G · ${p.bestAssists ?? 0}A · ${seasonLabel(p.bestYear)}`;
  }
  const gpg = (p.goals ?? 0) / 82, apg = (p.assists ?? 0) / 82;
  return `${gpg.toFixed(2)} G/gm · ${apg.toFixed(2)} A/gm · ${(gpg + apg).toFixed(2)} PTS/gm`;
}

function ptsPerGame(p: Player, mode: "avg" | "best"): number {
  if (mode === "best") {
    if (p.position.includes("G")) return p.bestSavePercentage ?? p.savePercentage ?? 0;
    if (p.bestGoals != null) return 3 * p.bestGoals + 2 * (p.bestAssists ?? 0);
  }
  return ((p.goals ?? 0) + (p.assists ?? 0)) / 82;
}

function getOpenPositions(roster: GameSession["p1"]["roster"]): Set<Position> {
  const open = new Set<Position>();
  for (const { slot, positions } of ROSTER_SLOTS) {
    if (roster[slot] === null) positions.forEach((p) => open.add(p as Position));
  }
  return open;
}

function getEligibleSlots(player: Player, roster: GameSession["p1"]["roster"]): RosterSlot[] {
  return ROSTER_SLOTS.filter(
    ({ slot, positions }) =>
      roster[slot] === null && player.position.some((p) => positions.includes(p as Position))
  ).map((s) => s.slot);
}

function groupPlayers(players: Player[], mode: "avg" | "best") {
  const fwd = players
    .filter((p) => p.position.some((pos) => ["C","LW","RW"].includes(pos)) && !p.position.includes("G"))
    .sort((a, b) => ptsPerGame(b, mode) - ptsPerGame(a, mode));
  const def = players
    .filter((p) => p.position.includes("D") && !p.position.some((pos) => ["C","LW","RW"].includes(pos)))
    .sort((a, b) => ptsPerGame(b, mode) - ptsPerGame(a, mode));
  const goa = players
    .filter((p) => p.position.includes("G"))
    .sort((a, b) => (mode === "best" ? b.bestRating : b.rating) - (mode === "best" ? a.bestRating : a.rating));
  return { fwd, def, goa };
}

// ── Roster panel ──────────────────────────────────────────────────────────────

function RosterPanel({
  roster,
  mode,
  label,
  highlight,
}: {
  roster: GameSession["p1"]["roster"];
  mode: "avg" | "best";
  label: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-blue-500/40" : ""}>
      <CardContent className="pt-3 pb-3">
        <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${highlight ? "text-blue-400" : "text-muted-foreground/60"}`}>
          {label}
        </p>
        {ROSTER_SLOTS.map(({ slot, label: slotLabel }) => {
          const p = roster[slot];
          return (
            <div key={slot} className="flex items-center gap-2 py-1 text-xs">
              <span className="text-muted-foreground/50 uppercase tracking-wide w-6 shrink-0">{slotLabel}</span>
              {p ? (
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-sm leading-tight">{p.name}</span>
                  <span className="text-muted-foreground/50 leading-tight">{p.decade} · {teamAbbr(p.team)}</span>
                </div>
              ) : (
                <span className="text-muted-foreground/25">—</span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Series result ─────────────────────────────────────────────────────────────

function StatTable({ stats, title }: { stats: PlayerSeriesStats[]; title: string }) {
  const skaters = stats.filter((s) => !s.position.includes("G")).sort((a, b) => b.points - a.points);
  const goalies = stats.filter((s) => s.position.includes("G"));
  return (
    <div className="flex flex-col gap-2">
      <p className={`text-xs font-bold uppercase tracking-widest ${title === "Your Team" ? "text-blue-400" : "text-orange-400"}`}>
        {title}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground/50 border-b border-border/30">
              <th className="text-left py-1 pr-2 font-medium">Player</th>
              <th className="text-center px-1 font-medium">G</th>
              <th className="text-center px-1 font-medium">A</th>
              <th className="text-center px-1 font-medium">PTS</th>
              <th className="text-center px-1 font-medium">+/-</th>
            </tr>
          </thead>
          <tbody>
            {skaters.map((s) => (
              <tr key={s.name} className="border-b border-border/10">
                <td className="py-1 pr-2 font-medium">{s.name}</td>
                <td className="text-center px-1 tabular-nums">{s.goals}</td>
                <td className="text-center px-1 tabular-nums">{s.assists}</td>
                <td className="text-center px-1 tabular-nums font-semibold">{s.points}</td>
                <td className={`text-center px-1 tabular-nums ${s.plusMinus > 0 ? "text-green-400" : s.plusMinus < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                  {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {goalies.map((g) => (
        <div key={g.name} className="flex items-center justify-between px-1 py-1 rounded bg-purple-500/5 border border-purple-500/20 text-xs mt-1">
          <span className="font-medium">{g.name}</span>
          <span className="text-muted-foreground/70 tabular-nums">
            {g.svPct != null ? `.${Math.round(g.svPct * 1000)} SV%` : "—"} · {g.gaa != null ? `${g.gaa.toFixed(2)} GAA` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function SeriesResultScreen({
  result,
  myRole,
  roomCode,
  vsBot,
  rematchStatus,
  rematchCountdown,
  playerStats,
  onRematch,
  onAcceptRematch,
  onDeclineRematch,
}: {
  result: SeriesResult;
  myRole: "p1" | "p2" | null;
  roomCode: string;
  vsBot: boolean;
  rematchStatus: "idle" | "requesting" | "incoming" | "expired";
  rematchCountdown: number | null;
  playerStats: {
    wins: number;
    losses: number;
    rank: number | null;
    totalPlayers: number;
    neighbors: { rank: number; wins: number; losses: number; differential: number; isMe: boolean; name?: string }[];
  } | null;
  onRematch: () => void;
  onAcceptRematch: () => void;
  onDeclineRematch: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const iWon =
    myRole === null ? null : result.seriesWinner === myRole;

  const winnerWins = result.seriesWinner === "p1" ? result.p1Wins : result.p2Wins;
  const loserWins = result.seriesWinner === "p1" ? result.p2Wins : result.p1Wins;
  const seriesLabel = `${winnerWins}-${loserWins}`;
  const headline =
    iWon === null
      ? `Series: ${seriesLabel}`
      : iWon
      ? `You win the series ${seriesLabel}! 🏆`
      : `You lose the series ${seriesLabel}`;

  function share() {
    const winnerWins = result.seriesWinner === "p1" ? result.p1Wins : result.p2Wins;
    const loserWins  = result.seriesWinner === "p1" ? result.p2Wins : result.p1Wins;
    const iWon = myRole ? result.seriesWinner === myRole : true;
    const seriesDesc = loserWins === 0
      ? `${winnerWins}-0 sweep`
      : `${winnerWins}-${loserWins} series ${iWon ? "win" : "loss"}`;
    const shareHeadline = `🏒 Head-to-Head: ${seriesDesc}${iWon ? " 🏆" : ""}`;

    const lastName = (name: string) => name.split(" ").pop() ?? name;
    const sorted = (stats: PlayerSeriesStats[]) => [
      ...stats.filter(s => !s.position.includes("G")).sort((a, b) => b.points - a.points),
      ...stats.filter(s => s.position.includes("G")),
    ];
    const formatPlayer = (s: PlayerSeriesStats) => {
      const tag = s.name === result.mvp ? " (MVP)" : "";
      if (s.position.includes("G")) {
        const sv = s.svPct != null ? `.${Math.round(s.svPct * 1000)} SV%` : "—";
        return `${lastName(s.name)}${tag}: ${sv}`;
      }
      return `${lastName(s.name)}${tag}: ${s.goals}G ${s.assists}A`;
    };

    const myStats    = sorted(myRole === "p2" ? result.p2Stats : result.p1Stats);
    const theirStats = sorted(myRole === "p2" ? result.p1Stats : result.p2Stats);
    const themLabel  = vsBot ? "BOT" : "THEM";

    const text = [
      shareHeadline,
      "",
      "YOU",
      ...myStats.map(formatPlayer),
      "",
      themLabel,
      ...theirStats.map(formatPlayer),
      "",
      "82and0hockey.com/versus",
    ].join("\n");

    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-lg mx-auto">
      {/* Headline */}
      <div className="text-center">
        <p className={`text-2xl font-black ${iWon ? "text-yellow-400" : iWon === false ? "text-red-400" : "text-foreground"}`}>
          {headline}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Series MVP: {result.mvp}</p>
        {myRole && playerStats && (
          <div className="mt-3">
            {playerStats.neighbors.length > 0 ? (
              <div className="inline-block text-left mx-auto min-w-[220px]">
                {playerStats.neighbors.map((n, i) => {
                  const prev = i > 0 ? playerStats.neighbors[i - 1] : null;
                  const hasGapBefore = prev !== null && n.rank - prev.rank > 1;
                  const showDividerBefore = n.isMe;
                  const showDividerAfter = n.isMe;
                  return (
                    <div key={i}>
                      {hasGapBefore && (
                        <div className="text-center text-muted-foreground/30 text-xs leading-none py-0.5">···</div>
                      )}
                      {showDividerBefore && <div className="border-t border-border/40 my-1" />}
                      <div className={`flex items-center gap-3 px-2 py-0.5 rounded ${n.isMe ? "bg-blue-500/10" : ""}`}>
                        <span className={`text-xs tabular-nums w-8 text-right ${n.isMe ? "text-blue-400 font-bold" : "text-muted-foreground/40"}`}>
                          #{n.rank}
                        </span>
                        {n.name && (
                          <span className={`text-xs ${n.isMe ? "text-foreground font-bold" : "text-muted-foreground/60"}`}>
                            {n.name}
                          </span>
                        )}
                        <span className={`text-xs tabular-nums ${n.isMe ? "text-foreground font-bold" : "text-muted-foreground/70"}`}>
                          {n.wins}W–{n.losses}L
                        </span>
                        <span className={`text-xs tabular-nums ${n.differential >= 0 ? "text-green-400/60" : "text-red-400/60"}`}>
                          {n.differential >= 0 ? "+" : ""}{n.differential}
                        </span>
                        {n.isMe && <span className="text-xs text-blue-400">← you</span>}
                      </div>
                      {showDividerAfter && <div className="border-t border-border/40 my-1" />}
                    </div>
                  );
                })}
                {playerStats.totalPlayers > 0 && (
                  <p className="text-xs text-muted-foreground/30 text-center mt-1">
                    of {playerStats.totalPlayers.toLocaleString()} players
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {playerStats.wins}W – {playerStats.losses}L
                </span>
                {playerStats.rank !== null && (
                  <span className="text-xs text-muted-foreground/70">
                    · Rank #{playerStats.rank.toLocaleString()} of {playerStats.totalPlayers.toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Game-by-game scores */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Results</p>
        <div className="flex flex-wrap gap-2">
          {result.games.map((g, i) => {
            const myGoals = myRole === "p2" ? g.p2Goals : g.p1Goals;
            const theirGoals = myRole === "p2" ? g.p1Goals : g.p2Goals;
            const iWonGame = myRole ? g.winner === myRole : g.winner === "p1";
            return (
              <div
                key={i}
                className={`flex flex-col items-center px-3 py-2 rounded-lg border ${
                  iWonGame ? "border-green-500/40 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <span className="text-xs text-muted-foreground/60 font-medium">G{i + 1}{g.overtime ? " OT" : ""}</span>
                <span className={`text-lg font-black tabular-nums ${iWonGame ? "text-green-400" : "text-red-400"}`}>
                  {myRole ? `${myGoals}-${theirGoals}` : `${g.p1Goals}-${g.p2Goals}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stat tables */}
      <StatTable
        stats={result.p1Stats}
        title={myRole === "p1" ? "Your Team" : myRole === "p2" ? (vsBot ? "Bot" : "Opponent") : "Player 1"}
      />
      <StatTable
        stats={result.p2Stats}
        title={myRole === "p2" ? "Your Team" : myRole === "p1" ? (vsBot ? "Bot" : "Opponent") : "Player 2"}
      />

      {/* Rematch */}
      {myRole && (
        <div className="flex flex-col gap-2">
          {vsBot ? (
            <a
              href="/versus"
              className="inline-flex items-center justify-center rounded-md bg-orange-500 hover:bg-orange-400 active:bg-orange-600 active:scale-95 text-white font-bold py-5 w-full transition-colors"
            >
              Play Again
            </a>
          ) : rematchStatus === "idle" ? (
            <Button onClick={onRematch} variant="outline" className="w-full py-5 font-bold">
              Rematch
            </Button>
          ) : rematchStatus === "requesting" ? (
            <div className="w-full text-center py-3 text-sm text-muted-foreground">
              Waiting for opponent to accept… <span className="tabular-nums font-bold text-foreground">{rematchCountdown ?? "—"}s</span>
            </div>
          ) : rematchStatus === "expired" ? (
            <div className="w-full text-center py-3 text-sm text-muted-foreground">
              They didn't accept the rematch.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2">
              <p className="text-sm font-bold">Opponent wants a rematch!</p>
              <p className="text-xs text-muted-foreground">
                Respond within <span className="tabular-nums font-bold text-foreground">{rematchCountdown ?? "—"}s</span>
              </p>
              <div className="flex gap-2 w-full">
                <Button onClick={onAcceptRematch} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold">
                  Accept
                </Button>
                <Button onClick={onDeclineRematch} variant="outline" className="flex-1">
                  Decline
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <a
          href="/versus"
          className="flex-1 inline-flex items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium hover:bg-accent transition-colors h-8"
        >
          New Game
        </a>
        <Button onClick={share} variant="outline" className="flex-1">
          {copied ? "✓ Copied!" : "Share Result"}
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type UIPhase =
  | "loading"
  | "waiting_for_opponent"
  | "ready_check"
  | "my_turn"
  | "spinning"
  | "picking"
  | "positioning"
  | "opponent_turn"
  | "complete";

export default function VersusBoardClient({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const [game, setGame] = useState<GameSession | null>(null);
  const [myRole, setMyRole] = useState<"p1" | "p2" | null>(null);
  const [phase, setPhase] = useState<UIPhase>("loading");
  const [spinCombo, setSpinCombo] = useState<{ decade: string; team: string } | null>(null);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [displayedTeam, setDisplayedTeam] = useState<string>("???");
  const [displayedDecade, setDisplayedDecade] = useState<string>("???");
  const [lockedCard, setLockedCard] = useState<"team" | "decade" | null>(null);
  const [copied, setCopied] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ablyRef = useRef<Ably.Realtime | null>(null);
  const pendingStateRef = useRef<GameSession | null>(null);
  const myRoleRef = useRef<"p1" | "p2" | null>(null);
  const phaseRef = useRef<UIPhase>("loading");
  const spinComboRef = useRef<{ decade: string; team: string } | null>(null);
  const pickInFlightRef = useRef(false);
  const lastSubmittedPickNumberRef = useRef<number | null>(null);
  const [rematchStatus, setRematchStatus] = useState<"idle" | "requesting" | "incoming" | "expired">("idle");
  const [rematchCountdown, setRematchCountdown] = useState<number | null>(null);
  const rematchStatusRef = useRef<"idle" | "requesting" | "incoming" | "expired">("idle");
  const [playerStats, setPlayerStats] = useState<{
    wins: number;
    losses: number;
    rank: number | null;
    totalPlayers: number;
    neighbors: { rank: number; wins: number; losses: number; differential: number; isMe: boolean; name?: string }[];
  } | null>(null);

  // Keep refs in sync
  useEffect(() => { myRoleRef.current = myRole; }, [myRole]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { spinComboRef.current = spinCombo; }, [spinCombo]);
  useEffect(() => { rematchStatusRef.current = rematchStatus; }, [rematchStatus]);

  // Rematch countdown
  useEffect(() => {
    if (!game?.rematchDeadline || rematchStatus === "idle") { setRematchCountdown(null); return; }
    const d = game.rematchDeadline;
    function tick() { setRematchCountdown(Math.max(0, Math.ceil((d - Date.now()) / 1000))); }
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [game?.rematchDeadline, rematchStatus]);

  // Countdown timer — ready_check window or turn deadline
  useEffect(() => {
    let deadline: number | null = null;
    if (game?.status === "ready_check" && game?.readyDeadline) {
      deadline = game.readyDeadline;
    } else if (game?.status === "drafting" && game?.currentTurn === myRole && game?.turnDeadline) {
      deadline = game.turnDeadline;
    }
    if (!deadline) { setSecondsLeft(null); return; }
    const d = deadline;
    function tick() { setSecondsLeft(Math.max(0, Math.ceil((d - Date.now()) / 1000))); }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [game?.readyDeadline, game?.turnDeadline, game?.status, game?.currentTurn, myRole]);

  const applyGameState = useCallback((g: GameSession, role: "p1" | "p2" | null) => {
    const currentPhase = phaseRef.current;
    // Skip re-renders during active player interaction — polling setGame() mid-tap drops clicks on mobile
    const isInteracting = currentPhase === "picking" || currentPhase === "positioning" || currentPhase === "spinning";

    if (g.status === "complete") {
      setGame(g);
      setPhase("complete");
      const userId = getOrCreateUserId();
      fetch(`/api/player/stats?playerId=${userId}`)
        .then((r) => r.json())
        .then(setPlayerStats)
        .catch(() => {});
      // Stop polling 30s after game ends — covers the rematch window
      setTimeout(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 30_000);
      return;
    }
    if (g.status === "abandoned") {
      setGame(g);
      setPhase("complete");
      const userId = getOrCreateUserId();
      fetch(`/api/player/stats?playerId=${userId}`)
        .then((r) => r.json())
        .then(setPlayerStats)
        .catch(() => {});
      // No rematch for abandoned games — stop polling sooner
      setTimeout(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 5_000);
      return;
    }
    if (g.status === "waiting") { setGame(g); setPhase("waiting_for_opponent"); return; }
    if (g.status === "ready_check") { setGame(g); setPhase("ready_check"); return; }

    if (!role) { setGame(g); return; }

    if (g.currentTurn !== role) {
      if (currentPhase === "picking" || currentPhase === "positioning") {
        // phaseRef may lag behind actual phase if a pick is in flight — save for when it clears
        if (pickInFlightRef.current) pendingStateRef.current = g;
        return;
      }
      setGame(g);
      setPhase("opponent_turn");
      return;
    }

    // It's our turn — don't update game state while user is actively interacting or a pick is in flight
    if (isInteracting || pickInFlightRef.current) {
      pendingStateRef.current = g;
      return;
    }

    // Stale poll: same pickNumber means our pick wasn't processed yet — ignore to
    // avoid overwriting the optimistic roster or re-triggering the spin recovery path.
    // A higher pickNumber means real new turns happened (e.g. auto-spin after Ably drop)
    // and must be applied even if we're still showing opponent_turn.
    if (
      currentPhase === "opponent_turn" &&
      g.currentSpin &&
      lastSubmittedPickNumberRef.current !== null &&
      g.pickNumber === lastSubmittedPickNumberRef.current
    ) return;

    setGame(g);

    if (g.currentSpin && !spinComboRef.current && !pickInFlightRef.current) {
      // Recover spin from server (page refresh mid-pick)
      const players = getPlayersForTeamDecade(g.currentSpin.decade, g.currentSpin.team)
        .filter((p) => !g.draftedNames.includes(p.name));
      setSpinCombo(g.currentSpin);
      setAvailablePlayers(players);
      setDisplayedTeam(g.currentSpin.team);
      setDisplayedDecade(g.currentSpin.decade);
      setPhase("picking");
      return;
    }

    if (!g.currentSpin) setPhase("my_turn");
  }, []);

  // Initial load + auto-join
  useEffect(() => {
    const userId = getOrCreateUserId();

    async function init() {
      try {
        const res = await fetch(`/api/game/${roomCode}`);
        if (!res.ok) { setFetchError("Game not found."); return; }
        const g: GameSession = await res.json();

        let role: "p1" | "p2" | null = null;
        if (g.p1.id === userId) role = "p1";
        else if (g.p2?.id === userId) role = "p2";
        else if (g.status === "waiting") {
          // Auto-join as p2
          const joinRes = await fetch("/api/game/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomCode, playerId: userId }),
          });
          const joinData = await joinRes.json();
          if (joinRes.ok) {
            role = joinData.role;
            const updated = await fetch(`/api/game/${roomCode}`).then((r) => r.json());
            setMyRole(role);
            myRoleRef.current = role;
            applyGameState(updated, role);
            return;
          } else {
            setFetchError(joinData.error === "full" ? "This game is full." : "Could not join game.");
            return;
          }
        } else {
          // Spectator — just show result if complete
          role = null;
        }

        setMyRole(role);
        myRoleRef.current = role;
        applyGameState(g, role);
      } catch {
        setFetchError("Failed to load game.");
      }
    }

    init();
  }, [roomCode, applyGameState]);

  // Real-time sync via Ably (push) + 10s fallback poll for bot/expiry triggers
  useEffect(() => {
    function handleGameState(g: GameSession) {
      // Detect server-side auto-spin
      if (
        g.currentTurn === myRoleRef.current &&
        g.currentSpin &&
        !spinComboRef.current &&
        !pickInFlightRef.current &&
        phaseRef.current === "my_turn"
      ) {
        const players = getPlayersForTeamDecade(g.currentSpin.decade, g.currentSpin.team)
          .filter((p) => !g.draftedNames.includes(p.name));
        setGame(g);
        setSpinCombo(g.currentSpin);
        setAvailablePlayers(players);
        setPhase("spinning");
        runSpinAnimation(g.currentSpin, null, () => setPhase("picking"));
        return;
      }

      // Rematch detection
      if (g.status === "complete" && myRoleRef.current) {
        if (g.rematchRoomCode) {
          router.push(`/versus/${g.rematchRoomCode}`);
          return;
        }
        const otherRole = myRoleRef.current === "p1" ? "p2" : "p1";
        if (g.rematchRequestedBy === otherRole && rematchStatusRef.current !== "incoming") {
          setRematchStatus("incoming");
        } else if (!g.rematchRequestedBy && (rematchStatusRef.current === "incoming" || rematchStatusRef.current === "requesting")) {
          setRematchStatus("expired");
        }
      }

      applyGameState(g, myRoleRef.current);
    }

    // Ably subscription
    const ably = new Ably.Realtime({ authUrl: "/api/ably-token", authMethod: "GET" });
    ablyRef.current = ably;
    const channel = ably.channels.get(`game:${roomCode}`);
    channel.subscribe("state", (msg) => handleGameState(msg.data as GameSession));

    // On reconnect, fetch current state to catch anything missed while disconnected
    let hasConnected = false;
    ably.connection.on("connected", async () => {
      if (!hasConnected) { hasConnected = true; return; }
      try {
        const res = await fetch(`/api/game/${roomCode}`);
        if (res.ok) handleGameState(await res.json());
      } catch { /* ignore */ }
    });

    // 2s fallback poll — catches Ably drops and triggers bot/expiry checks
    pollRef.current = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/game/${roomCode}`);
        if (res.ok) handleGameState(await res.json());
      } catch { /* ignore */ }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      channel.unsubscribe();
      ably.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, applyGameState]);

  // Cleanup spin animation on unmount
  useEffect(() => {
    return () => { if (spinIntervalRef.current) clearInterval(spinIntervalRef.current); };
  }, []);

  function runSpinAnimation(
    finalCombo: { decade: string; team: string },
    locked: "team" | "decade" | null,
    onDone: () => void
  ) {
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    setLockedCard(locked);
    if (locked === "team") setDisplayedTeam(finalCombo.team);
    if (locked === "decade") setDisplayedDecade(finalCombo.decade);
    const all = getAllTeamDecadeCombos();
    let count = 0;
    spinIntervalRef.current = setInterval(() => {
      const r = all[Math.floor(Math.random() * all.length)];
      if (locked !== "team") setDisplayedTeam(r.team);
      if (locked !== "decade") setDisplayedDecade(r.decade);
      count++;
      if (count >= 20) {
        clearInterval(spinIntervalRef.current!);
        setDisplayedTeam(finalCombo.team);
        setDisplayedDecade(finalCombo.decade);
        setLockedCard(null);
        onDone();
      }
    }, 80);
  }

  async function doSpin() {
    setPhase("spinning");
    const userId = getOrCreateUserId();
    const res = await fetch(`/api/game/${roomCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "spin", playerId: userId }),
    });
    const data = await res.json();
    if (!res.ok || !data.combo) { setPhase("my_turn"); return; }
    const combo = data.combo as { decade: string; team: string };
    const players = getPlayersForTeamDecade(combo.decade, combo.team)
      .filter((p) => !game!.draftedNames.includes(p.name));
    setSpinCombo(combo);
    setAvailablePlayers(players);
    // Optimistically update deadline so the countdown doesn't flash the leftover spin seconds
    if (game) setGame({ ...game, currentSpin: combo, turnDeadline: Date.now() + 24_000 });
    runSpinAnimation(combo, null, () => {
      setPhase("picking");
    });
  }

  async function doRespin(type: "team" | "decade") {
    if (!game || !spinCombo) return;
    const userId = getOrCreateUserId();
    const res = await fetch(`/api/game/${roomCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: type === "team" ? "respin_team" : "respin_decade", playerId: userId }),
    });
    const data = await res.json();
    if (!res.ok || !data.combo) return;
    const combo = data.combo as { decade: string; team: string };
    const locked = type === "team" ? "decade" : "team";
    // Optimistically update combo, deadline, and respin-used flag so UI reflects instantly
    const ps = myRole ? game[myRole] : null;
    const updatedPs = ps ? {
      ...ps,
      respinTeamUsed: type === "team" ? true : ps.respinTeamUsed,
      respinDecadeUsed: type === "decade" ? true : ps.respinDecadeUsed,
    } : null;
    setGame({
      ...game,
      currentSpin: combo,
      turnDeadline: Date.now() + 22_000,
      ...(myRole && updatedPs ? { [myRole]: updatedPs } : {}),
    });
    setPhase("spinning");
    runSpinAnimation(combo, locked, () => {
      const players = getPlayersForTeamDecade(combo.decade, combo.team)
        .filter((p) => !game.draftedNames.includes(p.name));
      setSpinCombo(combo);
      setAvailablePlayers(players);
      setPhase("picking");
    });
  }

  function selectPlayer(player: Player) {
    if (!game || !myRole) return;
    const myRoster = getPS(game, myRole).roster;
    const eligible = getEligibleSlots(player, myRoster);
    if (!eligible.length) return;
    setSelectedPlayer(player);
    const uniquePos = new Set(eligible.map((s) => SLOT_POSITION[s]));
    if (eligible.length === 1 || uniquePos.size === 1) assignSlot(player, eligible[0]);
    else setPhase("positioning");
  }

  async function assignSlot(player: Player, slot: RosterSlot) {
    const userId = getOrCreateUserId();
    lastSubmittedPickNumberRef.current = game?.pickNumber ?? null;
    pickInFlightRef.current = true;
    setPhase("opponent_turn");
    setSpinCombo(null);
    setAvailablePlayers([]);
    setSelectedPlayer(null);
    // Optimistically update roster and clear spin so the UI reflects the pick instantly
    if (game && myRole) {
      const ps = game[myRole];
      if (ps) setGame({
        ...game,
        currentSpin: null,
        [myRole]: { ...ps, roster: { ...ps.roster, [slot]: player } },
      });
    }
    try {
      await fetch(`/api/game/${roomCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick", playerId: userId, playerName: player.name, slot }),
      });
    } finally {
      pickInFlightRef.current = false;
      const pending = pendingStateRef.current;
      if (pending) {
        pendingStateRef.current = null;
        applyGameState(pending, myRoleRef.current);
      }
    }
  }

  async function doReady() {
    const userId = getOrCreateUserId();
    await fetch(`/api/game/${roomCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ready", playerId: userId }),
    });
    // Poll will pick up the updated ready flags
  }

  async function doRematch() {
    if (game?.botRole) {
      // Bot rematch: instant, no coordination needed
      const res = await fetch("/api/game/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: getOrCreateUserId() }),
      });
      const data = await res.json();
      if (data.roomCode) router.push(`/versus/${data.roomCode}`);
      return;
    }
    setRematchStatus("requesting");
    await fetch(`/api/game/${roomCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rematch_request", playerId: getOrCreateUserId() }),
    });
  }

  async function doAcceptRematch() {
    const res = await fetch(`/api/game/${roomCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rematch_accept", playerId: getOrCreateUserId() }),
    });
    const data = await res.json();
    if (data.roomCode) router.push(`/versus/${data.roomCode}`);
  }

  function doDeclineRematch() {
    setRematchStatus("idle");
  }

  function shareRoomCode() {
    const url = `${window.location.origin}/versus/${roomCode}`;
    const text = `See if you can draft a better team than me and beat me in a best of seven 🏒\n${url}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function LobbyLink() {
    const isActive = game && game.status !== "complete" && game.status !== "abandoned";
    async function handleClick(e: React.MouseEvent) {
      if (!isActive) return;
      e.preventDefault();
      if (confirm("Leave this game? You won't be able to re-enter.")) {
        const userId = getOrCreateUserId();
        await fetch(`/api/game/${roomCode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "forfeit", playerId: userId }),
        }).catch(() => {});
        router.push("/versus");
      }
    }
    return (
      <a
        href="/versus"
        onClick={handleClick}
        className="text-xs text-muted-foreground/60 hover:text-muted-foreground mb-3 transition-colors self-start"
      >
        ← Lobby
      </a>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-muted-foreground">{fetchError}</p>
        <a href="/versus" className="text-xs text-blue-400 hover:text-blue-300 underline">Back to lobby</a>
      </div>
    );
  }

  if (phase === "loading" || !game) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 w-full">
        <LobbyLink />
        <p className="text-muted-foreground animate-pulse">Loading game…</p>
      </div>
    );
  }

  if (phase === "complete" && game.status === "abandoned") {
    const iForfeited = game.abandonedBy === myRole;
    const timedOut = iForfeited && game.abandonedReason === "timeout";
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm mx-auto text-center py-12">
        {iForfeited ? (
          <p className="text-xl font-black text-muted-foreground">
            {timedOut ? "You ran out of time." : "You left the game."}
          </p>
        ) : (
          <>
            <div>
              <p className="text-2xl font-black text-foreground">Opponent left the game.</p>
              <p className="text-sm text-muted-foreground mt-1">Counts as a win for you.</p>
            </div>
            {playerStats && (
              <p className="text-sm font-bold tabular-nums">
                {playerStats.wins}W – {playerStats.losses}L
                {playerStats.rank !== null && (
                  <span className="text-xs font-normal text-muted-foreground/70 ml-2">
                    · Rank #{playerStats.rank.toLocaleString()} of {playerStats.totalPlayers.toLocaleString()}
                  </span>
                )}
              </p>
            )}
          </>
        )}
        <div className="flex flex-col gap-2">
          <a
            href="/versus"
            className="inline-flex items-center justify-center rounded-md bg-orange-500 hover:bg-orange-400 active:bg-orange-600 active:scale-95 text-white font-bold px-4 py-3 text-sm transition-colors"
          >
            Play Again
          </a>
          {iForfeited && (
            <a href="/versus" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              Back to Lobby
            </a>
          )}
        </div>
      </div>
    );
  }

  if (phase === "complete" && game.result) {
    return (
      <div className="flex flex-col w-full">
        <LobbyLink />
      <SeriesResultScreen
        result={game.result}
        myRole={myRole}
        roomCode={roomCode}
        vsBot={!!game.botRole}
        rematchStatus={rematchStatus}
        rematchCountdown={rematchCountdown}
        playerStats={playerStats}
        onRematch={doRematch}
        onAcceptRematch={doAcceptRematch}
        onDeclineRematch={doDeclineRematch}
      />
      </div>
    );
  }

  // p2 is non-null whenever myRole is "p2" (we joined successfully)
  const getPS = (g: GameSession, r: "p1" | "p2") => (r === "p1" ? g.p1 : g.p2!);

  function CountdownBadge({ max }: { max: number }) {
    if (secondsLeft === null) return null;
    const display = Math.min(secondsLeft, max);
    return (
      <span className={`text-xs tabular-nums font-semibold ${display <= 3 ? "text-red-400 animate-pulse" : "text-yellow-400"}`}>
        {display}s
      </span>
    );
  }

  const myState = myRole ? getPS(game, myRole) : null;
  const canRespinTeam = !!myState && !myState.respinTeamUsed && !!spinCombo;
  const canRespinDecade = !!myState && !myState.respinDecadeUsed && !!spinCombo;

  // Dual roster panels
  const myRoster = myRole ? getPS(game, myRole).roster : game.p1.roster;
  const theirRoster = myRole === "p1" ? game.p2?.roster : myRole === "p2" ? game.p1.roster : null;
  const statsMode = game.statsMode;
  const opponentIsBot = !!game.botRole && game.botRole !== myRole;

  // ── Waiting for opponent ──────────────────────────────────────────────────
  if (phase === "waiting_for_opponent") {
    return (
      <div className="flex flex-col gap-6 w-full max-w-lg mx-auto">
        <LobbyLink />
        <div className="text-center">
          <p className="text-xl font-bold">Room Created</p>
          <p className="text-muted-foreground text-sm mt-1">Share this code with your opponent:</p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="text-6xl font-black tracking-widest text-foreground bg-card border border-border rounded-xl px-8 py-5">
            {roomCode}
          </div>
          <Button onClick={shareRoomCode} variant="outline" className="w-full max-w-xs">
            {copied ? "✓ Link copied!" : "Copy Invite Link"}
          </Button>
        </div>
        <div className="flex items-center gap-2 justify-center">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          <p className="text-sm text-muted-foreground">Waiting for opponent to join…</p>
        </div>
        <div className="flex flex-col gap-2 mt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Your Roster</p>
          <RosterPanel roster={myRoster} mode={game.statsMode} label="Your Team" highlight />
        </div>
      </div>
    );
  }

  // ── Ready check ───────────────────────────────────────────────────────────
  if (phase === "ready_check" && myRole) {
    const myReady = getPS(game, myRole).ready;
    const theirReady = myRole === "p1" ? (game.p2?.ready ?? false) : game.p1.ready;
    const deadlineActive = !!game.readyDeadline;
    const timedOut = deadlineActive && secondsLeft === 0;

    return (
      <div className="flex flex-col gap-6 w-full max-w-sm mx-auto text-center">
        <LobbyLink />
        <div>
          <p className="text-xl font-black">Your friend accepted the challenge!</p>
          <p className="text-muted-foreground text-sm mt-1">
            Both players need to confirm they&apos;re ready.
          </p>
        </div>

        <div className="flex gap-4 justify-center">
          <div className={`flex flex-col items-center gap-1 px-5 py-3 rounded-lg border ${myReady ? "border-green-500/40 bg-green-500/5" : "border-border"}`}>
            <span className="text-xs text-muted-foreground">You</span>
            <span className={`text-sm font-bold ${myReady ? "text-green-400" : "text-muted-foreground/60"}`}>
              {myReady ? "Ready ✓" : "Not ready"}
            </span>
          </div>
          <div className={`flex flex-col items-center gap-1 px-5 py-3 rounded-lg border ${theirReady ? "border-green-500/40 bg-green-500/5" : "border-border"}`}>
            <span className="text-xs text-muted-foreground">Opponent</span>
            <span className={`text-sm font-bold ${theirReady ? "text-green-400" : "text-muted-foreground/60"}`}>
              {theirReady ? "Ready ✓" : "Not ready"}
            </span>
          </div>
        </div>

        {deadlineActive && !timedOut && (
          <p className="text-xs text-muted-foreground">
            {theirReady ? "You have" : "Your opponent has"}{" "}
            <span className={`tabular-nums font-bold ${(secondsLeft ?? 30) <= 10 ? "text-yellow-400" : "text-foreground"}`}>
              {secondsLeft ?? 30}s
            </span>{" "}
            to ready up
          </p>
        )}

        {timedOut && (
          <p className="text-xs text-yellow-400">
            Time&apos;s up — click Ready to try again
          </p>
        )}

        {!myReady ? (
          <Button
            onClick={doReady}
            className="w-full bg-green-600 hover:bg-green-500 text-white font-black py-6 text-lg"
          >
            Ready to Play
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground animate-pulse">
            Waiting for your opponent…
          </p>
        )}
      </div>
    );
  }

  // ── Positioning ───────────────────────────────────────────────────────────
  if (phase === "positioning" && selectedPlayer && myRole) {
    const eligible = getEligibleSlots(selectedPlayer, getPS(game, myRole).roster);
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        <LobbyLink />
        <div className="flex gap-3">
          <RosterPanel roster={myRoster} mode={game.statsMode} label="Your Team" highlight />
          {theirRoster && <RosterPanel roster={theirRoster} mode={game.statsMode} label="Opponent" />}
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest">Choose position for {selectedPlayer.name}</p>
        <div className="flex flex-col gap-2">
          {eligible.map((slot) => (
            <button
              key={slot}
              onClick={() => assignSlot(selectedPlayer, slot)}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-blue-500/60 hover:bg-blue-500/5 transition-all"
            >
              <span className="font-medium">{ROSTER_SLOTS.find((s) => s.slot === slot)?.label}</span>
              <span className={`text-xs px-2 py-1 rounded border ${POSITION_COLORS[SLOT_POSITION[slot]]}`}>
                {SLOT_POSITION[slot]}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Picking ───────────────────────────────────────────────────────────────
  if ((phase === "picking" || phase === "spinning") && spinCombo && myRole) {
    const openPos = getOpenPositions(getPS(game, myRole).roster);
    const undrafted = availablePlayers.filter((p) => !game.draftedNames.includes(p.name));
    const { fwd, def, goa } = groupPlayers(undrafted, game.statsMode);
    const isAnimating = phase === "spinning";

    function PlayerColumn({ title, players }: { title: string; players: Player[] }) {

      return (
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <p className="text-xs text-muted-foreground/60 uppercase tracking-widest font-semibold px-1 mb-1">{title}</p>
          {players.length === 0 && <p className="text-xs text-muted-foreground/30 px-1">—</p>}
          {players.map((p) => {
            const eligible = p.position.some((pos) => openPos.has(pos as Position));
            return (
              <button
                key={p.name}
                onClick={() => eligible && !isAnimating && selectPlayer(p)}
                disabled={!eligible || isAnimating}
                className={`flex flex-col px-2 py-2 rounded-lg border transition-all text-left group w-full ${
                  eligible && !isAnimating
                    ? "border-border hover:border-blue-500/60 hover:bg-blue-500/5 active:scale-95 active:bg-blue-500/15 active:border-blue-500/60 cursor-pointer"
                    : "border-border/20 opacity-30 cursor-not-allowed"
                }`}
              >
                <span className="font-semibold text-xs leading-tight group-hover:text-blue-300 transition-colors">
                  {p.name}
                </span>
                <span className="text-xs text-muted-foreground/70 leading-tight mt-0.5">
                  {statLine(p, statsMode)}
                </span>
                <div className="flex gap-1 mt-0.5">
                  {p.position.map((pos) => (
                    <span key={pos} className={`text-xs px-1 py-0 rounded border leading-4 ${POSITION_COLORS[pos as Position]}`}>
                      {pos}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
        <LobbyLink />
        <div className="flex gap-3">
          <RosterPanel roster={myRoster} mode={game.statsMode} label="Your Team" highlight />
          {theirRoster && <RosterPanel roster={theirRoster} mode={game.statsMode} label="Opponent" />}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">
                Pick {game.pickNumber + 1} of 12
              </p>
              {!isAnimating && <CountdownBadge max={20} />}
            </div>
            {!isAnimating && (
              <div className="flex gap-2">
                <button
                  onClick={() => doRespin("team")}
                  disabled={!canRespinTeam}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    canRespinTeam
                      ? "border-border text-muted-foreground hover:border-blue-500/60 hover:text-blue-400 active:border-blue-500/60 active:bg-blue-500/15 active:text-blue-400"
                      : "border-border/30 text-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  Respin Team {myState?.respinTeamUsed ? "✓" : ""}
                </button>
                <button
                  onClick={() => doRespin("decade")}
                  disabled={!canRespinDecade}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    canRespinDecade
                      ? "border-border text-muted-foreground hover:border-blue-500/60 hover:text-blue-400 active:border-blue-500/60 active:bg-blue-500/15 active:text-blue-400"
                      : "border-border/30 text-muted-foreground/30 cursor-not-allowed"
                  }`}
                >
                  Respin Era {myState?.respinDecadeUsed ? "✓" : ""}
                </button>
              </div>
            )}
          </div>
          <p className={`text-base font-semibold mb-3 ${isAnimating ? "text-muted-foreground animate-pulse" : "text-foreground"}`}>
            {displayedDecade} · {displayedTeam}
          </p>
          {!isAnimating && (
            <div className="flex gap-3">
              <PlayerColumn title="Forwards" players={fwd} />
              <PlayerColumn title="Defence" players={def} />
              <PlayerColumn title="Goalies" players={goa} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── My turn (pre-spin) ────────────────────────────────────────────────────
  if (phase === "my_turn") {
    const pickNum = game.pickNumber + 1;
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        <LobbyLink />
        <div className="flex gap-3">
          <RosterPanel roster={myRoster} mode={game.statsMode} label="Your Team" highlight />
          {theirRoster && <RosterPanel roster={theirRoster} mode={game.statsMode} label="Opponent" />}
        </div>
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs text-muted-foreground">Pick {pickNum} of 12 · Your turn</p>
          <CountdownBadge max={10} />
        </div>
        <div className="flex gap-4 justify-center mt-2">
          <div className="flex-1">
            <div className="w-full py-5 rounded-xl border-4 border-orange-500 bg-card flex flex-col items-center justify-center shadow-lg">
              <p className="text-xs font-bold text-orange-500 tracking-widest uppercase mb-1">Team</p>
              <p className="text-2xl font-black text-foreground">???</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="w-full py-5 rounded-xl border-4 border-purple-500 bg-card flex flex-col items-center justify-center shadow-lg">
              <p className="text-xs font-bold text-purple-400 tracking-widest uppercase mb-1">Era</p>
              <p className="text-2xl font-black text-foreground">???</p>
            </div>
          </div>
        </div>
        <Button
          onClick={doSpin}
          className="w-full bg-orange-500 hover:bg-orange-400 active:bg-orange-600 active:scale-95 text-white font-black py-6 text-lg tracking-widest uppercase transition-transform"
        >
          Spin
        </Button>
      </div>
    );
  }

  // ── Spinning (API in flight, combo not yet received) ─────────────────────────
  if (phase === "spinning" && !spinCombo) {
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        <LobbyLink />
        <div className="flex gap-3">
          <RosterPanel roster={myRoster} mode={statsMode} label="Your Team" highlight />
          {theirRoster && <RosterPanel roster={theirRoster} mode={statsMode} label="Opponent" />}
        </div>
        <div className="flex gap-4 justify-center mt-2">
          <div className="flex-1">
            <div className="w-full py-5 rounded-xl border-4 border-orange-500 bg-card flex flex-col items-center justify-center shadow-lg">
              <p className="text-xs font-bold text-orange-500 tracking-widest uppercase mb-1">Team</p>
              <p className="text-2xl font-black text-muted-foreground animate-pulse">···</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="w-full py-5 rounded-xl border-4 border-purple-500 bg-card flex flex-col items-center justify-center shadow-lg">
              <p className="text-xs font-bold text-purple-400 tracking-widest uppercase mb-1">Era</p>
              <p className="text-2xl font-black text-muted-foreground animate-pulse">···</p>
            </div>
          </div>
        </div>
        <p className="text-sm font-semibold text-muted-foreground tracking-widest uppercase text-center animate-pulse">
          Spinning…
        </p>
      </div>
    );
  }

  // ── Opponent's turn ───────────────────────────────────────────────────────
  const opponentSpin = game.currentSpin;
  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      <LobbyLink />
      <div className="flex gap-3">
        <RosterPanel roster={myRoster} mode={game.statsMode} label="Your Team" highlight />
        {theirRoster && (
          <RosterPanel roster={theirRoster} mode={game.statsMode} label={opponentIsBot ? "Bot" : "Opponent"} />
        )}
      </div>
      <div className="text-center py-6">
        <div className="w-3 h-3 rounded-full bg-orange-400 animate-pulse mx-auto mb-3" />
        {opponentIsBot ? (
          <p className="text-sm text-muted-foreground">Bot is drafting…</p>
        ) : opponentSpin ? (
          <>
            <p className="text-sm text-muted-foreground">Opponent is choosing from</p>
            <p className="font-semibold mt-1">{opponentSpin.decade} · {opponentSpin.team}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Waiting for opponent to spin…</p>
        )}
        {!opponentIsBot && game.lastRespin && (
          <p className="text-xs text-yellow-400/80 mt-2">
            Opponent used their Respin {game.lastRespin === "team" ? "Team" : "Era"}
          </p>
        )}
      </div>
    </div>
  );
}
