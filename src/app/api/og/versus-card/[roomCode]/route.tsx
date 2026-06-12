import { ImageResponse } from "next/og";
import { Redis } from "@upstash/redis";
import type { GameSession, PlayerSeriesStats } from "@/lib/versus-types";
import type { Player } from "@/lib/players";
import { ROSTER_SLOTS } from "@/lib/simulation";

export const dynamic = "force-dynamic";

// Square share-card variant of the versus result, rendered from the sharing
// player's perspective (?role=p1|p2). The landscape /api/og/versus image is
// kept for link previews; this one is attached to the native share sheet.

// Strip combining diacritics (U+0300–U+036F) so Satori renders all names
function safe(str: string): string {
  return str
    .normalize("NFD")
    .split("")
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join("");
}

function decadeShort(d: string): string {
  const m = d.match(/\d{2}(\d{2})s/);
  return m ? `${m[1]}'s` : d;
}

function statText(s: PlayerSeriesStats): string {
  if (s.position.includes("G")) {
    return s.svPct != null ? `.${Math.round(s.svPct * 1000)} SV%` : "—";
  }
  return `${s.goals}G · ${s.assists}A`;
}

function sortStats(stats: PlayerSeriesStats[]) {
  return [
    ...stats.filter((s) => !s.position.includes("G")).sort((a, b) => b.points - a.points),
    ...stats.filter((s) => s.position.includes("G")),
  ];
}

function rosterByName(roster: GameSession["p1"]["roster"]): Map<string, Player> {
  const map = new Map<string, Player>();
  for (const { slot } of ROSTER_SLOTS) {
    const p = roster[slot];
    if (p) map.set(p.name, p);
  }
  return map;
}

function RosterColumn({
  label,
  labelColor,
  wins,
  stats,
  roster,
}: {
  label: string;
  labelColor: string;
  wins: number;
  stats: PlayerSeriesStats[];
  roster: Map<string, Player>;
}) {
  return (
    <div style={{ flexGrow: 1, flexBasis: 0, display: "flex", flexDirection: "column", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, paddingTop: 20, paddingBottom: 20, paddingLeft: 24, paddingRight: 24 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 20, color: labelColor, fontWeight: 900, letterSpacing: 3 }}>{label}</div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ fontSize: 20, color: "#fbbf24", fontWeight: 900 }}>{wins + "W"}</div>
      </div>
      {sortStats(stats).map((s, i) => {
        const p = roster.get(s.name);
        const sub = p ? `${decadeShort(p.decade)} ${safe(p.team.split(" ").pop() ?? p.team)} · ${statText(s)}` : statText(s);
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: i === 5 ? 0 : 12 }}>
            <div style={{ fontSize: 23, fontWeight: 800, color: "#f9f9f9" }}>{safe(s.name)}</div>
            <div style={{ fontSize: 17, color: "#888", marginTop: 1 }}>{sub}</div>
          </div>
        );
      })}
    </div>
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  const roleParam = new URL(req.url).searchParams.get("role");
  const role: "p1" | "p2" | null = roleParam === "p1" || roleParam === "p2" ? roleParam : null;

  try {
    const redis = Redis.fromEnv();
    const raw = await redis.get<string>(`game:${roomCode.toUpperCase()}`);
    if (!raw) return new Response("Not found", { status: 404 });

    const session: GameSession = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = session.result;
    if (!result || !session.p2) return new Response("Game not complete", { status: 404 });

    const me = role ?? "p1";
    const them = me === "p1" ? "p2" : "p1";
    const myWins = me === "p1" ? result.p1Wins : result.p2Wins;
    const theirWins = me === "p1" ? result.p2Wins : result.p1Wins;
    const iWon = result.seriesWinner === me;
    const themLabel = session.botRole === them ? "BOT" : role ? "THEM" : "P2";
    const meLabel = role ? "YOU" : "P1";

    const verdict = iWon
      ? theirWins === 0 ? "SWEEP! 🏆" : "SERIES WIN 🏆"
      : myWins === 0 ? "SWEPT" : "SERIES LOSS";

    const myStats = me === "p1" ? result.p1Stats : result.p2Stats;
    const theirStats = me === "p1" ? result.p2Stats : result.p1Stats;
    const myRoster = rosterByName((me === "p1" ? session.p1 : session.p2).roster);
    const theirRoster = rosterByName((them === "p1" ? session.p1 : session.p2!).roster);

    return new ImageResponse(
      (
        <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", backgroundImage: "linear-gradient(to bottom, #0a0a0a, #16161d, #0a0a0a)", padding: "56px 64px", fontFamily: "sans-serif" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: "#f9f9f9", letterSpacing: -1 }}>82—0</div>
            <div style={{ backgroundColor: "#f97316", color: "#0a0a0a", fontSize: 18, fontWeight: 900, paddingTop: 5, paddingBottom: 5, paddingLeft: 14, paddingRight: 14, borderRadius: 8, marginLeft: 16, letterSpacing: 2 }}>
              HOCKEY
            </div>
            <div style={{ flexGrow: 1 }} />
            <div style={{ fontSize: 18, color: "#666", fontWeight: 700, letterSpacing: 2 }}>HEAD-TO-HEAD</div>
          </div>

          {/* Series result */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 22, color: "#888", fontWeight: 700, letterSpacing: 6, marginBottom: 2 }}>
              BEST-OF-7 SERIES
            </div>
            <div style={{ fontSize: 110, fontWeight: 900, color: "#f9f9f9", lineHeight: 1.1 }}>
              {myWins + "–" + theirWins}
            </div>
            <div style={{ display: "flex", backgroundColor: iWon ? "rgba(251,191,36,0.15)" : "rgba(248,113,113,0.12)", border: iWon ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(248,113,113,0.35)", color: iWon ? "#fbbf24" : "#f87171", fontSize: 20, fontWeight: 800, letterSpacing: 3, paddingTop: 8, paddingBottom: 8, paddingLeft: 24, paddingRight: 24, borderRadius: 999, marginTop: 12 }}>
              {verdict}
            </div>
          </div>

          {/* Game scores */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
            {result.games.map((g, i) => {
              const mine = me === "p1" ? g.p1Goals : g.p2Goals;
              const theirs = me === "p1" ? g.p2Goals : g.p1Goals;
              const won = g.winner === me;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: won ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: won ? "1px solid rgba(74,222,128,0.35)" : "1px solid rgba(248,113,113,0.3)", borderRadius: 10, paddingTop: 6, paddingBottom: 6, paddingLeft: 14, paddingRight: 14, marginLeft: i === 0 ? 0 : 10 }}>
                  <div style={{ fontSize: 14, color: "#777", fontWeight: 700 }}>{`G${i + 1}${g.overtime ? " OT" : ""}`}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: won ? "#4ade80" : "#f87171" }}>{mine + "-" + theirs}</div>
                </div>
              );
            })}
          </div>

          {/* Rosters */}
          <div style={{ display: "flex", flexGrow: 1, gap: 20 }}>
            <RosterColumn label={meLabel} labelColor="#60a5fa" wins={myWins} stats={myStats} roster={myRoster} />
            <RosterColumn label={themLabel} labelColor="#fb923c" wins={theirWins} stats={theirStats} roster={theirRoster} />
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
            <div style={{ fontSize: 24, color: "#888", fontWeight: 700 }}>
              Think you can beat me?
            </div>
            <div style={{ fontSize: 24, color: "#f97316", fontWeight: 800, marginLeft: 14 }}>
              82and0hockey.com/versus
            </div>
          </div>
        </div>
      ),
      { width: 1080, height: 1080 }
    );
  } catch (e) {
    console.error("[og/versus-card]", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}
