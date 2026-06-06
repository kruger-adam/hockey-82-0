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
        <div className="flex gap-4 mt-3">
          <Link href="/how-it-works" className="text-xs text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2">
            How It Works
          </Link>
          <a href="https://ko-fi.com/hockey82and0" target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2">
            Support Us
          </a>
          <a href="https://forms.gle/Xums9NeZYGMtGsA97" target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-2">
            Feedback
          </a>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center px-4 pb-12">
        <Link
          href="/versus"
          className="w-full max-w-lg mb-6 flex items-center justify-between gap-4 rounded-xl border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/50 transition-all px-4 py-3 group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-blue-400 border border-blue-500/40 rounded px-1.5 py-0.5">
              New
            </span>
            <div className="min-w-0">
              <p className="font-bold text-sm text-foreground leading-tight">Head-to-Head Mode</p>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                Draft a team and compete with friends or strangers in a best-of-7 series.
              </p>
            </div>
          </div>
          <span className="shrink-0 text-blue-400 group-hover:translate-x-0.5 transition-transform">→</span>
        </Link>
        <GameBoard />
      </div>

      <footer className="w-full text-center py-6 text-xs text-muted-foreground/50 border-t border-border/30">
        82-0 Hockey is an independent fan project, not affiliated with the NHL.
      </footer>
    </main>
  );
}
