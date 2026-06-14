import GameBoard from "@/components/GameBoard";

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background">
      <div className="flex-1 flex flex-col items-center px-4 py-8 pb-12">
        <GameBoard />
      </div>

      <footer className="w-full text-center py-6 px-4 text-xs text-muted-foreground/50 border-t border-border/30">
        82-0 Hockey is an independent fan project, not affiliated with the NHL.
      </footer>
    </main>
  );
}
