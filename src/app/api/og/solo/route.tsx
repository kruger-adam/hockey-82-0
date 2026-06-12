import { ImageResponse } from "next/og";

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

const POSITION_COLORS: Record<string, { bg: string; fg: string }> = {
  C:  { bg: "rgba(59,130,246,0.25)",  fg: "#93c5fd" },
  LW: { bg: "rgba(34,197,94,0.25)",   fg: "#86efac" },
  RW: { bg: "rgba(16,185,129,0.25)",  fg: "#6ee7b7" },
  D:  { bg: "rgba(249,115,22,0.25)",  fg: "#fdba74" },
  G:  { bg: "rgba(168,85,247,0.25)",  fg: "#d8b4fe" },
};

interface SoloShareData {
  record: string;
  wins: number;
  mode: "avg" | "best";
  players: { pos: string; name: string; sub: string }[];
}

function flavor(wins: number): string {
  if (wins === 82) return "PERFECT SEASON";
  if (wins >= 72) return "DYNASTY-LEVEL TEAM";
  if (wins >= 60) return "LEGITIMATE CUP THREAT";
  if (wins >= 50) return "SOLID PLAYOFF TEAM";
  if (wins >= 41) return "BUBBLE TEAM";
  return "BACK TO THE DRAFT BOARD";
}

function parseData(raw: string | null): SoloShareData | null {
  if (!raw || raw.length > 4000) return null;
  try {
    const d = JSON.parse(raw);
    if (
      typeof d.record !== "string" || d.record.length > 12 ||
      typeof d.wins !== "number" || d.wins < 0 || d.wins > 82 ||
      (d.mode !== "avg" && d.mode !== "best") ||
      !Array.isArray(d.players) || d.players.length === 0 || d.players.length > 6
    ) return null;
    for (const p of d.players) {
      if (typeof p.pos !== "string" || p.pos.length > 3) return null;
      if (typeof p.name !== "string" || p.name.length > 40) return null;
      if (typeof p.sub !== "string" || p.sub.length > 60) return null;
    }
    return d as SoloShareData;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const data = parseData(new URL(req.url).searchParams.get("d"));
  if (!data) return new Response("Invalid data", { status: 400 });

  try {
    return new ImageResponse(
      (
        <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", backgroundImage: "linear-gradient(to bottom, #0a0a0a, #1a1a2e, #0a0a0a)", padding: "56px 64px", fontFamily: "sans-serif" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: "#f9f9f9", letterSpacing: -1 }}>82—0</div>
            <div style={{ backgroundColor: "#f97316", color: "#0a0a0a", fontSize: 18, fontWeight: 900, paddingTop: 5, paddingBottom: 5, paddingLeft: 14, paddingRight: 14, borderRadius: 8, marginLeft: 16, letterSpacing: 2 }}>
              HOCKEY
            </div>
            <div style={{ flexGrow: 1 }} />
            <div style={{ fontSize: 18, color: "#666", fontWeight: 700, letterSpacing: 2 }}>
              {data.mode === "best" ? "BEST SEASON MODE" : "CAREER AVG MODE"}
            </div>
          </div>

          {/* Record */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 22, color: "#888", fontWeight: 700, letterSpacing: 6, marginBottom: 4 }}>
              FINAL REGULAR-SEASON RECORD
            </div>
            <div style={{ fontSize: 130, fontWeight: 900, color: data.wins === 82 ? "#fbbf24" : "#f9f9f9", lineHeight: 1.1 }}>
              {data.record.replace("-", "–")}
            </div>
            <div style={{ display: "flex", backgroundColor: data.wins >= 60 ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.06)", border: data.wins >= 60 ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(255,255,255,0.12)", color: data.wins >= 60 ? "#fbbf24" : "#aaa", fontSize: 20, fontWeight: 800, letterSpacing: 3, paddingTop: 8, paddingBottom: 8, paddingLeft: 24, paddingRight: 24, borderRadius: 999, marginTop: 16 }}>
              {flavor(data.wins)}
            </div>
          </div>

          {/* Roster grid */}
          <div style={{ display: "flex", flexWrap: "wrap", flexGrow: 1, alignContent: "center" }}>
            {data.players.map((p, i) => {
              const colors = POSITION_COLORS[p.pos] ?? POSITION_COLORS.C;
              return (
                <div key={i} style={{ display: "flex", width: "50%", paddingTop: 8, paddingBottom: 8, paddingLeft: i % 2 === 0 ? 0 : 12, paddingRight: i % 2 === 0 ? 12 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", flexGrow: 1, backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, paddingTop: 18, paddingBottom: 18, paddingLeft: 22, paddingRight: 22 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 38, backgroundColor: colors.bg, color: colors.fg, fontSize: 20, fontWeight: 900, borderRadius: 8, marginRight: 18 }}>
                      {p.pos}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ fontSize: 26, fontWeight: 800, color: "#f9f9f9" }}>{safe(p.name)}</div>
                      <div style={{ fontSize: 18, color: "#888", marginTop: 2 }}>{safe(p.sub)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
            <div style={{ fontSize: 24, color: "#888", fontWeight: 700 }}>
              Can you go 82–0?
            </div>
            <div style={{ fontSize: 24, color: "#f97316", fontWeight: 800, marginLeft: 14 }}>
              82and0hockey.com
            </div>
          </div>
        </div>
      ),
      { width: 1080, height: 1080 }
    );
  } catch (e) {
    console.error("[og/solo]", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}
