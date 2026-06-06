import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import { generateRoomCode, EMPTY_ROSTER } from "@/lib/versus-utils";
import type { GameSession } from "@/lib/versus-types";

const redis = Redis.fromEnv();

const TURN_LIMIT_MS = 7_000;

export async function POST(req: NextRequest) {
  try {
    const { playerId } = await req.json();
    if (!playerId || typeof playerId !== "string") {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    let roomCode = generateRoomCode();
    let attempts = 0;
    while (attempts < 10 && (await redis.exists(`game:${roomCode}`))) {
      roomCode = generateRoomCode();
      attempts++;
    }

    const firstTurn: "p1" | "p2" = Math.random() < 0.5 ? "p1" : "p2";

    const session: GameSession = {
      id: roomCode,
      status: "drafting",
      p1: { id: playerId, roster: EMPTY_ROSTER, respinTeamUsed: false, respinDecadeUsed: false, ready: false },
      p2: { id: "bot", roster: EMPTY_ROSTER, respinTeamUsed: false, respinDecadeUsed: false, ready: false },
      currentTurn: firstTurn,
      pickNumber: 0,
      currentSpin: null,
      draftedNames: [],
      statsMode: "best",
      result: null,
      createdAt: Date.now(),
      // Bot is always p2; if human goes first, start their deadline
      turnDeadline: firstTurn === "p1" ? Date.now() + TURN_LIMIT_MS : null,
      readyDeadline: null,
      lastRespin: null,
      botRole: "p2",
      rematchRequestedBy: null,
      rematchRoomCode: null,
      rematchDeadline: null,
    };

    await redis.set(`game:${roomCode}`, JSON.stringify(session), { ex: 14400 });

    const date = new Date().toISOString().slice(0, 10);
    const pipeline = redis.pipeline();
    pipeline.incr("versus:started");
    pipeline.hincrby("versus:started:by_date", date, 1);
    pipeline.incr("versus:bot_games");
    pipeline.hincrby("versus:bot_games:by_date", date, 1);
    await pipeline.exec();

    return Response.json({ roomCode, role: "p1" });
  } catch (err) {
    console.error("[game/bot]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
