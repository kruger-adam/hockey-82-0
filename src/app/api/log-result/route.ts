import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { wins, losses, roster, mode } = await req.json();

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

    console.log(`[game] ${wins}-${losses}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[log-result] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
