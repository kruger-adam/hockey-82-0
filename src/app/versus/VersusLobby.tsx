"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

function getOrCreateUserId(): string {
  try {
    let id = localStorage.getItem("hockey-user-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("hockey-user-id", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function VersusLobby() {
  const router = useRouter();
  const [mode, setMode] = useState<"menu" | "create" | "join" | "matchmaking">("menu");
  const statsMode = "best";
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState<{ wins: number; losses: number; rank: number | null; totalPlayers: number } | null>(null);
  const [username, setUsername] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    const playerId = getOrCreateUserId();
    fetch(`/api/player/stats?playerId=${playerId}`)
      .then((r) => r.json())
      .then((d) => { if (d.wins > 0 || d.losses > 0) setRecord(d); })
      .catch(() => {});
    try {
      const saved = localStorage.getItem("hockey-user-name");
      if (saved) setUsername(saved);
    } catch { /* ignore */ }
  }, []);

  async function saveName(name: string) {
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) { setEditingName(false); return; }
    setUsername(trimmed);
    setEditingName(false);
    try { localStorage.setItem("hockey-user-name", trimmed); } catch { /* ignore */ }
    const playerId = getOrCreateUserId();
    await fetch("/api/player/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, name: trimmed }),
    }).catch(() => {});
  }
  const [matchStatus, setMatchStatus] = useState<"searching" | "found_human" | "found_bot">("searching");
  const [countdown, setCountdown] = useState(10);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  async function createGame() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: getOrCreateUserId(), statsMode }),
      });
      const data = await res.json();
      if (data.roomCode) {
        router.push(`/versus/${data.roomCode}`);
        return; // stay in loading state until navigation takes over
      }
      setError("Failed to create game.");
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  }

  async function joinGame() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: getOrCreateUserId(), roomCode: code }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/versus/${code}`);
      } else {
        setError(
          data.error === "full"
            ? "Game is full."
            : data.error === "not_found"
            ? "Room not found."
            : "Error joining game."
        );
      }
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  }

  async function createBotGame(playerId: string) {
    await fetch(`/api/matchmaking?playerId=${playerId}`, { method: "DELETE" }).catch(() => {});
    setMatchStatus("found_bot");
    try {
      const res = await fetch("/api/game/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      const data = await res.json();
      if (data.roomCode) setTimeout(() => router.push(`/versus/${data.roomCode}`), 1500);
    } catch {
      setError("Network error.");
      setMode("menu");
    }
  }

  async function findMatch() {
    setMode("matchmaking");
    setMatchStatus("searching");
    setCountdown(10);
    matchedRef.current = false;
    const playerId = getOrCreateUserId();

    try {
      const res = await fetch("/api/matchmaking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      const data = await res.json();
      if (data.matched && !matchedRef.current) {
        matchedRef.current = true;
        setMatchStatus("found_human");
        setTimeout(() => router.push(`/versus/${data.roomCode}`), 1500);
        return;
      }
    } catch {
      setError("Network error.");
      setMode("menu");
      return;
    }

    // Start countdown — after 10s, fall back to bot
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          if (!matchedRef.current) {
            matchedRef.current = true;
            createBotGame(playerId);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Poll for a human match in parallel
    pollRef.current = setInterval(async () => {
      if (matchedRef.current) return;
      try {
        const r = await fetch(`/api/matchmaking?playerId=${playerId}`);
        const d = await r.json();
        if (d.matched && !matchedRef.current) {
          matchedRef.current = true;
          clearInterval(pollRef.current!);
          clearInterval(countdownRef.current!);
          setMatchStatus("found_human");
          setTimeout(() => router.push(`/versus/${d.roomCode}`), 1500);
        }
      } catch { /* ignore */ }
    }, 1500);
  }

  async function cancelMatchmaking() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    matchedRef.current = true; // prevent bot game from firing
    const playerId = getOrCreateUserId();
    await fetch(`/api/matchmaking?playerId=${playerId}`, { method: "DELETE" }).catch(() => {});
    setMode("menu");
  }

  if (mode === "matchmaking") {
    if (matchStatus === "found_human") {
      return (
        <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto text-center">
          <div className="text-5xl">🏒</div>
          <p className="font-black text-xl text-green-400">Found a match!</p>
          <p className="text-muted-foreground text-sm">You're playing a real opponent. Get ready…</p>
        </div>
      );
    }

    if (matchStatus === "found_bot") {
      return (
        <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto text-center">
          <div className="text-5xl">🤖</div>
          <p className="font-black text-xl text-foreground">Playing vs Bot</p>
          <p className="text-muted-foreground text-sm">No opponents found — launching a bot game.</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto text-center">
        <div className="text-5xl animate-pulse">🏒</div>
        <p className="font-semibold text-lg">Looking for a match…</p>
        <p className="text-muted-foreground text-sm">
          No match in <span className="tabular-nums font-bold text-foreground">{countdown}s</span>? No worries, we'll match you with a bot instead.
        </p>
        <button
          onClick={() => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            matchedRef.current = true;
            createBotGame(getOrCreateUserId());
          }}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2"
        >
          Jump straight to bot
        </button>
        <button
          onClick={cancelMatchmaking}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (mode === "join") {
    return (
      <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
        <p className="text-sm text-muted-foreground">Enter the 6-character room code:</p>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && joinGame()}
          maxLength={6}
          placeholder="ABC123"
          autoFocus
          className="w-full px-4 py-4 rounded-lg border border-border bg-card text-foreground text-center text-3xl font-black tracking-widest uppercase focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <Button
          onClick={joinGame}
          disabled={loading || joinCode.trim().length < 6}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-6"
        >
          {loading ? "Joining…" : "Join Game"}
        </Button>
        <button
          onClick={() => setMode("menu")}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground underline text-center"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
      {record && (
        <div className="text-center py-2">
          <span className="text-sm font-bold tabular-nums">{record.wins}W – {record.losses}L</span>
          {record.rank !== null && (
            <span className="text-xs text-muted-foreground/70 ml-2">
              · Rank #{record.rank.toLocaleString()} of {record.totalPlayers.toLocaleString()}
            </span>
          )}
        </div>
      )}
      {/* Username */}
      <div className="text-center">
        {editingName ? (
          <div className="flex items-center justify-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName(nameDraft);
                if (e.key === "Escape") setEditingName(false);
              }}
              onBlur={() => saveName(nameDraft)}
              maxLength={20}
              placeholder="Your name"
              className="px-2 py-1 rounded border border-border bg-card text-foreground text-sm text-center focus:outline-none focus:border-blue-500/60 w-36"
            />
          </div>
        ) : (
          <button
            onClick={() => { setNameDraft(username); setEditingName(true); }}
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {username ? `Playing as ${username} · edit` : "Set a display name"}
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      <Button
        onClick={createGame}
        disabled={loading}
        className="w-full bg-orange-500 hover:bg-orange-400 text-white font-black py-6 text-base tracking-widest uppercase"
      >
        {loading ? "Creating…" : "Challenge a Friend"}
      </Button>
      <Button
        onClick={findMatch}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-500 text-white font-black py-6 text-base tracking-widest uppercase"
      >
        {loading ? "Searching…" : "Play vs Random"}
      </Button>
      <div className="text-center mt-1">
        <button
          onClick={() => setMode("join")}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground underline"
        >
          Have a room code? Join here
        </button>
      </div>
    </div>
  );
}
