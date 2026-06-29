import Link from "next/link";
import { ALL_TEAMS } from "@/lib/franchise";

const CONF_ORDER = ["Eastern", "Western"];
const DIV_ORDER: Record<string, string[]> = {
  Eastern: ["Atlantic", "Metropolitan"],
  Western: ["Central", "Pacific"],
};

export default function FranchisePicker() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">GM Mode</p>
          <h1 className="text-2xl font-bold">Choose Your Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a current NHL team, make trades, then simulate the season.
          </p>
        </div>

        {CONF_ORDER.map(conf => (
          <div key={conf} className="mb-10">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4">{conf} Conference</p>
            {DIV_ORDER[conf].map(div => {
              const teams = ALL_TEAMS.filter(t => t.conf === conf && t.div === div);
              return (
                <div key={div} className="mb-6">
                  <p className="text-xs text-muted-foreground mb-2 ml-1">{div}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {teams.map(team => (
                      <Link
                        key={team.abbrev}
                        href={`/gm/${team.abbrev}`}
                        className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-card hover:border-border hover:bg-card/80 transition-all"
                      >
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: team.color }}
                        >
                          {team.abbrev}
                        </div>
                        <span className="text-xs text-center text-muted-foreground group-hover:text-foreground transition-colors leading-tight">
                          {team.name.split(" ").slice(-1)[0]}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div className="text-center mt-6">
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back to 82-0 Mode
          </Link>
        </div>
      </div>
    </main>
  );
}
