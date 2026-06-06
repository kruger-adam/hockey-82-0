import Link from "next/link";
import VersusBoardClient from "./VersusBoardClient";

export default async function VersusRoomPage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;

  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background">
      <header className="w-full flex flex-col items-center py-6 px-4">
        <Link
          href="/versus"
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground mb-3 transition-colors self-start"
        >
          ← Lobby
        </Link>
        <h1 className="text-2xl font-black text-foreground tracking-tight">Head-to-Head</h1>
      </header>
      <div className="flex-1 flex flex-col items-center px-4 pb-12">
        <VersusBoardClient roomCode={roomCode} />
      </div>
      <footer className="w-full text-center py-6 text-xs text-muted-foreground/50 border-t border-border/30">
        82-0 Hockey is an independent fan project, not affiliated with the NHL.
      </footer>
    </main>
  );
}
