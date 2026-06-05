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

    const date = new Date().toISOString().slice(0, 10);
    pipeline.hincrby("stats:win_histogram", String(wins), 1);
    pipeline.hincrby("stats:games", date, 1);

    await pipeline.exec();

    if (isValidUserId(userId)) {
      const dedupKey = `stats:dau:seen:${date}`;
      const userPipeline = redis.pipeline();
      userPipeline.zincrby("users:by_games", 1, userId);
      userPipeline.sadd(dedupKey, userId);
      userPipeline.expire(dedupKey, 172800); // 48h TTL — auto-cleans after the day rolls over
      const userResults = await userPipeline.exec();
      const isNewToday = (userResults[1] as number) === 1;
      if (isNewToday) {
        await redis.hincrby("stats:dau", date, 1);
      }
    }

    console.log(`[game] ${wins}-${losses}${isValidUserId(userId) ? ` user=${userId.slice(0, 8)}` : ""}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[log-result] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
