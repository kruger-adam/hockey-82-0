import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import { generateRoomCode, EMPTY_ROSTER } from "@/lib/versus-utils";
import type { GameSession } from "@/lib/versus-types";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { playerId } = await req.json();
    if (!playerId || typeof playerId !== "string") {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    // Already matched?
    const existingMatch = await redis.get<string>(`matchmaking:matched:${playerId}`);
    if (existingMatch) {
      const data = typeof existingMatch === "string" ? JSON.parse(existingMatch) : existingMatch;
      return Response.json({ matched: true, ...data });
    }

    // Try to pop a valid waiting player
    let matched = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const waitingRaw = await redis.lpop<string>("matchmaking:queue");
      if (!waitingRaw) break;

      const waiting = typeof waitingRaw === "string" ? JSON.parse(waitingRaw) : waitingRaw;
      if (waiting.id === playerId) continue;

      // Verify they're still waiting (not canceled/expired)
      const stillWaiting = await redis.get(`matchmaking:queued:${waiting.id}`);
      if (!stillWaiting) continue;

      // Match found — create game
      const roomCode = generateRoomCode();
      const firstTurn: "p1" | "p2" = Math.random() < 0.5 ? "p1" : "p2";

      const session: GameSession = {
        id: roomCode,
        status: "drafting",
        p1: { id: waiting.id, roster: EMPTY_ROSTER, respinTeamUsed: false, respinDecadeUsed: false, ready: false },
        p2: { id: playerId, roster: EMPTY_ROSTER, respinTeamUsed: false, respinDecadeUsed: false, ready: false },
        currentTurn: firstTurn,
        pickNumber: 0,
        currentSpin: null,
        draftedNames: [],
        statsMode: "best",
        result: null,
        createdAt: Date.now(),
        turnDeadline: Date.now() + 5_000,
        readyDeadline: null,
        lastRespin: null,
        botRole: null,
        rematchRequestedBy: null,
        rematchRoomCode: null,
        rematchDeadline: null,
      };

      await redis.set(`game:${roomCode}`, JSON.stringify(session), { ex: 14400 });
      await redis.del(`matchmaking:queued:${waiting.id}`);

      const date = new Date().toISOString().slice(0, 10);
      const pipeline = redis.pipeline();
      pipeline.incr("versus:started");
      pipeline.hincrby("versus:started:by_date", date, 1);
      pipeline.incr("versus:matchmade");
      await pipeline.exec();
      await redis.set(
        `matchmaking:matched:${waiting.id}`,
        JSON.stringify({ roomCode, role: "p1" }),
        { ex: 120 }
      );

      matched = true;
      return Response.json({ matched: true, roomCode, role: "p2" });
    }

    if (!matched) {
      // Add to queue if not already there
      const alreadyQueued = await redis.get(`matchmaking:queued:${playerId}`);
      if (!alreadyQueued) {
        await redis.rpush(
          "matchmaking:queue",
          JSON.stringify({ id: playerId, joinedAt: Date.now() })
        );
        await redis.set(`matchmaking:queued:${playerId}`, "1", { ex: 300 });
      }
    }

    return Response.json({ matched: false });
  } catch (err) {
    console.error("[matchmaking/post]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "invalid" }, { status: 400 });

    const match = await redis.get<string>(`matchmaking:matched:${playerId}`);
    if (match) {
      const data = typeof match === "string" ? JSON.parse(match) : match;
      return Response.json({ matched: true, ...data });
    }
    return Response.json({ matched: false });
  } catch (err) {
    console.error("[matchmaking/get]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "invalid" }, { status: 400 });
    await redis.del(`matchmaking:queued:${playerId}`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
