import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    const { guestId } = await req.json();
    if (!guestId || typeof guestId !== "string") {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    // Don't migrate if guestId is already the Clerk user ID
    if (guestId === userId) return Response.json({ ok: true, migrated: false });

    const [guestRecord, existingRecord] = await Promise.all([
      redis.hgetall(`player:record:${guestId}`) as Promise<Record<string, string> | null>,
      redis.hgetall(`player:record:${userId}`) as Promise<Record<string, string> | null>,
    ]);

    if (!guestRecord || (!guestRecord.wins && !guestRecord.losses)) {
      return Response.json({ ok: true, migrated: false });
    }

    const guestWins = Number(guestRecord.wins ?? 0);
    const guestLosses = Number(guestRecord.losses ?? 0);
    const existingWins = Number(existingRecord?.wins ?? 0);
    const existingLosses = Number(existingRecord?.losses ?? 0);

    const pipeline = redis.pipeline();

    // Merge wins/losses into the Clerk user record
    pipeline.hset(`player:record:${userId}`, {
      wins: guestWins + existingWins,
      losses: guestLosses + existingLosses,
      ...(guestRecord.name && !existingRecord?.name ? { name: guestRecord.name } : {}),
    });

    // Update rankings: remove guest entry, set merged score for user
    const mergedScore = (guestWins + existingWins) - (guestLosses + existingLosses);
    pipeline.zadd("player:rankings", { score: mergedScore, member: userId });
    pipeline.zrem("player:rankings", guestId);

    // Clean up guest record
    pipeline.del(`player:record:${guestId}`);

    await pipeline.exec();

    return Response.json({ ok: true, migrated: true });
  } catch (err) {
    console.error("[player/migrate]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
