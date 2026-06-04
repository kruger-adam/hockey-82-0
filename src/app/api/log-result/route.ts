import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { wins, losses, roster } = await req.json();

    if (typeof wins !== "number" || typeof losses !== "number") {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    // Always increment total games
    await redis.incr("games:total");

    const record = `${wins}-${losses}`;
    const entry = JSON.stringify({ wins, losses, roster, playedAt: new Date().toISOString() });

    if (wins === 82) {
      await redis.incr("games:perfect");
      await redis.lpush("rosters:perfect", entry);
    }

    if (losses === 82) {
      await redis.incr("games:winless");
      await redis.lpush("rosters:winless", entry);
    }

    console.log(`[game] ${record}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[log-result] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
