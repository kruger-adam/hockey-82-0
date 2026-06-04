"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROSTER_SLOTS } from "@/lib/simulation";

interface HistoryEntry {
  wins: number;
  losses: number;
  playedAt: string;
  roster: Record<string, { name: string; team: string; decade: string; position: string[] } | null>;
}

const PAGE_SIZE = 20;

function getRecordColor(wins: number) {
  if (wins === 82) return "text-yellow-400";
  if (wins >= 65) return "text-green-400";
  if (wins >= 50) return "text-blue-400";
  if (wins >= 41) return "text-muted-foreground";
  return "text-red-400";
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("hockey-history");
      if (raw) setEntries(JSON.parse(raw));
    } catch {}
  }, []);

  if (entries.length === 0) {
    return (
      <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background px-4 py-10">
        <div className="max-w-lg mx-auto w-full flex flex-col gap-6">
          <Header />
          <p className="text-muted-foreground text-sm">No runs yet — play a game first!</p>
          <Link href="/" className="w-full inline-flex items-center justify-center rounded-md bg-orange-500 hover:bg-orange-400 text-white font-black px-4 py-2 text-sm transition-colors">
            Play Now
          </Link>
        </div>
      </main>
    );
  }

  const best = entries.reduce((a, b) => a.wins >= b.wins ? a : b);
  const visible = entries.slice(0, shown);

  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background px-4 py-10">
      <div className="max-w-lg mx-auto w-full flex flex-col gap-6">
        <Header />

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Runs" value={entries.length} />
          <StatCard label="Best" value={`${best.wins}-${best.losses}`} color={getRecordColor(best.wins)} />
          <StatCard label="82-0s" value={entries.filter(e => e.wins === 82).length} color="text-yellow-400" />
        </div>

        {/* Run list */}
        <div className="flex flex-col gap-2">
          {visible.map((entry, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
              {/* Row */}
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-card/60 transition-colors"
                onClick={() => setExpanded(expanded === i ? null : i)}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xl font-black tabular-nums ${getRecordColor(entry.wins)}`}>
                    {entry.wins}-{entry.losses}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <span className="text-muted-foreground/50 text-xs">{expanded === i ? "▲" : "▼"}</span>
              </button>

              {/* Expanded roster */}
              {expanded === i && (
                <div className="px-4 pb-4 flex flex-col gap-1 border-t border-border/30 pt-3">
                  {ROSTER_SLOTS.map(({ slot, label }) => {
                    const p = entry.roster[slot];
                    return (
                      <div key={slot} className="flex items-center gap-3 text-sm">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide w-14 shrink-0">{label}</span>
                        {p ? (
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-sm">{p.name}</span>
                            <span className="text-xs text-muted-foreground/50">{p.decade} · {p.team}</span>
                          </div>
                        ) : <span className="text-muted-foreground/30 text-xs">—</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Load more */}
        {shown < entries.length && (
          <Button variant="outline" className="w-full" onClick={() => setShown(s => s + PAGE_SIZE)}>
            Load more ({entries.length - shown} remaining)
          </Button>
        )}

        <Link href="/" className="w-full inline-flex items-center justify-center rounded-md border border-border bg-transparent px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
          ← Back to Game
        </Link>
      </div>
    </main>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-3xl font-black text-foreground">History</h1>
      <Link href="/" className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2">
        ← Back to Game
      </Link>
    </div>
  );
}

function StatCard({ label, value, color = "text-foreground" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center p-3 rounded-lg border border-border/40 bg-card/30 gap-1">
      <span className={`text-2xl font-black tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}
