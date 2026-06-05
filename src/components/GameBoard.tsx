"use client";

import { useState, useRef } from "react";
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

function seasonLabel(year: number): string {
  return `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
}

function skaterStatLine(p: Player, mode: "avg" | "best"): string {
  if (mode === "best" && p.bestGoals != null && p.bestYear != null) {
    return `${p.bestGoals}G · ${p.bestAssists ?? 0}A · ${seasonLabel(p.bestYear)}`;
  }
  return `${gPerGame(p).toFixed(2)} G/gm · ${aPerGame(p).toFixed(2)} A/gm · ${ptsPerGame(p).toFixed(2)} PTS/gm`;
}

function goalieStatLine(p: Player, mode: "avg" | "best"): string {
  if (mode === "best" && p.bestSavePercentage != null && p.bestYear != null) {
    return `.${Math.round(p.bestSavePercentage * 1000)} SV% · ${p.bestGaa?.toFixed(2)} GAA · ${seasonLabel(p.bestYear)}`;
  }
  return `.${Math.round((p.savePercentage ?? 0) * 1000)} SV% · ${p.gaa?.toFixed(2)} GAA`;
}

function statLine(p: Player, mode: "avg" | "best" = "avg"): string {
  return p.position.includes("G") ? goalieStatLine(p, mode) : skaterStatLine(p, mode);
}

function effectiveRating(p: Player, mode: "avg" | "best"): number {
  return mode === "best" ? p.bestRating : p.rating;
}

function effectivePts(p: Player, mode: "avg" | "best"): number {
  if (mode === "best") {
    if (p.position.includes("G")) return p.bestSavePercentage ?? p.savePercentage ?? 0;
    if (p.bestGoals != null && p.bestGP != null)
      return (p.bestGoals + (p.bestAssists ?? 0)) / p.bestGP;
  }
  return ptsPerGame(p);
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
function groupPlayers(players: Player[], mode: "avg" | "best") {
  const forwards  = players.filter(p => p.position.some(pos => ["C","LW","RW"].includes(pos)) && !p.position.includes("G")).sort((a,b) => effectivePts(b, mode) - effectivePts(a, mode));
  const defense   = players.filter(p => p.position.includes("D") && !p.position.some(pos => ["C","LW","RW"].includes(pos))).sort((a,b) => effectivePts(b, mode) - effectivePts(a, mode));
  const goalies   = players.filter(p => p.position.includes("G")).sort((a,b) => effectiveRating(b, mode) - effectiveRating(a, mode));
  return { forwards, defense, goalies };
}

const TEAM_ABBR: Record<string, string> = {
  "Anaheim Ducks": "ANA", "Mighty Ducks of Anaheim": "ANA",
  "Atlanta Thrashers": "ATL", "Atlanta Flames": "ATL",
  "Arizona Coyotes": "ARI", "Phoenix Coyotes": "PHX",
  "Boston Bruins": "BOS", "Buffalo Sabres": "BUF",
  "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR",
  "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL",
  "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL",
  "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM",
  "Florida Panthers": "FLA", "Hartford Whalers": "HFD",
  "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN",
  "Minnesota North Stars": "MIN", "Montreal Canadiens": "MTL",
  "Nashville Predators": "NSH", "New Jersey Devils": "NJD",
  "New York Islanders": "NYI", "New York Rangers": "NYR",
  "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI",
  "Pittsburgh Penguins": "PIT", "Quebec Nordiques": "QUE",
  "San Jose Sharks": "SJS", "Seattle Kraken": "SEA",
  "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL",
  "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA",
  "Vancouver Canucks": "VAN", "Vegas Golden Knights": "VGK",
  "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
  "Kansas City Scouts": "KCS", "Cleveland Barons": "CLE",
};

function teamAbbr(team: string): string {
  return TEAM_ABBR[team] ?? team.substring(0, 3).toUpperCase();
}

function decadeShort(decade: string): string {
  const m = decade.match(/\d{2}(\d{2})s/);
  return m ? `${m[1]}'s` : decade;
}

const EMPTY_ROSTER: Roster = { C: null, LW: null, RW: null, D1: null, D2: null, G: null };

function getOrCreateUserId(): string {
  try {
    let id = localStorage.getItem("hockey-user-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("hockey-user-id", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

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
  const [statsMode, setStatsMode] = useState<"avg" | "best">("avg");
  const [displayedTeam,    setDisplayedTeam]    = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [displayedDecade,  setDisplayedDecade]  = useState<string | null>(null);
  const [lockedCard,       setLockedCard]        = useState<"team" | "decade" | null>(null);
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filledCount = Object.values(roster).filter(Boolean).length;

  function runSpinAnimation(
    finalCombo: { decade: string; team: string },
    locked: "team" | "decade" | null,
    afterSettle: () => void
  ) {
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    setLockedCard(locked);
    if (locked === "team")   setDisplayedTeam(finalCombo.team);
    if (locked === "decade") setDisplayedDecade(finalCombo.decade);
    const allCombos = getAllTeamDecadeCombos();
    let count = 0;
    const total = 22;
    spinIntervalRef.current = setInterval(() => {
      const r = allCombos[Math.floor(Math.random() * allCombos.length)];
      if (locked !== "team")   setDisplayedTeam(r.team);
      if (locked !== "decade") setDisplayedDecade(r.decade);
      count++;
      if (count >= total) {
        clearInterval(spinIntervalRef.current!);
        setDisplayedTeam(finalCombo.team);
        setDisplayedDecade(finalCombo.decade);
        setLockedCard(null);
        afterSettle();
      }
    }, 80);
  }

  function spin(currentRoster = roster) {
    const combo = pickRandomCombo(currentRoster);
    if (!combo) return;
    setPhase("spinning");
    runSpinAnimation(combo, null, () => {
      const players = getPlayersForTeamDecade(combo.decade, combo.team).filter(
        (p) => !isDrafted(p, currentRoster)
      );
      setSpunCombo(combo);
      setAvailable(players);
      setPhase("picking");
    });
  }

  function respinDecade() {
    if (decadeRespinUsed || !spunCombo) return;
    setDecadeRespinUsed(true);
    const newDecade = pickRandomDecadeForTeam(spunCombo.team, roster, spunCombo.decade);
    if (!newDecade) return;
    const combo = { decade: newDecade, team: spunCombo.team };
    setPhase("spinning");
    runSpinAnimation(combo, "team", () => {
      setSpunCombo(combo);
      setAvailable(getPlayersForTeamDecade(newDecade, spunCombo.team).filter(p => !isDrafted(p, roster)));
      setPhase("picking");
    });
  }

  function respinTeam() {
    if (teamRespinUsed || !spunCombo) return;
    setTeamRespinUsed(true);
    const newTeam = pickRandomTeamInDecade(spunCombo.decade, roster, spunCombo.team);
    if (!newTeam) return;
    const combo = { decade: spunCombo.decade, team: newTeam };
    setPhase("spinning");
    runSpinAnimation(combo, "decade", () => {
      setSpunCombo(combo);
      setAvailable(getPlayersForTeamDecade(combo.decade, newTeam).filter(p => !isDrafted(p, roster)));
      setPhase("picking");
    });
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
    const result = simulateSeason(roster, statsMode);
    setResult(result);
    setPhase("result");

    // Save to local history
    try {
      const entry = { wins: result.wins, losses: result.losses, roster, mode: statsMode, playedAt: new Date().toISOString() };
      const existing = JSON.parse(localStorage.getItem("hockey-history") ?? "[]");
      existing.unshift(entry);
      localStorage.setItem("hockey-history", JSON.stringify(existing));
    } catch {}

    fetch("/api/log-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wins: result.wins, losses: result.losses, roster, mode: statsMode, userId: getOrCreateUserId() }),
    }).catch(() => {});
  }

  function reset() {
    setPhase("start"); setRoster(EMPTY_ROSTER); setRound(1);
    setSpunCombo(null); setSelected(null); setResult(null);
    setDecadeRespinUsed(false); setTeamRespinUsed(false);
  }

  // ── RESULT ────────────────────────────────────────────────────
  function buildShareText(): string {
    const SHORT_TEAM: Record<string, string> = {
      "Boston Bruins": "Bruins", "Chicago Blackhawks": "Blackhawks", "Detroit Red Wings": "Red Wings",
      "Montreal Canadiens": "Canadiens", "New York Rangers": "NY Rangers", "Toronto Maple Leafs": "Maple Leafs",
      "Anaheim Ducks": "Ducks", "Buffalo Sabres": "Sabres", "Carolina Hurricanes": "Hurricanes",
      "Columbus Blue Jackets": "Blue Jackets", "Calgary Flames": "Flames", "Colorado Avalanche": "Avalanche",
      "Dallas Stars": "Stars", "Edmonton Oilers": "Oilers", "Florida Panthers": "Panthers",
      "Los Angeles Kings": "LA Kings", "Minnesota Wild": "Wild", "New Jersey Devils": "NJ Devils",
      "Nashville Predators": "Predators", "New York Islanders": "NY Islanders", "Ottawa Senators": "Senators",
      "Philadelphia Flyers": "Flyers", "Pittsburgh Penguins": "Penguins", "Seattle Kraken": "Kraken",
      "San Jose Sharks": "Sharks", "St. Louis Blues": "Blues", "Tampa Bay Lightning": "TB Lightning",
      "Utah Hockey Club": "Utah HC", "Vancouver Canucks": "Canucks", "Vegas Golden Knights": "Golden Knights",
      "Washington Capitals": "Capitals", "Winnipeg Jets": "Jets", "Atlanta Thrashers": "Thrashers",
      "Hartford Whalers": "Whalers", "Minnesota North Stars": "North Stars", "Quebec Nordiques": "Nordiques",
      "Atlanta Flames": "Atl. Flames", "Winnipeg Jets (Orig)": "Jets (Orig)",
    };
    const slotLabels: Record<string, string> = { C: "C", LW: "LW", RW: "RW", D1: "D", D2: "D", G: "G" };
    const lines = ROSTER_SLOTS.map(({ slot }) => {
      const p = roster[slot];
      if (!p) return null;
      const team = SHORT_TEAM[p.team] ?? p.team;
      return `${slotLabels[slot]}: ${p.name} (${team} · ${p.decade})`;
    }).filter(Boolean);
    return `🏒 Hockey 82-0 — ${result!.record}\n\n${lines.join("\n")}\n\nCan you beat it? → 82and0hockey.com`;
  }

  function handleShare() {
    navigator.clipboard.writeText(buildShareText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (phase === "result" && result) {
    const message =
      result.wins === 82 ? "PERFECT SEASON — you did it!" :
      result.wins >= 72 ? "Dynasty-level team. Cup contenders every year." :
      result.wins >= 60 ? "Legitimate Stanley Cup threat." :
      result.wins >= 50 ? "Solid playoff team." :
      result.wins >= 41 ? "Bubble team. Just squeaked in." :
      "Back to the draft board.";

    const winCounts = Array(83).fill(0) as number[];
    try {
      const raw = localStorage.getItem("hockey-history");
      if (raw) {
        const entries = JSON.parse(raw) as { wins: number }[];
        for (const e of entries) {
          if (typeof e.wins === "number" && e.wins >= 0 && e.wins <= 82) winCounts[e.wins]++;
        }
      }
    } catch {}
    const unlockedCount = winCounts.filter(c => c > 0).length;
    const isNewRecord = winCounts[result.wins] === 1;

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
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium">{player.name}</span>
                      <span className="text-xs text-muted-foreground/70">{statLine(player, statsMode)}</span>
                      <span className="text-xs text-muted-foreground/40">{player.decade} · {player.team}</span>
                    </div>
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

        {/* Records grid */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Season Records</p>
            <p className="text-xs text-muted-foreground">{unlockedCount} / 83 unlocked</p>
          </div>
          {isNewRecord && (
            <p className="text-xs font-semibold text-yellow-400">✦ New record unlocked!</p>
          )}
          <div className="grid grid-cols-9 gap-1">
            {winCounts.map((count, wins) => {
              const isCurrent = wins === result.wins;
              const achieved = count > 0;
              const tierColor = wins === 82
                ? "border-yellow-400/60 text-yellow-400"
                : wins >= 65
                ? "border-green-500/50 text-green-400"
                : wins >= 50
                ? "border-blue-500/50 text-blue-400"
                : wins >= 41
                ? "border-border/60 text-muted-foreground"
                : "border-red-500/30 text-red-400";
              return (
                <div
                  key={wins}
                  title={`${wins}-${82 - wins}: ${count}×`}
                  className={`flex flex-col items-center justify-center rounded aspect-square border
                    ${achieved ? tierColor : "border-border/20 text-muted-foreground/20"}
                    ${isCurrent ? "ring-2 ring-white/40 bg-white/5" : ""}
                  `}
                >
                  <span className="font-black tabular-nums leading-none text-sm">
                    {achieved ? count : "·"}
                  </span>
                  <span className="text-[8px] leading-none opacity-40 mt-0.5">{wins}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3">
          <Button onClick={reset} variant="outline" className="flex-1">Try Again</Button>
          <a href="/history" className="flex-1 inline-flex items-center justify-center rounded-md border border-border bg-transparent px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
            View History
          </a>
        </div>
        <div className="relative">
          <Button onClick={handleShare} variant="outline" className="w-full">
            {copied ? "✓ Copied to clipboard!" : "Share Result"}
          </Button>
        </div>
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
                <div className="flex flex-col min-w-0">
                  <span className="font-medium">{player.name}</span>
                  <span className="text-xs text-muted-foreground/70">{statLine(player, statsMode)}</span>
                  <span className="text-xs text-muted-foreground/40">{player.decade} · {player.team}</span>
                </div>
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
  function PlayerColumn({ title, players, openPos, mode }: {
    title: string;
    players: Player[];
    openPos: Set<Position>;
    mode: "avg" | "best";
  }) {
    const keyStatLabel = mode === "best" ? "Season" : (title === "Goalies" ? "SV%" : "PTS/gm");
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
          const keyStat = mode === "best"
            ? (player.bestYear ? seasonLabel(player.bestYear) : "—")
            : isGoalie
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
              </div>
              <span className="text-xs text-muted-foreground/70 leading-tight mt-0.5">
                {statLine(player, mode)}
              </span>
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
    const { forwards, defense, goalies } = groupPlayers(undrafted, statsMode);
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
            <PlayerColumn title="Forwards" players={forwards} openPos={openPos} mode={statsMode} />
            <PlayerColumn title="Defence"  players={defense}  openPos={openPos} mode={statsMode} />
            <PlayerColumn title="Goalies"  players={goalies}  openPos={openPos} mode={statsMode} />
          </div>
        </div>
      </div>
    );
  }

  // ── SIMULATING ────────────────────────────────────────────────
  if (phase === "simulating") {
    return (
      <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
        {rosterPanel}
        <div className="text-center py-8">
          <p className="text-muted-foreground animate-pulse text-lg">Simulating 82 games…</p>
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

  // ── SPIN CARDS (start + spinning phases) ──────────────────────
  const isSpinning = phase === "spinning";
  const shownTeam   = displayedTeam   ?? "???";
  const shownDecade = displayedDecade ?? "???";

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      {filledCount > 0 && rosterPanel}

      {/* Two slot-machine cards */}
      <div className="flex gap-4 justify-center mt-2">
        {/* Team card — orange border */}
        <div className="flex-1">
          <div className={`w-full aspect-square rounded-xl border-4 bg-card flex flex-col items-center justify-center shadow-lg relative transition-opacity ${
            lockedCard === "team" ? "border-orange-500 opacity-100" : lockedCard === "decade" ? "border-orange-500 opacity-40" : "border-orange-500"
          }`}>
            {lockedCard === "team" && (
              <span className="absolute top-2 right-2 text-xs text-orange-400">🔒</span>
            )}
            <p className="text-xs font-bold text-orange-500 tracking-widest uppercase mb-1">Team</p>
            <p className="text-3xl font-black text-foreground tabular-nums">{teamAbbr(shownTeam)}</p>
          </div>
        </div>
        {/* Decade card — purple border */}
        <div className="flex-1">
          <div className={`w-full aspect-square rounded-xl border-4 bg-card flex flex-col items-center justify-center shadow-lg relative transition-opacity ${
            lockedCard === "decade" ? "border-purple-500 opacity-100" : lockedCard === "team" ? "border-purple-500 opacity-40" : "border-purple-500"
          }`}>
            {lockedCard === "decade" && (
              <span className="absolute top-2 right-2 text-xs text-purple-400">🔒</span>
            )}
            <p className="text-xs font-bold text-purple-400 tracking-widest uppercase mb-1">Era</p>
            <p className="text-3xl font-black text-foreground tabular-nums">{decadeShort(shownDecade)}</p>
          </div>
        </div>
      </div>

      {/* Button / status */}
      <div className="text-center">
        {isSpinning ? (
          <p className="text-sm font-semibold text-muted-foreground tracking-widest uppercase animate-pulse">
            Spinning…
          </p>
        ) : (
          <>
            {filledCount === 0 && (
              <>
                <p className="text-muted-foreground mb-4 text-sm">
                  6 rounds — one random NHL franchise per pick.<br />
                  You get one Respin Team and one Respin Era per game.
                </p>
                {/* Mode picker — only shown before game starts */}
                <div className="flex flex-col gap-2 mb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">Stats mode</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button onClick={() => setStatsMode("avg")}
                      className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${statsMode === "avg" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                      Decade Avg
                    </button>
                    <button onClick={() => setStatsMode("best")}
                      className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors border-l border-border ${statsMode === "best" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                      Best Season
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground/60 text-center">
                    {statsMode === "avg" ? "Player stats averaged across their decade with that team" : "Player stats from their single best season that decade"}
                  </p>
                </div>
              </>
            )}
            {filledCount > 0 && (
              <p className="text-muted-foreground mb-3 text-sm">
                Round {round} of 6 · {6 - filledCount} slot{6 - filledCount !== 1 ? "s" : ""} remaining
              </p>
            )}
            <Button className="w-full bg-orange-500 hover:bg-orange-400 text-white font-black py-6 text-lg tracking-widest uppercase" onClick={() => spin()}>
              Spin
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
