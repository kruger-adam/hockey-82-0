import { ImageResponse } from "next/og";
import { Redis } from "@upstash/redis";
import type { GameSession, PlayerSeriesStats } from "@/lib/versus-types";

export const dynamic = "force-dynamic";

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

function formatLine(s: PlayerSeriesStats): string {
  const last = safe(s.name).split(" ").pop() ?? safe(s.name);
  if (s.position.includes("G")) {
    const sv = s.svPct != null ? `.${Math.round(s.svPct * 1000)} SV%` : "-";
    return `${last}: ${sv}`;
  }
  return `${last}: ${s.goals}G ${s.assists}A`;
}

function sortStats(stats: PlayerSeriesStats[]) {
  return [
    ...stats.filter((s) => !s.position.includes("G")).sort((a, b) => b.points - a.points),
    ...stats.filter((s) => s.position.includes("G")),
  ];
}

export async function GET(_req: Request, { params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;

  try {
    const redis = Redis.fromEnv();
    const raw = await redis.get<string>(`game:${roomCode}`);
    if (!raw) return new Response("Not found", { status: 404 });

    const session: GameSession = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = session.result;
    if (!result) return new Response("Game not complete", { status: 404 });

    const winnerWins = Math.max(result.p1Wins, result.p2Wins);
    const loserWins = Math.min(result.p1Wins, result.p2Wins);
    const seriesLabel = loserWins === 0 ? `${winnerWins}-0 SWEEP` : `${winnerWins}-${loserWins} SERIES`;
    const winnerLabel = result.seriesWinner === "p1" ? "P1 WINS" : "P2 WINS";
    const p2Label = session.botRole ? "BOT" : "P2";

    const p1Lines = sortStats(result.p1Stats).map((s) => formatLine(s));
    const p2Lines = sortStats(result.p2Stats).map((s) => formatLine(s));

    // App dark theme: background=#0a0a0a, card=#1a1a1a (oklch(0.145) and oklch(0.205))
    return new ImageResponse(
      (
        <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", backgroundImage: "linear-gradient(to bottom, #0a0a0a, #1a1a1a, #0a0a0a)", padding: "48px 60px", fontFamily: "sans-serif" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 16, color: "#666" }}>82and0hockey.com</div>
            <div style={{ flexGrow: 1 }} />
            <div style={{ backgroundColor: "#fbbf24", color: "#0a0a0a", fontSize: 13, fontWeight: 900, paddingTop: 5, paddingBottom: 5, paddingLeft: 14, paddingRight: 14, borderRadius: 999 }}>
              {winnerLabel + "  " + seriesLabel}
            </div>
          </div>

          {/* Series headline */}
          <div style={{ fontSize: 30, fontWeight: 900, color: "#fbbf24", marginBottom: 6 }}>
            Head-to-Head
          </div>
          <div style={{ marginBottom: 24 }} />

          {/* Two columns */}
          <div style={{ display: "flex", flexGrow: 1, gap: 20 }}>
            {/* P1 */}
            <div style={{ flexGrow: 1, flexBasis: 0, display: "flex", flexDirection: "column", backgroundColor: "#1a1a1a", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, paddingBottom: 16, paddingLeft: 20, paddingRight: 20 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#666", fontWeight: 700, letterSpacing: 2 }}>P1</div>
                <div style={{ flexGrow: 1 }} />
                <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>{result.p1Wins + "W"}</div>
              </div>
              {p1Lines.map((line, i) => (
                <div key={i} style={{ fontSize: 13, color: "#f9f9f9", marginBottom: 6, opacity: 0.9 }}>{line}</div>
              ))}
            </div>

            {/* P2 */}
            <div style={{ flexGrow: 1, flexBasis: 0, display: "flex", flexDirection: "column", backgroundColor: "#1a1a1a", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, paddingBottom: 16, paddingLeft: 20, paddingRight: 20 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#666", fontWeight: 700, letterSpacing: 2 }}>{p2Label}</div>
                <div style={{ flexGrow: 1 }} />
                <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>{result.p2Wins + "W"}</div>
              </div>
              {p2Lines.map((line, i) => (
                <div key={i} style={{ fontSize: 13, color: "#f9f9f9", marginBottom: 6, opacity: 0.9 }}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  } catch (e) {
    console.error("[og/versus]", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}
