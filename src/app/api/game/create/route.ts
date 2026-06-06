import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import { generateRoomCode, EMPTY_ROSTER } from "@/lib/versus-utils";
import type { GameSession } from "@/lib/versus-types";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { playerId, statsMode } = await req.json();
    if (!playerId || typeof playerId !== "string") {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    let roomCode = generateRoomCode();
    let attempts = 0;
    while (attempts < 10 && (await redis.exists(`game:${roomCode}`))) {
      roomCode = generateRoomCode();
      attempts++;
    }

    const session: GameSession = {
      id: roomCode,
      status: "waiting",
      p1: { id: playerId, roster: EMPTY_ROSTER, respinTeamUsed: false, respinDecadeUsed: false, ready: false },
      p2: null,
      currentTurn: "p1",
      pickNumber: 0,
      currentSpin: null,
      draftedNames: [],
      statsMode: statsMode === "best" ? "best" : "avg",
      result: null,
      createdAt: Date.now(),
      turnDeadline: null,
      readyDeadline: null,
      lastRespin: null,
      botRole: null,
      rematchRequestedBy: null,
      rematchRoomCode: null,
      rematchDeadline: null,
    };

    await redis.set(`game:${roomCode}`, JSON.stringify(session), { ex: 14400 });

    const date = new Date().toISOString().slice(0, 10);
    const pipeline = redis.pipeline();
    pipeline.incr("versus:friend_created");
    pipeline.hincrby("versus:friend_created:by_date", date, 1);
    await pipeline.exec();

    return Response.json({ roomCode });
  } catch (err) {
    console.error("[game/create]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
