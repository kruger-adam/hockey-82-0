import Link from "next/link";
import GameBoard from "@/components/GameBoard";

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background">
      <header className="w-full flex flex-col items-center py-8 px-4">
        <h1 className="text-4xl font-black text-foreground tracking-tight">
          Can you go 82-0?
        </h1>
        <p className="text-muted-foreground mt-2 text-center max-w-sm">
          Spin through NHL history, draft your all-time roster, and simulate a perfect season.
        </p>
        <Link href="/how-it-works" className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2">
          How It Works
        </Link>
      </header>

      <div className="flex-1 flex flex-col items-center px-4 pb-12">
        <GameBoard />
      </div>

      <footer className="w-full text-center py-6 text-xs text-muted-foreground/50 border-t border-border/30 flex flex-col gap-1">
        <p>
          Enjoying the game?{" "}
          <a href="https://ko-fi.com/hockey82and0" target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2">
            Help support us
          </a>
          {" "}|{" "}
          <a href="https://forms.gle/Xums9NeZYGMtGsA97" target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2">
            Share feedback
          </a>
        </p>
        <p>82-0 Hockey is an independent fan project, not affiliated with the NHL.</p>
      </footer>
    </main>
  );
}
