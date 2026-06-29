import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const redis = Redis.fromEnv();

export async function POST() {
  try {
    await redis.incr("gm:seasons_played");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gm/log-season] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
