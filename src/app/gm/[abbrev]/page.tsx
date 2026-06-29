'use client'

import { use, useState, useMemo } from "react"
import Link from "next/link"
import {
  ALL_TEAMS, simulateLeagueSeason, simulatePlayoffs, isTradeFlat, tradeDiff,
  TRADE_FAIRNESS_THRESHOLD, getTeamStrength, playerAge, tradeValue,
  generatePlayerStats,
  type PlayerRecord, type TeamRoster, type StandingsRow, type PlayoffBracket,
  type BracketSeries, type PlayerStatLine,
} from "@/lib/franchise"

type Tab = "roster" | "trade" | "season"
type SortKey = "pts" | "g" | "a" | "gp"

function playoffResultForTeam(bracket: PlayoffBracket, abbrev: string): { gp: number; gameWins: number } {
  const allSeries = [
    ...bracket.east.r1, ...bracket.east.r2, bracket.east.cf,
    ...bracket.west.r1, ...bracket.west.r2, bracket.west.cf,
    bracket.scf,
  ]
  let gp = 0, gameWins = 0
  for (const s of allSeries) {
    if (s.top.abbrev === abbrev) { gp += s.games; gameWins += s.topWins }
    if (s.bottom.abbrev === abbrev) { gp += s.games; gameWins += s.bottomWins }
  }
  return { gp, gameWins }
}

function StatsTable({ title, stats }: { title: string; stats: PlayerStatLine[] }) {
  const [sort, setSort] = useState<SortKey>("pts")

  const skaters = [...stats.filter(p => p.position !== "G")].sort((a, b) => b[sort] - a[sort])
  const goalies = stats.filter(p => p.position === "G")

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      onClick={() => setSort(k)}
      className={["px-2 py-1.5 font-normal text-center w-8 cursor-pointer select-none transition-colors",
        sort === k ? "text-amber-400" : "hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </th>
  )

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{title}</p>
      <div className="rounded-xl border border-border/30 overflow-hidden mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30 text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-normal">Player</th>
              <Th k="gp" label="GP" />
              <Th k="g" label="G" />
              <Th k="a" label="A" />
              <Th k="pts" label="PTS" />
            </tr>
          </thead>
          <tbody>
            {skaters.map((p, i) => (
              <tr key={p.id} className={["border-t border-border/20", i % 2 === 0 ? "bg-card/30" : ""].join(" ")}>
                <td className="px-3 py-1.5">
                  <span className="text-foreground">{p.name}</span>
                  <span className="ml-1.5 text-muted-foreground text-[10px]">{p.position}</span>
                </td>
                <td className="px-2 py-1.5 text-center text-muted-foreground">{p.gp}</td>
                <td className="px-2 py-1.5 text-center">{p.g}</td>
                <td className="px-2 py-1.5 text-center">{p.a}</td>
                <td className="px-2 py-1.5 text-center font-semibold text-amber-400">{p.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {goalies.length > 0 && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30 text-muted-foreground">
                <th className="text-left px-3 py-1.5 font-normal">Goalie</th>
                <th className="px-2 py-1.5 font-normal text-center w-8">GP</th>
                <th className="px-2 py-1.5 font-normal text-center w-8">W</th>
                <th className="px-2 py-1.5 font-normal text-center w-12">SV%</th>
                <th className="px-2 py-1.5 font-normal text-center w-12">GAA</th>
              </tr>
            </thead>
            <tbody>
              {goalies.map((p, i) => (
                <tr key={p.id} className={["border-t border-border/20", i % 2 === 0 ? "bg-card/30" : ""].join(" ")}>
                  <td className="px-3 py-1.5 text-foreground">{p.name}</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground">{p.gp}</td>
                  <td className="px-2 py-1.5 text-center">{p.w ?? 0}</td>
                  <td className="px-2 py-1.5 text-center">{p.svp?.toFixed(3) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-center">{p.gaa?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RatingBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, ((value - 20) / 80) * 100))
  const color = value >= 80 ? "#22c55e" : value >= 65 ? "#f59e0b" : "#ef4444"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-border/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-6 text-right" style={{ color }}>{value}</span>
    </div>
  )
}

function PlayerCard({ player, selected, onToggle, dimmed, showValue }: {
  player: PlayerRecord
  selected?: boolean
  onToggle?: () => void
  dimmed?: boolean
  showValue?: boolean
}) {
  const age = playerAge(player)
  const tv = tradeValue(player)
  return (
    <button
      onClick={onToggle}
      disabled={!onToggle}
      className={[
        "w-full text-left px-3 py-2 rounded-lg border transition-all",
        onToggle ? "cursor-pointer" : "cursor-default",
        selected
          ? "border-amber-500/60 bg-amber-500/10"
          : "border-border/30 bg-card/40 hover:border-border/60",
        dimmed ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-foreground truncate">{player.name}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground">{age}y</span>
          <span className="text-[10px] text-muted-foreground bg-background/60 px-1 rounded">{player.position}</span>
          </div>
      </div>
      <RatingBar value={showValue ? tv : player.rating} />
    </button>
  )
}

function RosterPanel({ players }: { players: PlayerRecord[] }) {
  const byPos = (pos: string[]) => [...players].filter(p => pos.includes(p.position)).sort((a, b) => b.rating - a.rating)
  const sections = [
    { label: "Centers", players: byPos(["C"]) },
    { label: "Left Wings", players: byPos(["LW"]) },
    { label: "Right Wings", players: byPos(["RW"]) },
    { label: "Defense", players: byPos(["D"]) },
    { label: "Goalies", players: byPos(["G"]) },
  ]
  const strength = getTeamStrength(players)
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{players.length} players</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Team strength</span>
          <span className="text-sm font-semibold text-amber-500">{strength.toFixed(0)}</span>
        </div>
      </div>
      <div className="space-y-5">
        {sections.map(s => s.players.length > 0 && (
          <div key={s.label}>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{s.label}</p>
            <div className="space-y-1.5">
              {s.players.map(p => <PlayerCard key={p.id} player={p} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TradePanel({ myTeam, allPlayers, onTrade }: {
  myTeam: TeamRoster
  allPlayers: PlayerRecord[]
  onTrade: (given: PlayerRecord[], received: PlayerRecord[], fromTeam: string) => void
}) {
  const [offering, setOffering] = useState<Set<number>>(new Set())
  const [targetAbbrev, setTargetAbbrev] = useState("")
  const [requesting, setRequesting] = useState<Set<number>>(new Set())

  const targetTeam = ALL_TEAMS.find(t => t.abbrev === targetAbbrev)

  const given = allPlayers.filter(p => offering.has(p.id))
  const received = targetTeam?.players.filter(p => requesting.has(p.id)) ?? []

  const fair = isTradeFlat(given, received)
  const diff = tradeDiff(given, received)

  const toggle = (set: Set<number>, id: number) => {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  }

  const handleConfirm = () => {
    if (!fair || !targetTeam) return
    onTrade(given, received, targetAbbrev)
    setOffering(new Set())
    setRequesting(new Set())
    setTargetAbbrev("")
  }

  const byPos = (players: PlayerRecord[]) =>
    [...players].sort((a, b) => {
      const order = ["C", "LW", "RW", "D", "G"]
      return order.indexOf(a.position) - order.indexOf(b.position) || b.rating - a.rating
    })

  const otherTeams = ALL_TEAMS.filter(t => t.abbrev !== myTeam.abbrev)

  return (
    <div className="space-y-6">
      {/* My offer */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">You offer</p>
        <div className="space-y-1.5">
          {byPos(allPlayers).map(p => (
            <PlayerCard
              key={p.id}
              player={p}
              selected={offering.has(p.id)}
              onToggle={() => setOffering(toggle(offering, p.id))}
              showValue
            />
          ))}
        </div>
      </div>

      {/* Target team */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Trade with</p>
        <select
          value={targetAbbrev}
          onChange={e => { setTargetAbbrev(e.target.value); setRequesting(new Set()) }}
          className="w-full bg-card border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border"
        >
          <option value="">Select a team...</option>
          {otherTeams.map(t => <option key={t.abbrev} value={t.abbrev}>{t.name}</option>)}
        </select>
      </div>

      {/* Their roster */}
      {targetTeam && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">You receive</p>
          <div className="space-y-1.5">
            {byPos(targetTeam.players).map(p => (
              <PlayerCard
                key={p.id}
                player={p}
                selected={requesting.has(p.id)}
                onToggle={() => setRequesting(toggle(requesting, p.id))}
                showValue
              />
            ))}
          </div>
        </div>
      )}

      {/* Fairness bar */}
      {given.length > 0 && received.length > 0 && (
        <div className="sticky bottom-4 bg-background/95 backdrop-blur border border-border/50 rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>You give: <span className="text-foreground font-medium">{given.reduce((s, p) => s + tradeValue(p), 0)} TV</span></span>
            <span>You get: <span className="text-foreground font-medium">{received.reduce((s, p) => s + tradeValue(p), 0)} TV</span></span>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Trade fairness</span>
              <span className={fair ? "text-green-500" : "text-red-400"}>
                {diff > 0 ? `+${diff}` : diff} {fair ? "✓ Fair" : `(need within ±${TRADE_FAIRNESS_THRESHOLD})`}
              </span>
            </div>
            <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, 50 + (diff / TRADE_FAIRNESS_THRESHOLD) * 50))}%`,
                  backgroundColor: fair ? "#22c55e" : "#ef4444",
                }}
              />
            </div>
          </div>
          <button
            onClick={handleConfirm}
            disabled={!fair}
            className="w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-400 text-black"
          >
            Confirm Trade
          </button>
        </div>
      )}
    </div>
  )
}

function SeriesBox({ s, userAbbrev }: { s: BracketSeries; userAbbrev: string }) {
  const isUserTop = s.top.abbrev === userAbbrev
  const isUserBot = s.bottom.abbrev === userAbbrev
  const topWon = s.winner?.abbrev === s.top.abbrev
  return (
    <div className="rounded-lg border border-border/30 overflow-hidden text-xs">
      {[
        { seed: s.top, wins: s.topWins, won: topWon, isUser: isUserTop },
        { seed: s.bottom, wins: s.bottomWins, won: !topWon, isUser: isUserBot },
      ].map(({ seed, wins, won, isUser }) => (
        <div
          key={seed.abbrev}
          className={[
            "flex items-center justify-between px-2 py-1.5 gap-2",
            won ? "bg-card/60" : "opacity-50",
            isUser ? "ring-1 ring-inset ring-amber-500/50" : "",
          ].join(" ")}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seed.color }} />
            <span className={isUser ? "text-amber-400 font-semibold" : ""}>{seed.abbrev}</span>
          </div>
          <span className="font-mono text-muted-foreground">{wins}</span>
        </div>
      ))}
    </div>
  )
}

function BracketPanel({ bracket, userAbbrev }: { bracket: PlayoffBracket; userAbbrev: string }) {
  const champion = bracket.champion
  const isUserChamp = champion?.abbrev === userAbbrev

  const Section = ({ title, r1, r2, cf }: { title: string; r1: BracketSeries[]; r2: BracketSeries[]; cf: BracketSeries }) => (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{title} Conference</p>
      <div className="grid grid-cols-3 gap-3 items-start">
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground mb-1">Round 1</p>
          {r1.map((s, i) => <SeriesBox key={i} s={s} userAbbrev={userAbbrev} />)}
        </div>
        <div className="space-y-2 mt-6">
          <p className="text-[10px] text-muted-foreground mb-1">Semis</p>
          {r2.map((s, i) => <SeriesBox key={i} s={s} userAbbrev={userAbbrev} />)}
        </div>
        <div className="mt-12">
          <p className="text-[10px] text-muted-foreground mb-1">Final</p>
          <SeriesBox s={cf} userAbbrev={userAbbrev} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-8">
      {isUserChamp && (
        <div className="text-center py-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <p className="text-2xl mb-1">🏆</p>
          <p className="text-amber-400 font-bold">Stanley Cup Champions!</p>
        </div>
      )}
      {!isUserChamp && champion && (
        <div className="text-center py-3 bg-card/40 border border-border/30 rounded-xl">
          <p className="text-xs text-muted-foreground mb-0.5">Stanley Cup Champion</p>
          <div className="flex items-center justify-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: champion.color }} />
            <p className="text-sm font-semibold">{champion.name}</p>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Stanley Cup Final</p>
        <SeriesBox s={bracket.scf} userAbbrev={userAbbrev} />
      </div>

      <Section title="Eastern" r1={bracket.east.r1} r2={bracket.east.r2} cf={bracket.east.cf} />
      <Section title="Western" r1={bracket.west.r1} r2={bracket.west.r2} cf={bracket.west.cf} />
    </div>
  )
}

function StandingsPanel({ standings, userAbbrev }: { standings: StandingsRow[]; userAbbrev: string }) {
  const confs = ["Eastern", "Western"]
  return (
    <div className="space-y-6">
      {confs.map(conf => {
        const teams = standings.filter(s => s.conf === conf)
        const divs = [...new Set(teams.map(t => t.div))]
        return (
          <div key={conf}>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{conf}</p>
            {divs.map(div => {
              const divTeams = teams.filter(t => t.div === div)
              return (
                <div key={div} className="mb-4">
                  <p className="text-[11px] text-muted-foreground mb-1.5 ml-1">{div}</p>
                  <div className="rounded-xl border border-border/30 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/30 text-muted-foreground">
                          <th className="text-left px-3 py-1.5 font-normal">Team</th>
                          <th className="px-2 py-1.5 font-normal w-8 text-center">W</th>
                          <th className="px-2 py-1.5 font-normal w-8 text-center">L</th>
                          <th className="px-2 py-1.5 font-normal w-10 text-center">OTL</th>
                          <th className="px-2 py-1.5 font-normal w-10 text-center font-semibold text-foreground">PTS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {divTeams.map((row, i) => {
                          const isUser = row.abbrev === userAbbrev
                          return (
                            <tr
                              key={row.abbrev}
                              className={[
                                "border-t border-border/20",
                                isUser ? "bg-amber-500/10" : i % 2 === 0 ? "bg-card/30" : "",
                              ].join(" ")}
                            >
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                                  <span className={isUser ? "text-amber-400 font-semibold" : ""}>{row.abbrev}</span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-center">{row.w}</td>
                              <td className="px-2 py-1.5 text-center">{row.l}</td>
                              <td className="px-2 py-1.5 text-center">{row.otl}</td>
                              <td className="px-2 py-1.5 text-center font-semibold">{row.pts}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default function FranchisePage({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev } = use(params)
  const abbrevUp = abbrev.toUpperCase()

  const myTeam = useMemo(() => ALL_TEAMS.find(t => t.abbrev === abbrevUp), [abbrevUp])
  const [myPlayers, setMyPlayers] = useState<PlayerRecord[]>(myTeam?.players ?? [])
  const [tab, setTab] = useState<Tab>("roster")
  const [standings, setStandings] = useState<StandingsRow[] | null>(null)
  const [bracket, setBracket] = useState<PlayoffBracket | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStatLine[] | null>(null)
  const [playoffStats, setPlayoffStats] = useState<PlayerStatLine[] | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [tradeLog, setTradeLog] = useState<string[]>([])

  if (!myTeam) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Team not found: {abbrev}</p>
          <Link href="/gm" className="text-amber-500 text-sm mt-2 block">← Pick a team</Link>
        </div>
      </main>
    )
  }

  const handleTrade = (given: PlayerRecord[], received: PlayerRecord[], fromTeam: string) => {
    const givenIds = new Set(given.map(p => p.id))
    const next = myPlayers.filter(p => !givenIds.has(p.id)).concat(received)
    setMyPlayers(next)
    const msg = `Traded ${given.map(p => p.name).join(", ")} to ${fromTeam} for ${received.map(p => p.name).join(", ")}`
    setTradeLog(prev => [msg, ...prev])
    setStandings(null)
    setBracket(null)
    setPlayerStats(null)
    setPlayoffStats(null)
  }

  const handleSimulate = () => {
    setSimulating(true)
    setTimeout(() => {
      const s = simulateLeagueSeason(ALL_TEAMS, abbrevUp, myPlayers)
      const b = simulatePlayoffs(s)
      const userRow = s.find(r => r.abbrev === abbrevUp)
      const regStats = generatePlayerStats(myPlayers, 82, userRow?.w ?? 41)
      const { gp: pgp, gameWins: pw } = playoffResultForTeam(b, abbrevUp)
      const poffStats = pgp > 0 ? generatePlayerStats(myPlayers, pgp, pw) : null
      setStandings(s)
      setBracket(b)
      setPlayerStats(regStats)
      setPlayoffStats(poffStats)
      setSimulating(false)
      setTab("season")
      fetch("/api/gm/log-season", { method: "POST" }).catch(() => {})
    }, 600)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "roster", label: "Roster" },
    { id: "trade", label: "Trade" },
    { id: "season", label: "Season" },
  ]

  const userRecord = standings?.find(s => s.abbrev === abbrevUp)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Link href="/gm" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Teams
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: myTeam.color }} />
            <span className="font-semibold text-sm">{myTeam.name}</span>
          </div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            82-0 →
          </Link>
        </div>

        {/* Trade log */}
        {tradeLog.length > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            {tradeLog.map((msg, i) => (
              <p key={i} className="text-xs text-green-400">{msg}</p>
            ))}
          </div>
        )}

        {/* Simulate button */}
        <button
          onClick={handleSimulate}
          disabled={simulating}
          className="w-full mb-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {simulating ? "Simulating season..." : standings ? "Re-simulate Season" : "Simulate Season"}
        </button>

        {userRecord && (
          <div className="flex items-center justify-center gap-4 mb-4 text-sm">
            <span className="text-muted-foreground">{myTeam.abbrev} result:</span>
            <span className="font-bold">{userRecord.w}-{userRecord.l}-{userRecord.otl}</span>
            <span className="text-amber-500 font-bold">{userRecord.pts} pts</span>
            {bracket?.champion?.abbrev === abbrevUp && <span className="text-amber-400">🏆 Champions</span>}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border/30 mb-6">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                "flex-1 py-2 text-xs font-medium transition-colors",
                tab === t.id
                  ? "text-foreground border-b-2 border-amber-500"
                  : "text-muted-foreground hover:text-foreground border-b-2 border-transparent",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "roster" && <RosterPanel players={myPlayers} />}

        {tab === "trade" && (
          <TradePanel
            myTeam={myTeam}
            allPlayers={myPlayers}
            onTrade={handleTrade}
          />
        )}

        {tab === "season" && standings && bracket && (
          <div className="space-y-10">
            <BracketPanel bracket={bracket} userAbbrev={abbrevUp} />
            {playerStats && (
              <StatsTable title="Your Regular Season Stats" stats={playerStats} />
            )}
            {playoffStats && (
              <StatsTable title="Your Playoff Stats" stats={playoffStats} />
            )}
            <StandingsPanel standings={standings} userAbbrev={abbrevUp} />
          </div>
        )}

        {tab === "season" && !standings && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">Hit "Simulate Season" above to see results.</p>
          </div>
        )}
      </div>
    </main>
  )
}
