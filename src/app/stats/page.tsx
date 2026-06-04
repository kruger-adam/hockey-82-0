import { Redis } from "@upstash/redis";
import Link from "next/link";

const redis = Redis.fromEnv();

interface GameEntry {
  wins: number;
  losses: number;
  playedAt: string;
  roster: Record<string, { name: string; team: string; decade: string } | null>;
}

function formatRoster(roster: GameEntry["roster"]) {
  const slots = ["C", "LW", "RW", "D1", "D2", "G"] as const;
  const labels: Record<string, string> = { C: "C", LW: "LW", RW: "RW", D1: "D", D2: "D", G: "G" };
  return slots.map((slot) => {
    const p = roster[slot];
    return p ? `${labels[slot]}: ${p.name} (${p.decade} ${p.team})` : `${labels[slot]}: —`;
  });
}

export const revalidate = 60;

export default async function StatsPage() {
  const [total, perfect, winless, perfectRosters, winlessRosters] = await Promise.all([
    redis.get<number>("games:total"),
    redis.get<number>("games:perfect"),
    redis.get<number>("games:winless"),
    redis.lrange<string>("rosters:perfect", 0, 9),
    redis.lrange<string>("rosters:winless", 0, 9),
  ]);

  const parseEntries = (raw: string[]): GameEntry[] =>
    raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));

  const perfectEntries = parseEntries(perfectRosters);
  const winlessEntries = parseEntries(winlessRosters);

  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background px-4 py-10">
      <div className="max-w-lg mx-auto w-full flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-black text-foreground">Stats</h1>
          <Link href="/" className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2">
            ← Play
          </Link>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Games Played" value={total ?? 0} />
          <StatCard label="Perfect (82-0)" value={perfect ?? 0} color="text-yellow-400" />
          <StatCard label="Winless (0-82)" value={winless ?? 0} color="text-red-400" />
        </div>

        {/* 82-0 rosters */}
        <RosterSection title="82-0 Rosters" entries={perfectEntries} emptyMsg="No one has gone 82-0 yet." />

        {/* 0-82 rosters */}
        <RosterSection title="0-82 Rosters" entries={winlessEntries} emptyMsg="No one has gone 0-82 yet." />
      </div>
    </main>
  );
}

function StatCard({ label, value, color = "text-foreground" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex flex-col items-center p-4 rounded-lg border border-border/40 bg-card/30 gap-1">
      <span className={`text-3xl font-black tabular-nums ${color}`}>{value.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}

function RosterSection({ title, entries, emptyMsg }: { title: string; entries: GameEntry[]; emptyMsg: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-bold text-foreground">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMsg}</p>
      ) : (
        entries.map((e, i) => (
          <div key={i} className="p-3 rounded-lg border border-border/40 bg-card/30 flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{new Date(e.playedAt).toLocaleString()}</p>
            {formatRoster(e.roster).map((line) => (
              <p key={line} className="text-sm text-foreground">{line}</p>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
