import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { playerId, name } = await req.json();
    if (!playerId || typeof playerId !== "string") {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    const trimmed = typeof name === "string" ? name.trim().slice(0, 20) : "";
    if (!trimmed) return Response.json({ error: "invalid" }, { status: 400 });

    await redis.hset(`player:record:${playerId}`, { name: trimmed });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
