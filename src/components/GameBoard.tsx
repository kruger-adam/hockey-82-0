"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getAllTeamDecadeCombos,
  getTeamsForDecade,
  getDecadesForTeam,
  getPlayersForTeamDecade,
  type Player,
  type Position,
} from "@/lib/players";
import {
  simulateSeason,
  isRosterComplete,
  ROSTER_SLOTS,
  type Roster,
  type RosterSlot,
  type SimulationResult,
} from "@/lib/simulation";

type Phase = "start" | "spinning" | "picking" | "positioning" | "ready" | "simulating" | "result";

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

function getRecordColor(wins: number): string {
  if (wins === 82) return "text-yellow-400";
  if (wins >= 65) return "text-green-400";
  if (wins >= 50) return "text-blue-400";
  if (wins >= 41) return "text-muted-foreground";
  return "text-red-400";
}

// Per-game stat helpers (goals/assists stored as per-82)
function gPerGame(p: Player)   { return ((p.goals   ?? 0) / 82); }
function aPerGame(p: Player)   { return ((p.assists ?? 0) / 82); }
function ptsPerGame(p: Player) { return gPerGame(p) + aPerGame(p); }

function skaterStatLine(p: Player): string {
  return `${gPerGame(p).toFixed(2)} G/gm · ${aPerGame(p).toFixed(2)} A/gm · ${ptsPerGame(p).toFixed(2)} PTS/gm`;
}

function goalieStatLine(p: Player): string {
  return `.${Math.round((p.savePercentage ?? 0) * 1000)} SV% · ${p.gaa?.toFixed(2)} GAA`;
}

function statLine(p: Player): string {
  return p.position.includes("G") ? goalieStatLine(p) : skaterStatLine(p);
}

function getEligibleSlots(player: Player, roster: Roster): RosterSlot[] {
  return ROSTER_SLOTS.filter(
    ({ slot, positions }) =>
      roster[slot] === null && player.position.some((p) => positions.includes(p))
  ).map((s) => s.slot);
}

function getOpenPositions(roster: Roster): Set<Position> {
  const open = new Set<Position>();
  for (const { slot, positions } of ROSTER_SLOTS) {
    if (roster[slot] === null) positions.forEach((p) => open.add(p));
  }
  return open;
}

function isDrafted(player: Player, roster: Roster): boolean {
  return Object.values(roster).some((p) => p?.name === player.name);
}

function pickRandomCombo(
  roster: Roster,
  exclude?: { decade: string; team: string }
): { decade: string; team: string } | null {
  const openPos = getOpenPositions(roster);
  const eligible = getAllTeamDecadeCombos().filter(
    ({ decade, team }) =>
      !(exclude && exclude.decade === decade && exclude.team === team) &&
      getPlayersForTeamDecade(decade, team).some(
        (p) => !isDrafted(p, roster) && p.position.some((pos) => openPos.has(pos))
      )
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

function pickRandomDecadeForTeam(
  team: string,
  roster: Roster,
  currentDecade: string
): string | null {
  const openPos = getOpenPositions(roster);
  const eligible = getDecadesForTeam(team).filter(
    (decade) =>
      decade !== currentDecade &&
      getPlayersForTeamDecade(decade, team).some(
        (p) => !isDrafted(p, roster) && p.position.some((pos) => openPos.has(pos))
      )
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

function pickRandomTeamInDecade(decade: string, roster: Roster, excludeTeam: string): string | null {
  const openPos = getOpenPositions(roster);
  const eligible = getTeamsForDecade(decade).filter(
    (team) =>
      team !== excludeTeam &&
      getPlayersForTeamDecade(decade, team).some(
        (p) => !isDrafted(p, roster) && p.position.some((pos) => openPos.has(pos))
      )
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// Group and sort players into forwards / D / goalies
function groupPlayers(players: Player[]) {
  const forwards  = players.filter(p => p.position.some(pos => ["C","LW","RW"].includes(pos)) && !p.position.includes("G")).sort((a,b) => ptsPerGame(b) - ptsPerGame(a));
  const defense   = players.filter(p => p.position.includes("D") && !p.position.some(pos => ["C","LW","RW"].includes(pos))).sort((a,b) => ptsPerGame(b) - ptsPerGame(a));
  const goalies   = players.filter(p => p.position.includes("G")).sort((a,b) => (b.savePercentage ?? 0) - (a.savePercentage ?? 0));
  return { forwards, defense, goalies };
}

const EMPTY_ROSTER: Roster = { C: null, LW: null, RW: null, D1: null, D2: null, G: null };

export default function GameBoard() {
  const [phase, setPhase]               = useState<Phase>("start");
  const [roster, setRoster]             = useState<Roster>(EMPTY_ROSTER);
  const [round, setRound]               = useState(1);
  const [spunCombo, setSpunCombo]       = useState<{ decade: string; team: string } | null>(null);
  const [availablePlayers, setAvailable]= useState<Player[]>([]);
  const [selectedPlayer, setSelected]   = useState<Player | null>(null);
  const [result, setResult]             = useState<SimulationResult | null>(null);
  const [decadeRespinUsed, setDecadeRespinUsed] = useState(false);
  const [teamRespinUsed,   setTeamRespinUsed]   = useState(false);

  const filledCount = Object.values(roster).filter(Boolean).length;

  function spin(currentRoster = roster) {
    setPhase("spinning");
    setTimeout(() => {
      const combo = pickRandomCombo(currentRoster);
      if (!combo) return;
      const openPos = getOpenPositions(currentRoster);
      const players = getPlayersForTeamDecade(combo.decade, combo.team).filter(
        (p) => !isDrafted(p, currentRoster)
      );
      // Mark ineligibility but include all — handled in render
      setSpunCombo(combo);
      setAvailable(players);
      setPhase("picking");
    }, 500);
  }

  function respinDecade() {
    if (decadeRespinUsed || !spunCombo) return;
    setDecadeRespinUsed(true);
    setPhase("spinning");
    setTimeout(() => {
      const newDecade = pickRandomDecadeForTeam(spunCombo.team, roster, spunCombo.decade);
      if (!newDecade) return;
      const combo = { decade: newDecade, team: spunCombo.team };
      setSpunCombo(combo);
      setAvailable(getPlayersForTeamDecade(newDecade, spunCombo.team).filter(p => !isDrafted(p, roster)));
      setPhase("picking");
    }, 500);
  }

  function respinTeam() {
    if (teamRespinUsed || !spunCombo) return;
    setTeamRespinUsed(true);
    setPhase("spinning");
    setTimeout(() => {
      const newTeam = pickRandomTeamInDecade(spunCombo.decade, roster, spunCombo.team);
      if (!newTeam) return;
      const combo = { decade: spunCombo.decade, team: newTeam };
      setSpunCombo(combo);
      setAvailable(getPlayersForTeamDecade(combo.decade, newTeam).filter(p => !isDrafted(p, roster)));
      setPhase("picking");
    }, 500);
  }

  function selectPlayer(player: Player) {
    const eligible = getEligibleSlots(player, roster);
    if (eligible.length === 0) return;
    setSelected(player);
    // Auto-assign if only one slot, or all eligible slots are the same position (e.g. D1/D2)
    const uniquePositions = new Set(eligible.map((s) => SLOT_POSITION[s]));
    if (eligible.length === 1 || uniquePositions.size === 1) assignSlot(player, eligible[0]);
    else setPhase("positioning");
  }

  function assignSlot(player: Player, slot: RosterSlot) {
    const next = { ...roster, [slot]: player };
    setRoster(next);
    setSelected(null);
    setAvailable([]);
    setSpunCombo(null);
    setRound((r) => r + 1);
    setPhase(isRosterComplete(next) ? "ready" : "start");
  }

  async function simulate() {
    setPhase("simulating");
    await new Promise((r) => setTimeout(r, 900));
    setResult(simulateSeason(roster));
    setPhase("result");
  }

  function reset() {
    setPhase("start"); setRoster(EMPTY_ROSTER); setRound(1);
    setSpunCombo(null); setSelected(null); setResult(null);
    setDecadeRespinUsed(false); setTeamRespinUsed(false);
  }

  // ── RESULT ────────────────────────────────────────────────────
  if (phase === "result" && result) {
    const message =
      result.wins === 82 ? "PERFECT SEASON — you did it!" :
      result.wins >= 72 ? "Dynasty-level team. Cup contenders every year." :
      result.wins >= 60 ? "Legitimate Stanley Cup threat." :
      result.wins >= 50 ? "Solid playoff team." :
      result.wins >= 41 ? "Bubble team. Just squeaked in." :
      "Back to the draft board.";
    return (
      <div className="flex flex-col gap-6 w-full max-w-lg mx-auto">
        <div className="text-center">
          <div className={`text-7xl font-black tabular-nums mb-1 ${getRecordColor(result.wins)}`}>{result.record}</div>
          <p className="text-muted-foreground text-sm">{(result.wins/82*100).toFixed(1)}% win rate</p>
          <p className={`mt-2 font-semibold ${getRecordColor(result.wins)}`}>{message}</p>
        </div>
        <Card>
          <CardContent className="pt-4 flex flex-col gap-2">
            {ROSTER_SLOTS.map(({ slot, label }) => {
              const player = roster[slot];
              return (
                <div key={slot} className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide w-16 shrink-0">{label}</span>
                  {player ? (
                    <>
                      <span className="font-medium flex-1">{player.name}</span>
                      <span className="text-xs text-muted-foreground">{statLine(player)}</span>
                    </>
                  ) : <span className="text-muted-foreground/40">Empty</span>}
                </div>
              );
            })}
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-0.5">
          {result.gameLog.map((win, i) => (
            <div key={i} title={`Game ${i+1}: ${win?"W":"L"}`}
              className={`w-3 h-3 rounded-sm ${win ? "bg-green-500" : "bg-red-500/50"}`} />
          ))}
        </div>
        <Button onClick={reset} variant="outline" className="w-full">Try Again</Button>
      </div>
    );
  }

  // ── ROSTER PANEL ──────────────────────────────────────────────
  const rosterPanel = (
    <Card className="w-full">
      <CardContent className="pt-4 flex flex-col gap-2">
        {ROSTER_SLOTS.map(({ slot, label }) => {
          const player = roster[slot];
          return (
            <div key={slot} className={`flex items-center gap-3 px-2 py-1.5 rounded-md text-sm ${!player ? "border border-dashed border-border/40" : ""}`}>
              <span className="text-xs text-muted-foreground uppercase tracking-wide w-16 shrink-0">{label}</span>
              {player ? (
                <>
                  <span className="font-medium flex-1 truncate">{player.name}</span>
                  <span className="text-xs text-muted-foreground/70 shrink-0">{statLine(player)}</span>
                </>
              ) : <span className="text-muted-foreground/30 text-xs">—</span>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  // ── POSITIONING ───────────────────────────────────────────────
  if (phase === "positioning" && selectedPlayer) {
    const eligible = getEligibleSlots(selectedPlayer, roster);
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        {rosterPanel}
        <p className="text-xs text-muted-foreground uppercase tracking-widest">Choose a position for {selectedPlayer.name}</p>
        <div className="flex flex-col gap-2">
          {eligible.map((slot) => (
            <button key={slot} onClick={() => assignSlot(selectedPlayer, slot)}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-blue-500/60 hover:bg-blue-500/5 transition-all text-left">
              <span className="font-medium">{ROSTER_SLOTS.find((s) => s.slot === slot)?.label}</span>
              <span className={`text-xs px-2 py-1 rounded border ${POSITION_COLORS[SLOT_POSITION[slot]]}`}>{SLOT_POSITION[slot]}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── PLAYER COLUMN ────────────────────────────────────────────
  function PlayerColumn({ title, players, openPos, keyStatLabel }: {
    title: string;
    players: Player[];
    openPos: Set<Position>;
    keyStatLabel: string;
  }) {
    return (
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {/* Column header */}
        <div className="flex items-baseline justify-between px-1 mb-1">
          <p className="text-xs text-muted-foreground/60 uppercase tracking-widest font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground/40">{keyStatLabel}</p>
        </div>
        {players.length === 0 && (
          <p className="text-xs text-muted-foreground/30 px-1">—</p>
        )}
        {players.map((player) => {
          const eligible = player.position.some((pos) => openPos.has(pos));
          const isGoalie = player.position.includes("G");
          const keyStat = isGoalie
            ? `.${Math.round((player.savePercentage ?? 0) * 1000)}`
            : ptsPerGame(player).toFixed(2);

          return (
            <button
              key={player.name}
              onClick={() => eligible && selectPlayer(player)}
              disabled={!eligible}
              className={`flex flex-col px-2 py-2 rounded-lg border transition-all text-left group w-full ${
                eligible
                  ? "border-border hover:border-blue-500/60 hover:bg-blue-500/5 cursor-pointer"
                  : "border-border/20 opacity-30 cursor-not-allowed"
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <span className={`font-semibold text-xs leading-tight ${eligible ? "group-hover:text-blue-300 transition-colors" : ""}`}>
                  {player.name}
                </span>
                <span className="text-xs font-bold tabular-nums text-muted-foreground shrink-0 ml-1">
                  {keyStat}
                </span>
              </div>
              <div className="flex gap-1 mt-0.5">
                {player.position.map((pos) => (
                  <span key={pos} className={`text-xs px-1 py-0 rounded border leading-4 ${POSITION_COLORS[pos]}`}>
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

  // ── PICKING ───────────────────────────────────────────────────
  if (phase === "picking" && spunCombo) {
    const openPos = getOpenPositions(roster);
    const undrafted = availablePlayers.filter(p => !isDrafted(p, roster));
    const { forwards, defense, goalies } = groupPlayers(undrafted);
    const canRespinTeam = !teamRespinUsed && pickRandomTeamInDecade(spunCombo.decade, roster, spunCombo.team) !== null;

    return (
      <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
        {rosterPanel}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Round {round} of 6</p>
            <div className="flex gap-2">
              <button onClick={respinTeam} disabled={!canRespinTeam}
                className={`text-xs px-2 py-1 rounded border transition-colors ${canRespinTeam ? "border-border text-muted-foreground hover:border-blue-500/60 hover:text-blue-400" : "border-border/30 text-muted-foreground/30 cursor-not-allowed"}`}>
                Respin Team {teamRespinUsed ? "✓" : ""}
              </button>
              <button onClick={respinDecade} disabled={decadeRespinUsed}
                className={`text-xs px-2 py-1 rounded border transition-colors ${!decadeRespinUsed ? "border-border text-muted-foreground hover:border-blue-500/60 hover:text-blue-400" : "border-border/30 text-muted-foreground/30 cursor-not-allowed"}`}>
                Respin Decade {decadeRespinUsed ? "✓" : ""}
              </button>
            </div>
          </div>
          <p className="text-base font-semibold text-foreground mb-3">{spunCombo.decade} · {spunCombo.team}</p>
          {/* Three columns side by side */}
          <div className="flex gap-3">
            <PlayerColumn title="Forwards" players={forwards} openPos={openPos} keyStatLabel="PTS/gm" />
            <PlayerColumn title="Defence"  players={defense}  openPos={openPos} keyStatLabel="PTS/gm" />
            <PlayerColumn title="Goalies"  players={goalies}  openPos={openPos} keyStatLabel="SV%" />
          </div>
        </div>
      </div>
    );
  }

  // ── SPINNING / SIMULATING ─────────────────────────────────────
  if (phase === "spinning" || phase === "simulating") {
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        {filledCount > 0 && rosterPanel}
        <div className="text-center py-8">
          <p className="text-muted-foreground animate-pulse text-lg">
            {phase === "spinning" ? "Spinning…" : "Simulating 82 games…"}
          </p>
        </div>
      </div>
    );
  }

  // ── READY ─────────────────────────────────────────────────────
  if (phase === "ready") {
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        {rosterPanel}
        <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-6 text-base" onClick={simulate}>
          Simulate 82-Game Season →
        </Button>
      </div>
    );
  }

  // ── START / BETWEEN ROUNDS ────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      {filledCount > 0 && rosterPanel}
      <div className="text-center py-4">
        {filledCount === 0 && (
          <p className="text-muted-foreground mb-6 text-sm">
            You'll get 6 spins — one random NHL franchise per round.<br />
            Each game you get one respin of the decade and one respin of the team.
          </p>
        )}
        {filledCount > 0 && (
          <p className="text-muted-foreground mb-4 text-sm">
            Round {round} of 6 · {6 - filledCount} slot{6 - filledCount !== 1 ? "s" : ""} remaining
          </p>
        )}
        <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-6 text-base" onClick={() => spin()}>
          {filledCount === 0 ? "Spin to Start" : "Spin for Next Player"}
        </Button>
      </div>
    </div>
  );
}
