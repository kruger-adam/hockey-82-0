import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import { EMPTY_ROSTER } from "@/lib/versus-utils";
import type { GameSession } from "@/lib/versus-types";

const redis = Redis.fromEnv();

export async function POST(req: NextRequest) {
  try {
    const { roomCode, playerId } = await req.json();
    if (!roomCode || !playerId) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    const code = String(roomCode).toUpperCase().trim();
    const raw = await redis.get<string>(`game:${code}`);
    if (!raw) return Response.json({ error: "not_found" }, { status: 404 });

    const session: GameSession = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (session.p1.id === playerId) return Response.json({ role: "p1" });
    if (session.p2?.id === playerId) return Response.json({ role: "p2" });
    if (session.p2 !== null) return Response.json({ error: "full" }, { status: 409 });

    const firstTurn: "p1" | "p2" = Math.random() < 0.5 ? "p1" : "p2";
    session.p2 = {
      id: playerId,
      roster: EMPTY_ROSTER,
      respinTeamUsed: false,
      respinDecadeUsed: false,
    };
    session.status = "drafting";
    session.currentTurn = firstTurn;
    session.turnDeadline = Date.now() + 5_000;
    session.lastRespin = null;
    session.botRole = null;

    await redis.set(`game:${code}`, JSON.stringify(session), { ex: 14400 });

    const date = new Date().toISOString().slice(0, 10);
    const pipeline = redis.pipeline();
    pipeline.incr("versus:started");
    pipeline.hincrby("versus:started:by_date", date, 1);
    pipeline.incr("versus:friend_games");
    await pipeline.exec();

    return Response.json({ role: "p2", firstTurn });
  } catch (err) {
    console.error("[game/join]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
