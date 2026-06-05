import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = Redis.fromEnv();

function isValidUserId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 64 && /^[a-zA-Z0-9-]+$/.test(id);
}

export async function POST(req: NextRequest) {
  try {
    const { wins, losses, roster, mode, userId } = await req.json();

    if (typeof wins !== "number" || typeof losses !== "number") {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    const entry = JSON.stringify({ wins, losses, roster, mode: mode ?? "avg", playedAt: new Date().toISOString() });

    const pipeline = redis.pipeline();
    pipeline.incr("games:total");
    pipeline.lpush("results:all", entry);

    if (wins === 82) {
      pipeline.incr("games:perfect");
      pipeline.lpush("rosters:perfect", entry);
    }
    if (losses === 82) {
      pipeline.incr("games:winless");
      pipeline.lpush("rosters:winless", entry);
    }

    await pipeline.exec();

    if (isValidUserId(userId)) {
      const userPipeline = redis.pipeline();
      userPipeline.zincrby("users:by_games", 1, userId);
      userPipeline.sadd(`user:${userId}:records`, wins);
      userPipeline.scard(`user:${userId}:records`);
      const userResults = await userPipeline.exec();
      const recordCount = userResults[2] as number;
      if (recordCount === 83) {
        await redis.sadd("users:all83", userId);
      }
    }

    console.log(`[game] ${wins}-${losses}${isValidUserId(userId) ? ` user=${userId.slice(0, 8)}` : ""}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[log-result] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
