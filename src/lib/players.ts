import rawData from "./player-data.json";

export type Position = "C" | "LW" | "RW" | "D" | "G";

export interface Player {
  name: string;
  position: Position[];
  team: string;
  decade: string;
  // Decade average (per 82 games)
  goals?: number;
  assists?: number;
  plusMinus?: number;
  savePercentage?: number;
  gaa?: number;
  // Best single season (actual totals)
  bestGoals?: number;
  bestAssists?: number;
  bestPlusMinus?: number;
  bestGP?: number;
  bestYear?: number;
  bestSavePercentage?: number;
  bestGaa?: number;
  // Ratings
  rating: number;
  bestRating: number;
}

// ── Rating formula ────────────────────────────────────────────────────────────

const NEUTRAL_GPG = 6.0;

// Average total goals per game league-wide for each decade.
// Used to era-adjust skater points so a 100pt season in the 1980s
// (high-scoring era, 7.7 GPG) isn't overvalued vs. a 100pt season in 2005.
const DECADE_GPG: Record<string, number> = {
  "1960s": 6.0,
  "1970s": 6.6,
  "1980s": 7.7,
  "1990s": 6.7,
  "2000s": 5.5,
  "2010s": 5.6,
  "2020s": 6.2,
};

// Goalie league-average SV%, reference GAA, and SV% sensitivity multiplier by decade.
// The multiplier is lower in older/higher-scoring eras where SV% variance was wider —
// being .015 above average in the chaotic 1980s is less meaningful than in the modern era.
const GOALIE_BASELINE: Record<string, { avgSv: number; refGaa: number; svMult: number }> = {
  "1960s": { avgSv: 0.905, refGaa: 3.0, svMult: 1200 },
  "1970s": { avgSv: 0.900, refGaa: 3.3, svMult: 1200 },
  "1980s": { avgSv: 0.878, refGaa: 3.8, svMult: 900  },
  "1990s": { avgSv: 0.895, refGaa: 3.0, svMult: 1500 },
  "2000s": { avgSv: 0.902, refGaa: 2.6, svMult: 2000 },
  "2010s": { avgSv: 0.907, refGaa: 2.6, svMult: 2000 },
  "2020s": { avgSv: 0.906, refGaa: 2.9, svMult: 2000 },
};

type PartialPlayer = Omit<Player, "rating" | "bestRating">;

function computeRating(p: PartialPlayer): number {
  if (p.position.includes("G")) return goalieRating(p);
  return skaterRating(p);
}

function computeBestRating(p: PartialPlayer): number {
  if (p.position.includes("G")) {
    if (!p.bestSavePercentage) return computeRating(p);
    return goalieRating({ ...p, savePercentage: p.bestSavePercentage, gaa: p.bestGaa });
  }
  if (p.bestGoals == null || p.bestGP == null) return computeRating(p);
  return skaterRating({
    ...p,
    goals:     Math.round((p.bestGoals     / p.bestGP) * 82),
    assists:   Math.round(((p.bestAssists ?? 0) / p.bestGP) * 82),
    plusMinus: Math.round(((p.bestPlusMinus ?? 0) / p.bestGP) * 82),
  });
}

function skaterRating(p: PartialPlayer): number {
  const eraFactor = NEUTRAL_GPG / (DECADE_GPG[p.decade] ?? NEUTRAL_GPG);
  const ptsP82 = (p.goals ?? 0) + (p.assists ?? 0);
  const eraAdjPts = ptsP82 * eraFactor;

  // Defensemen score fewer points than forwards but elite D production is
  // relatively rarer — multiply to put them on a comparable scale.
  const posMultiplier = p.position.includes("D") ? 1.6 : 1.0;
  const score = eraAdjPts * posMultiplier + (p.plusMinus ?? 0) * 0.2;

  // Scale: score=0→35, score=120→100, clamped. Calibrated so a ~90 era-adj
  // pts forward (e.g. Datsyuk, Panarin) rates ~85, and Gretzky/Lemieux hit 100.
  return Math.round(Math.min(100, Math.max(20, 35 + (score / 120) * 65)));
}

function goalieRating(p: PartialPlayer): number {
  const { avgSv, refGaa, svMult } = GOALIE_BASELINE[p.decade] ?? GOALIE_BASELINE["2010s"];
  const svPct = p.savePercentage ?? avgSv;
  const gaa = p.gaa ?? refGaa;
  const score = 65 + (svPct - avgSv) * svMult + (refGaa - gaa) * 6;
  return Math.round(Math.min(100, Math.max(30, score)));
}

// ── Data loading ──────────────────────────────────────────────────────────────

type RawPlayer = Omit<Player, "rating" | "bestRating"> & { rating?: number; bestRating?: number };

export const PLAYER_POOL: Record<string, Record<string, Player[]>> = Object.fromEntries(
  Object.entries(rawData as Record<string, Record<string, RawPlayer[]>>).map(
    ([decade, teams]) => [
      decade,
      Object.fromEntries(
        Object.entries(teams).map(([team, players]) => [
          team,
          players.filter((p) => p.position.includes("G") ? p.savePercentage != null : p.bestGoals != null)
                 .map((p) => ({ ...p, rating: computeRating(p), bestRating: computeBestRating(p) })),
        ])
      ),
    ]
  )
);

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getDecades(): string[] {
  return Object.keys(PLAYER_POOL);
}

export function getTeamsForDecade(decade: string): string[] {
  return Object.keys(PLAYER_POOL[decade] ?? {});
}

export function getPlayersForTeamDecade(decade: string, team: string): Player[] {
  return PLAYER_POOL[decade]?.[team] ?? [];
}

export function getDecadesForTeam(team: string): string[] {
  return getDecades().filter((decade) => team in (PLAYER_POOL[decade] ?? {}));
}

export function getAllTeamDecadeCombos(): { decade: string; team: string }[] {
  const combos: { decade: string; team: string }[] = [];
  for (const decade of getDecades()) {
    for (const team of getTeamsForDecade(decade)) {
      combos.push({ decade, team });
    }
  }
  return combos;
}
