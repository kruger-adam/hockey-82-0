import Link from "next/link";
import VersusLobby from "./VersusLobby";

export default function VersusPage() {
  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background">
      <header className="w-full flex flex-col items-center py-8 px-4">
        <Link
          href="/"
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground mb-4 transition-colors"
        >
          ← Back to Solo
        </Link>
        <h1 className="text-4xl font-black text-foreground tracking-tight">Head-to-Head</h1>
        <p className="text-muted-foreground mt-2 text-center max-w-sm">
          Draft your all-time roster and face off in a best-of-7 series.
        </p>
      </header>
      <div className="flex-1 flex flex-col items-center px-4 pb-12">
        <VersusLobby />
      </div>
      <footer className="w-full text-center py-6 text-xs text-muted-foreground/50 border-t border-border/30">
        82-0 Hockey is an independent fan project, not affiliated with the NHL.
      </footer>
    </main>
  );
}
