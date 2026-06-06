import type { Position } from "./players";
import type { Roster } from "./simulation";
import { ROSTER_SLOTS } from "./simulation";
import {
  getAllTeamDecadeCombos,
  getPlayersForTeamDecade,
  getDecadesForTeam,
  getTeamsForDecade,
} from "./players";

export const EMPTY_ROSTER: Roster = { C: null, LW: null, RW: null, D1: null, D2: null, G: null };

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function getOpenPositions(roster: Roster): Set<Position> {
  const open = new Set<Position>();
  for (const { slot, positions } of ROSTER_SLOTS) {
    if (roster[slot] === null) positions.forEach((p) => open.add(p));
  }
  return open;
}

export function pickRandomCombo(
  roster: Roster,
  draftedNames: string[],
  exclude?: { decade: string; team: string }
): { decade: string; team: string } | null {
  const openPos = getOpenPositions(roster);
  const eligible = getAllTeamDecadeCombos().filter(
    ({ decade, team }) =>
      !(exclude && exclude.decade === decade && exclude.team === team) &&
      getPlayersForTeamDecade(decade, team).some(
        (p) => !draftedNames.includes(p.name) && p.position.some((pos) => openPos.has(pos))
      )
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export function pickNewDecadeForTeam(
  team: string,
  currentDecade: string,
  roster: Roster,
  draftedNames: string[]
): string | null {
  const openPos = getOpenPositions(roster);
  const eligible = getDecadesForTeam(team).filter(
    (decade) =>
      decade !== currentDecade &&
      getPlayersForTeamDecade(decade, team).some(
        (p) => !draftedNames.includes(p.name) && p.position.some((pos) => openPos.has(pos))
      )
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export function pickNewTeamInDecade(
  decade: string,
  currentTeam: string,
  roster: Roster,
  draftedNames: string[]
): string | null {
  const openPos = getOpenPositions(roster);
  const eligible = getTeamsForDecade(decade).filter(
    (team) =>
      team !== currentTeam &&
      getPlayersForTeamDecade(decade, team).some(
        (p) => !draftedNames.includes(p.name) && p.position.some((pos) => openPos.has(pos))
      )
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}
