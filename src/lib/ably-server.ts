import Ably from "ably";
import type { GameSession } from "./versus-types";

let client: Ably.Rest | null = null;

function getClient(): Ably.Rest {
  if (!client) client = new Ably.Rest(process.env.ABLY_API_KEY!);
  return client;
}

export async function publishGameState(session: GameSession): Promise<void> {
  try {
    const channel = getClient().channels.get(`game:${session.id}`);
    await channel.publish("state", session);
  } catch (err) {
    console.error("[ably] publish failed", err);
  }
}
