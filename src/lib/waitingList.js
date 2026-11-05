// Waiting-list score (rulebook 3.3), out of 100. Each part is published in the rulebook:
//   Top 100 record   40  half the public-record appointment score (out of 80) from Stats & History
//   Regen record     20  5 for each season managed in Top 100 Regen (Top 100 list only)
//   Gold             15  an active Gold membership
//   Focus            10  three or fewer Soccer Manager game worlds, less 1 for each further one
//   Recommendations  15  5 for each recommendation from a current manager
// Each concern from a current manager takes 10 off. Where the records don't show Gold or game worlds
// yet, half the points are used until they do.
export const WAITING_LIST_PARTS = Object.freeze([
  ['top100', 'Top 100 record', 40],
  ['regen', 'Regen record', 20],
  ['gold', 'Gold', 15],
  ['focus', 'Focus', 10],
  ['recommendations', 'Recommendations', 15],
]);

const round1 = (value) => Math.round(value * 10) / 10;

export function waitingListScore({ world, history, regenSeasons, gold, gameWorlds, endorsements = [] }) {
  const recommendations = endorsements.filter((item) => item.kind === 'recommend').length;
  const concerns = endorsements.filter((item) => item.kind === 'concern').length;
  const worlds = gameWorlds === null || gameWorlds === undefined || gameWorlds === '' ? null : Number(gameWorlds);
  const parts = {
    top100: round1(Math.min(40, Math.max(0, Number(history?.score) || 0) / 2)),
    regen: world === 'top-100' ? Math.min(20, 5 * (Number(regenSeasons) || 0)) : 0,
    gold: gold === true ? 15 : gold === false ? 0 : 7.5,
    focus: worlds === null || !Number.isFinite(worlds) ? 5 : Math.max(0, 10 - Math.max(0, worlds - 3)),
    recommendations: Math.min(15, 5 * recommendations),
    concerns: concerns ? -10 * concerns : 0,
  };
  const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return {
    score: round1(Math.min(100, Math.max(0, total))),
    returning: Boolean(history?.returning),
    parts,
    unknown: [gold !== true && gold !== false ? 'Gold' : null, worlds === null ? 'game worlds' : null].filter(Boolean),
  };
}
