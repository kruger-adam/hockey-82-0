import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

const redis = Redis.fromEnv();

export interface NeighborEntry {
  rank: number;
  wins: number;
  losses: number;
  differential: number;
  isMe: boolean;
  name?: string;
}

export async function GET(req: NextRequest) {
  const playerId = req.nextUrl.searchParams.get("playerId");
  if (!playerId) return Response.json({ error: "invalid" }, { status: 400 });

  const [record, rankRaw, total] = await Promise.all([
    redis.hgetall(`player:record:${playerId}`),
    redis.zrevrank("player:rankings", playerId),
    redis.zcard("player:rankings"),
  ]);

  const wins = record ? Number((record as Record<string, string>).wins ?? 0) : 0;
  const losses = record ? Number((record as Record<string, string>).losses ?? 0) : 0;
  const myName = record ? (record as Record<string, string>).name ?? undefined : undefined;
  const rank = rankRaw !== null ? rankRaw + 1 : null;

  let neighbors: NeighborEntry[] = [];

  if (rankRaw !== null) {
    const neighborStart = Math.max(0, rankRaw - 1);
    const neighborEnd = rankRaw + 1;

    // Fetch #1 and immediate neighbors in parallel (skip separate #1 fetch if already in range)
    const fetchFirst = rankRaw > 1;
    const [firstRaw, neighborRaw] = await Promise.all([
      fetchFirst
        ? redis.zrange("player:rankings", 0, 0, { rev: true, withScores: true })
        : Promise.resolve([]),
      redis.zrange("player:rankings", neighborStart, neighborEnd, { rev: true, withScores: true }),
    ]);

    function parsePairs(raw: unknown[]): { id: string; score: number; index: number }[] {
      const pairs: { id: string; score: number; index: number }[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        pairs.push({ id: String(raw[i]), score: Number(raw[i + 1]), index: i / 2 });
      }
      return pairs;
    }

    const firstPairs = parsePairs(firstRaw as unknown[]);
    const neighborPairs = parsePairs(neighborRaw as unknown[]);

    // Build ordered, de-duped list: #1 first, then neighbors
    const seen = new Set<string>();
    const orderedPairs: { id: string; score: number; rank: number }[] = [];

    for (const p of firstPairs) {
      if (!seen.has(p.id)) { seen.add(p.id); orderedPairs.push({ id: p.id, score: p.score, rank: 1 }); }
    }
    for (const p of neighborPairs) {
      const r = neighborStart + p.index + 1;
      if (!seen.has(p.id)) { seen.add(p.id); orderedPairs.push({ id: p.id, score: p.score, rank: r }); }
    }

    // Fetch W/L+name for non-self entries
    const otherIds = orderedPairs.map((p) => p.id).filter((id) => id !== playerId);
    const otherRecords = await Promise.all(
      otherIds.map((id) => redis.hgetall(`player:record:${id}`))
    );

    const recordMap = new Map<string, { wins: number; losses: number; name?: string }>();
    otherIds.forEach((id, i) => {
      const r = otherRecords[i] as Record<string, string> | null;
      recordMap.set(id, {
        wins: Number(r?.wins ?? 0),
        losses: Number(r?.losses ?? 0),
        name: r?.name ?? undefined,
      });
    });
    recordMap.set(playerId, { wins, losses, name: myName });

    neighbors = orderedPairs.map((p) => ({
      rank: p.rank,
      wins: recordMap.get(p.id)?.wins ?? 0,
      losses: recordMap.get(p.id)?.losses ?? 0,
      differential: p.score,
      isMe: p.id === playerId,
      name: recordMap.get(p.id)?.name,
    }));
  }

  return Response.json({ wins, losses, rank, totalPlayers: total, neighbors });
}
