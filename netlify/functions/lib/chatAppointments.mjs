// Formats Top 100 Chat announcements of published appointments (rule 3.2), one post per new
// manager, with their profile card when there is one. Kept free of Netlify globals so it can be
// tested with node.
import { cardFor } from '../../../src/lib/appointmentCards.mjs';

export const SITE_URL = 'https://tournaments.smtop100.blog';
// Only decisions published this recently are announced, so a first run doesn't post old seasons.
export const RECENT_DAYS = 3;

const clean = (value, max = 600) => String(value ?? '').replace(/\s+/g, ' ').replace(/[*_`[\]]/g, '').trim().slice(0, max);

export function appointmentKey(worldSlug, season, vacancy) {
  return `${worldSlug}:appointment:s${Number(season)}:v${Number(vacancy.id)}`;
}

// Published appointments (not unfilled vacancies) from public_appointment_decisions(), newest
// last, including rounds archived since (so a round archived soon after publishing still posts).
export function recentAppointments(data, now = new Date(), days = RECENT_DAYS) {
  const since = new Date(now).getTime() - days * 24 * 60 * 60 * 1000;
  return [...(data?.vacancies || []), ...(data?.archivedRounds || []).flatMap((round) => round.vacancies || [])]
    .filter((vacancy) => vacancy?.id != null && vacancy.appointed && Date.parse(vacancy.publishedAt) >= since)
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || Number(a.id) - Number(b.id));
}

export function formatAppointmentPost(season, vacancy, siteUrl = SITE_URL) {
  const card = cardFor(season, vacancy);
  const manager = clean(card?.manager || vacancy.appointed, 80);
  const club = clean(vacancy.club, 80);
  const division = vacancy.division ? ` (Division ${Number(vacancy.division)})` : '';
  const parts = [];
  if (card) parts.push(`![${manager}, new manager of ${club}](${siteUrl}${card.src})`);
  parts.push(`**${manager}** is the new manager of **${club}**${division}.`);
  if (vacancy.reason) parts.push(clean(vacancy.reason));
  parts.push(`Every decision, the reasons and the applicants' scores: ${siteUrl}/appointments`);
  parts.push(`How will ${club} do next season? Reply with your prediction.`);
  return { title: `New manager at ${club}: ${manager}`, markdown: parts.join('\n\n') };
}

// Vacancies -----------------------------------------------------------------------------------

export const PORTAL_APPOINTMENTS_URL = 'https://manager.smtop100.blog/appointments';
export const RULE_32_URL = 'https://smtop100.blog/rules/#32-club-vacancies-and-manager-appointments';

export function vacancyKey(worldSlug, vacancy) {
  return `${worldSlug}:vacancy:s${Number(vacancy.season)}:v${Number(vacancy.id)}`;
}

// Open vacancies from chat_open_vacancies() that opened recently and are still taking
// applications. A vacancy waits SETTLE_MINUTES after it's created, so the admin team can correct
// its details before it's announced.
export const SETTLE_MINUTES = 15;
export function newVacancies(vacancies, now = new Date(), days = RECENT_DAYS) {
  const at = new Date(now).getTime();
  const since = at - days * 24 * 60 * 60 * 1000;
  const settled = at - SETTLE_MINUTES * 60 * 1000;
  return (vacancies || [])
    .filter((v) => v?.id != null && Date.parse(v.createdAt) >= since && Date.parse(v.createdAt) <= settled
      && (!v.closesAt || Date.parse(v.closesAt) > at))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || Number(a.id) - Number(b.id));
}

const closing = (value) => new Date(value).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
});

export function formatVacancyPost(vacancy) {
  const club = clean(vacancy.club, 80);
  const division = vacancy.division ? ` (Division ${Number(vacancy.division)})` : '';
  const parts = [`**${club}**${division} needs a new manager.`];
  if (vacancy.context) parts.push(clean(vacancy.context));
  const by = vacancy.closesAt ? ` by ${closing(vacancy.closesAt)} (UK time)` : '';
  parts.push(`Apply in Manager Portal${by}: ${PORTAL_APPOINTMENTS_URL}`);
  parts.push(`How appointments are decided (rule 3.2): ${RULE_32_URL}`);
  parts.push('Who fancies it? Reply below.');
  return { title: `Vacancy: ${club}${division}`, markdown: parts.join('\n\n') };
}

// Votes -----------------------------------------------------------------------------------------

// Shared Voting events (awards and community polls) are announced once, when they open.
export const AWARDS_VOTE_URL = 'https://awards.smtop100.blog/vote';
export const POLLS_VOTE_URL = 'https://vote.smtop100.blog/';

export function voteKey(worldSlug, event) {
  return `${worldSlug}:vote:e${Number(event.id)}`;
}

// Open awards and polls that opened recently and haven't closed, after SETTLE_MINUTES so the
// admin team can correct a vote just opened.
export function newVotes(events, now = new Date(), days = RECENT_DAYS) {
  const at = new Date(now).getTime();
  const since = at - days * 24 * 60 * 60 * 1000;
  const settled = at - SETTLE_MINUTES * 60 * 1000;
  return (events || [])
    .filter((e) => e?.id != null && e.status === 'open' && ['awards', 'poll'].includes(e.event_type)
      && Date.parse(e.opens_at) >= since && Date.parse(e.opens_at) <= settled
      && (!e.closes_at || Date.parse(e.closes_at) > at))
    .sort((a, b) => Date.parse(a.opens_at) - Date.parse(b.opens_at) || Number(a.id) - Number(b.id));
}

const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

export function formatVotePost(event) {
  const title = clean(event.title, 160);
  const awards = event.event_type === 'awards';
  const by = event.closes_at ? ` Voting closes ${closing(event.closes_at)} (UK time).` : '';
  const parts = [`Voting is open: **${title}**.${by}`];
  const questions = [...(event.voting_questions || [])].sort(byOrder);
  if (awards) {
    parts.push(questions.map((question) => `**${clean(question.title, 120)}**: ${[...(question.voting_options || [])].sort(byOrder)
      .map((option) => clean(option.label, 60)).join(', ')}`).join('\n\n'));
  } else if (questions[0]) {
    parts.push(clean(questions[0].title, 300));
  }
  // Shorten the body, never the closing lines, so the voting link always survives.
  const tail = [`${awards ? 'Vote' : 'Have your say'} with your Manager Portal account: ${awards ? AWARDS_VOTE_URL : POLLS_VOTE_URL}`,
    awards ? 'Every Top 100 manager has a vote. Who gets yours?' : 'Every Top 100 manager has a vote.'].join('\n\n');
  let body = parts.join('\n\n');
  const room = 3900 - tail.length - 2;
  if (body.length > room) body = `${body.slice(0, room - 1)}…`;
  return { title: `${awards ? 'Vote now' : 'New poll'}: ${title}`, markdown: `${body}\n\n${tail}` };
}
