import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HowToPlay() {
  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-b from-background via-card to-background">
      <header className="w-full flex flex-col items-center py-8 px-4">
        <h1 className="text-3xl font-black text-foreground tracking-tight">How to Play 82-0</h1>
        <p className="text-muted-foreground mt-2 text-center max-w-sm">
          Build the ultimate NHL all-time team and see if you can go 82-0!
        </p>
      </header>

      <div className="flex-1 flex flex-col items-center px-4 pb-12 gap-6 max-w-lg mx-auto w-full">
        <Section title="The Draft">
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Each round, spin to get a random NHL team and decade</li>
            <li>Select one player from that era to add to your roster</li>
            <li>Complete 6 rounds to fill your starting lineup: C, LW, RW, D, D, G</li>
          </ul>
        </Section>

        <Section title="Respins">
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Each game you get one <strong className="text-foreground">Respin Decade</strong> — keeps the same team, re-rolls to a different decade of that franchise</li>
            <li>You also get one <strong className="text-foreground">Respin Team</strong> — keeps the same decade, re-rolls to a different team from that era</li>
            <li>Each respin can only be used once per game</li>
          </ul>
        </Section>

        <Section title="Player Stats">
          <p className="text-sm text-muted-foreground mb-2">
            No ratings — just the raw numbers. Stats shown on each card are the player&apos;s <strong className="text-foreground">decade averages</strong> with that franchise, weighted by games played.
          </p>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Skaters:</strong> Goals/gm, Assists/gm, Points/gm — all projected per game</li>
            <li><strong className="text-foreground">Goalies:</strong> Save percentage (SV%) and Goals Against Average (GAA)</li>
            <li>A player who played 80 games contributes 80× more weight to their average than a player who played 1 game in a season — small samples don&apos;t inflate stats</li>
          </ul>
        </Section>

        <Section title="How the Simulation Works">
          <p className="text-sm text-muted-foreground mb-2">
            Each player has an internal rating (not shown) used to calculate win probability each game.
          </p>
          <p className="text-sm font-semibold text-foreground mb-1">Skater ratings</p>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside mb-3">
            <li>Goals and assists per 82 games are era-adjusted to a neutral scoring baseline (6.0 goals/game). A 100-point season in the high-scoring 1980s (7.7 GPG) is deflated; a 100-point season in the low-scoring 2000s (5.5 GPG) is inflated</li>
            <li>Defensemen get a 1.6× multiplier on their era-adjusted points — elite D-man scoring is rarer than forward scoring, so the scale adjusts accordingly</li>
            <li>Plus/minus contributes a small amount (×0.2) to account for defensive impact, but is weighted lightly since it reflects team strength as much as individual play</li>
            <li>Ratings scale from ~20 (fringe) to 100 (all-time great), calibrated so players like Gretzky and Lemieux at their peak hit 100</li>
          </ul>
          <p className="text-sm font-semibold text-foreground mb-1">Goalie ratings</p>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside mb-3">
            <li>Rated relative to the league-average SV% for their decade — being .015 above average in the 2010s matters more than in the 1980s, when equipment and technique varied more widely</li>
            <li>GAA also contributes, measured against the decade&apos;s reference GAA</li>
          </ul>
          <p className="text-sm font-semibold text-foreground mb-1">Team rating &amp; win probability</p>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Goalies carry 30% of the team rating; skaters (averaged across the 5) carry 70% — reflecting how much a goalie can steal or cost a game in hockey</li>
            <li>Win probability uses a sigmoid curve against a league-average opponent (rating 65). A rating of ~75 gives roughly a 73% win rate; ~85 gives ~88%; going 82-0 is genuinely rare even with an elite roster</li>
          </ul>
        </Section>

        <Link href="/" className="w-full">
          <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-5">
            Play Now
          </Button>
        </Link>
      </div>

      <footer className="w-full text-center py-6 text-xs text-muted-foreground/50 border-t border-border/30">
        82-0 Hockey is an independent fan project, not affiliated with the NHL.
      </footer>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full flex flex-col gap-3 p-4 rounded-lg border border-border/40 bg-card/30">
      <h2 className="font-bold text-foreground">{title}</h2>
      {children}
    </div>
  );
}
