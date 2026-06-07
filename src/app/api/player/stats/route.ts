import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

const redis = Redis.fromEnv();

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
  const rank = rankRaw !== null ? rankRaw + 1 : null;

  return Response.json({ wins, losses, rank, totalPlayers: total });
}
