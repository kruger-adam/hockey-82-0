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

    session.p2 = {
      id: playerId,
      roster: EMPTY_ROSTER,
      respinTeamUsed: false,
      respinDecadeUsed: false,
      ready: false,
    };
    session.status = "ready_check";
    session.readyDeadline = null;
    session.lastRespin = null;
    session.botRole = null;
    session.rematchRequestedBy = null;
    session.rematchRoomCode = null;
    session.rematchDeadline = null;

    await redis.set(`game:${code}`, JSON.stringify(session), { ex: 14400 });

    return Response.json({ role: "p2" });
  } catch (err) {
    console.error("[game/join]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
