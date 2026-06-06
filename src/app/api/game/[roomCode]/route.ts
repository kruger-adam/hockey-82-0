import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import type { GameSession } from "@/lib/versus-types";
import {
  pickRandomCombo,
  pickNewDecadeForTeam,
  pickNewTeamInDecade,
} from "@/lib/versus-utils";
import { getPlayersForTeamDecade } from "@/lib/players";
import { isRosterComplete, ROSTER_SLOTS } from "@/lib/simulation";
import { simulateSeries } from "@/lib/versus-simulation";

const redis = Redis.fromEnv();

async function getSession(code: string): Promise<GameSession | null> {
  const raw = await redis.get<string>(`game:${code}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : (raw as GameSession);
}

async function saveSession(session: GameSession): Promise<void> {
  await redis.set(`game:${session.id}`, JSON.stringify(session), { ex: 14400 });
}

const TURN_LIMIT_MS = 7_000; // 5s effective spin time + ~2s for page load
const PICK_LIMIT_MS = 12_000; // 10s effective pick time + ~2s for spin animation

async function autoSpin(session: GameSession): Promise<void> {
  const role = session.currentTurn;
  const ps = role === "p1" ? session.p1 : session.p2!;
  const combo = pickRandomCombo(ps.roster, session.draftedNames);
  if (!combo) {
    session.turnDeadline = Date.now() + 30_000;
  } else {
    session.currentSpin = combo;
    session.turnDeadline = Date.now() + PICK_LIMIT_MS;
  }
  await saveSession(session);
}

async function autoPick(session: GameSession): Promise<void> {
  const role = session.currentTurn;
  const ps = role === "p1" ? session.p1 : session.p2!;

  // Try the current spin, then fall back to a fresh random combo
  const candidates = [session.currentSpin, pickRandomCombo(ps.roster, session.draftedNames)];

  for (const combo of candidates) {
    if (!combo) continue;
    const players = getPlayersForTeamDecade(combo.decade, combo.team).filter(
      (p) => !session.draftedNames.includes(p.name)
    );

    for (const { slot, positions } of ROSTER_SLOTS) {
      if ((ps.roster as unknown as Record<string, unknown>)[slot] !== null) continue;
      const eligible = players.filter((p) => p.position.some((pos) => positions.includes(pos)));
      if (!eligible.length) continue;

      const picked = eligible[0];
      (ps.roster as unknown as Record<string, unknown>)[slot] = picked;
      session.draftedNames.push(picked.name);
      session.currentSpin = null;
      session.lastRespin = null;
      session.pickNumber++;
      session.currentTurn = role === "p1" ? "p2" : "p1";

      if (
        isRosterComplete(session.p1.roster) &&
        session.p2 &&
        isRosterComplete(session.p2.roster)
      ) {
        session.status = "complete";
        session.result = simulateSeries(session.p1.roster, session.p2.roster, session.statsMode);
        session.turnDeadline = null;
        const date = new Date().toISOString().slice(0, 10);
        const pipeline = redis.pipeline();
        pipeline.incr("versus:completed");
        pipeline.hincrby("versus:completed:by_date", date, 1);
        await pipeline.exec();
      } else {
        session.turnDeadline = Date.now() + TURN_LIMIT_MS;
      }

      await saveSession(session);
      return;
    }
  }

  // Couldn't find an eligible pick — extend deadline so we don't loop forever
  session.turnDeadline = Date.now() + 30_000;
  await saveSession(session);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const session = await getSession(roomCode.toUpperCase());
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  if (session.status === "drafting") {
    const isBotTurn = session.botRole && session.botRole === session.currentTurn;
    const isTimedOut = session.turnDeadline && Date.now() > session.turnDeadline;

    if (isBotTurn) {
      // Bot always spins + picks in one go
      if (!session.currentSpin) await autoSpin(session);
      await autoPick(session);
      const updated = await getSession(roomCode.toUpperCase());
      return Response.json(updated ?? session);
    }

    if (isTimedOut) {
      if (!session.currentSpin) {
        // Spin deadline expired — auto-spin and give them time to pick
        await autoSpin(session);
      } else {
        // Pick deadline expired — auto-pick
        await autoPick(session);
      }
      const updated = await getSession(roomCode.toUpperCase());
      return Response.json(updated ?? session);
    }
  }

  return Response.json(session);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  try {
    const body = await req.json();
    const { action, playerId } = body;

    const session = await getSession(roomCode.toUpperCase());
    if (!session) return Response.json({ error: "not_found" }, { status: 404 });
    if (session.status === "complete") return Response.json({ error: "game_over" }, { status: 400 });

    const role =
      session.p1.id === playerId ? "p1" : session.p2?.id === playerId ? "p2" : null;
    if (!role) return Response.json({ error: "unauthorized" }, { status: 403 });

    // p2 is guaranteed non-null here since role was matched by ID
    const getState = (r: "p1" | "p2") => (r === "p1" ? session.p1 : session.p2!);

    if (action === "spin") {
      if (session.status !== "drafting")
        return Response.json({ error: "not_drafting" }, { status: 400 });
      if (session.currentTurn !== role)
        return Response.json({ error: "not_your_turn" }, { status: 403 });
      if (session.currentSpin)
        return Response.json({ ok: true, combo: session.currentSpin });

      const currentRoster = getState(role).roster;
      const combo = pickRandomCombo(currentRoster, session.draftedNames);
      if (!combo) return Response.json({ error: "no_combo" }, { status: 400 });

      session.currentSpin = combo;
      // Give extra time to pick after spinning
      session.turnDeadline = Date.now() + PICK_LIMIT_MS;
      await saveSession(session);
      return Response.json({ ok: true, combo });
    }

    if (action === "respin_team") {
      if (session.currentTurn !== role)
        return Response.json({ error: "not_your_turn" }, { status: 403 });
      const ps = getState(role);
      if (ps.respinTeamUsed) return Response.json({ error: "used" }, { status: 400 });
      if (!session.currentSpin) return Response.json({ error: "no_spin" }, { status: 400 });

      const newTeam = pickNewTeamInDecade(
        session.currentSpin.decade,
        session.currentSpin.team,
        ps.roster,
        session.draftedNames
      );
      if (!newTeam) return Response.json({ error: "no_team" }, { status: 400 });

      ps.respinTeamUsed = true;
      session.currentSpin = { decade: session.currentSpin.decade, team: newTeam };
      session.lastRespin = "team";
      session.turnDeadline = Date.now() + PICK_LIMIT_MS;
      await saveSession(session);
      return Response.json({ ok: true, combo: session.currentSpin });
    }

    if (action === "respin_decade") {
      if (session.currentTurn !== role)
        return Response.json({ error: "not_your_turn" }, { status: 403 });
      const ps = getState(role);
      if (ps.respinDecadeUsed) return Response.json({ error: "used" }, { status: 400 });
      if (!session.currentSpin) return Response.json({ error: "no_spin" }, { status: 400 });

      const newDecade = pickNewDecadeForTeam(
        session.currentSpin.team,
        session.currentSpin.decade,
        ps.roster,
        session.draftedNames
      );
      if (!newDecade) return Response.json({ error: "no_decade" }, { status: 400 });

      ps.respinDecadeUsed = true;
      session.currentSpin = { decade: newDecade, team: session.currentSpin.team };
      session.lastRespin = "decade";
      session.turnDeadline = Date.now() + PICK_LIMIT_MS;
      await saveSession(session);
      return Response.json({ ok: true, combo: session.currentSpin });
    }

    if (action === "pick") {
      if (session.currentTurn !== role)
        return Response.json({ error: "not_your_turn" }, { status: 403 });
      if (!session.currentSpin)
        return Response.json({ error: "no_spin" }, { status: 400 });

      const { playerName, slot } = body;
      if (!playerName || !slot) return Response.json({ error: "invalid" }, { status: 400 });

      const spinPlayers = getPlayersForTeamDecade(
        session.currentSpin.decade,
        session.currentSpin.team
      );
      const pickedPlayer = spinPlayers.find((p) => p.name === playerName);
      if (!pickedPlayer) return Response.json({ error: "invalid_player" }, { status: 400 });
      if (session.draftedNames.includes(playerName))
        return Response.json({ error: "already_drafted" }, { status: 400 });

      const slotDef = ROSTER_SLOTS.find((s) => s.slot === slot);
      if (!slotDef) return Response.json({ error: "invalid_slot" }, { status: 400 });
      if (!pickedPlayer.position.some((pos) => slotDef.positions.includes(pos)))
        return Response.json({ error: "wrong_position" }, { status: 400 });

      const playerState = getState(role);
      if (playerState.roster[slot as keyof typeof playerState.roster] !== null)
        return Response.json({ error: "slot_taken" }, { status: 400 });

      (playerState.roster as unknown as Record<string, unknown>)[slot] = pickedPlayer;
      session.draftedNames.push(playerName);
      session.currentSpin = null;
      session.lastRespin = null;
      session.pickNumber++;
      session.currentTurn = session.currentTurn === "p1" ? "p2" : "p1";
      session.turnDeadline = Date.now() + TURN_LIMIT_MS;

      if (
        isRosterComplete(session.p1.roster) &&
        session.p2 &&
        isRosterComplete(session.p2.roster)
      ) {
        session.status = "complete";
        session.result = simulateSeries(session.p1.roster, session.p2.roster, session.statsMode);
        session.turnDeadline = null;

        const date = new Date().toISOString().slice(0, 10);
        const pipeline = redis.pipeline();
        pipeline.incr("versus:completed");
        pipeline.hincrby("versus:completed:by_date", date, 1);
        await pipeline.exec();
      }

      await saveSession(session);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "unknown_action" }, { status: 400 });
  } catch (err) {
    console.error("[game/action]", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
