// node --test tests/chat-appointments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentKey, formatAppointmentPost, recentAppointments } from '../netlify/functions/lib/chatAppointments.mjs';

const now = new Date('2026-11-08T12:00:00Z');
const data = {
  season: 28,
  vacancies: [
    { id: 8, club: 'Hellas Verona', division: 1, appointed: 'Sir Stephen Beddows (God)', reason: 'A steady and trusted hand.', publishedAt: '2026-11-08T10:05:07Z' },
    { id: 9, club: 'Borussia Dortmund', division: 1, appointed: 'Scott Mckenzie', reason: 'Unanimous decision.', publishedAt: '2026-11-08T10:05:07Z' },
    { id: 3, club: 'Old Club', division: 2, appointed: 'Someone', publishedAt: '2026-10-01T10:00:00Z' },
    { id: 12, club: 'Fenerbahçe SK', division: 5, appointed: null, publishedAt: '2026-11-08T10:05:07Z' },
  ],
};

test('announces only recent appointments, not old ones or unfilled vacancies', () => {
  assert.deepEqual(recentAppointments(data, now).map((v) => v.id), [8, 9]);
  assert.equal(appointmentKey('top-100', 28, { id: 9 }), 'top-100:appointment:s28:v9');
});

test('posts the profile card when the appointee is the manager on it', () => {
  const { title, markdown } = formatAppointmentPost(28, data.vacancies[0]);
  assert.equal(title, 'New manager at Hellas Verona: Sir Stephen Beddows');
  assert.match(markdown, /^!\[Sir Stephen Beddows, new manager of Hellas Verona\]\(https:\/\/tournaments\.smtop100\.blog\/appointments\/s28\/card-beddows\.webp\)/);
  assert.match(markdown, /\*\*Sir Stephen Beddows\*\* is the new manager of \*\*Hellas Verona\*\* \(Division 1\)\./);
  assert.match(markdown, /A steady and trusted hand\./);
  assert.match(markdown, /https:\/\/tournaments\.smtop100\.blog\/appointments/);
});

test('posts without a card when there is none', () => {
  const { markdown } = formatAppointmentPost(28, { id: 20, club: 'São Paulo FC', division: 1, appointed: 'New Person' });
  assert.doesNotMatch(markdown, /!\[/);
  assert.match(markdown, /\*\*New Person\*\* is the new manager of \*\*São Paulo FC\*\*/);
});

test('announces each newly opened vacancy once it has settled, while it is still open', async () => {
  const { newVacancies, formatVacancyPost, vacancyKey } = await import('../netlify/functions/lib/chatAppointments.mjs');
  const vacancies = [
    { id: 13, season: 28, club: 'São Paulo FC', division: 1, context: 'What São Paulo needs: a winner.', closesAt: '2026-11-12T18:00:00Z', createdAt: '2026-11-08T11:00:00Z' },
    { id: 14, season: 28, club: 'Just Opened', division: 2, createdAt: '2026-11-08T11:55:00Z' },
    { id: 15, season: 28, club: 'Old', division: 3, createdAt: '2026-10-20T10:00:00Z' },
    { id: 16, season: 28, club: 'Closed', division: 3, closesAt: '2026-11-08T11:00:00Z', createdAt: '2026-11-08T10:00:00Z' },
  ];
  assert.deepEqual(newVacancies(vacancies, now).map((v) => v.id), [13]);
  assert.equal(vacancyKey('top-100', vacancies[0]), 'top-100:vacancy:s28:v13');
  const { title, markdown } = formatVacancyPost(vacancies[0]);
  assert.equal(title, 'Vacancy: São Paulo FC (Division 1)');
  assert.match(markdown, /\*\*São Paulo FC\*\* \(Division 1\) needs a new manager\./);
  assert.match(markdown, /What São Paulo needs: a winner\./);
  assert.match(markdown, /Apply in Manager Portal by Thu 12 Nov, 18:00 \(UK time\): https:\/\/manager\.smtop100\.blog\/appointments/);
  assert.doesNotMatch(markdown, /!\[/, 'no card for a vacancy without one');
  const psv = formatVacancyPost({ id: 20, season: 28, club: 'PSV', division: 4 }).markdown;
  assert.match(psv, /^!\[PSV club profile\]\(https:\/\/tournaments\.smtop100\.blog\/vacancies\/s28\/club-psv\.webp\)/);
  assert.doesNotMatch(formatVacancyPost({ id: 20, season: 28, club: 'Another club', division: 4 }).markdown, /!\[/, 'card only for its own club');
});

test('still announces appointments from a round archived soon after publishing', () => {
  const archivedData = { season: 28, vacancies: [], archivedRounds: [{ id: 1, vacancies: [data.vacancies[1]] }] };
  assert.deepEqual(recentAppointments(archivedData, now).map((v) => v.id), [9]);
});

test('announces an awards vote once it has settled, with every category and nominee', async () => {
  const { newVotes, formatVotePost, voteKey } = await import('../netlify/functions/lib/chatAppointments.mjs');
  const event = {
    id: 9, title: 'Season 28 Manager of the Season Awards', event_type: 'awards', status: 'open',
    opens_at: '2026-11-10T22:28:24Z', closes_at: '2026-11-15T12:00:00Z',
    voting_questions: [
      { title: 'Division 1 Manager of the Season', sort_order: 2, voting_options: [{ label: 'Ash L', sort_order: 2 }, { label: 'André Guerra', sort_order: 1 }] },
      { title: 'Overall Manager of the Season', sort_order: 1, voting_options: [{ label: 'Chris East', sort_order: 1 }] },
    ],
  };
  const poll = { id: 5, title: 'Old poll', event_type: 'poll', status: 'open', opens_at: '2026-09-26T17:12:56Z', closes_at: '2026-12-10T17:00:00Z' };
  assert.deepEqual(newVotes([event, poll], new Date('2026-11-10T22:30:00Z')), [], 'waits to settle');
  assert.deepEqual(newVotes([event, poll], new Date('2026-11-10T22:50:00Z')).map((e) => e.id), [9], 'old poll left out');
  assert.deepEqual(newVotes([{ ...event, status: 'draft' }], new Date('2026-11-10T22:50:00Z')), []);
  assert.equal(voteKey('top-100', event), 'top-100:vote:e9');
  const post = formatVotePost(event);
  assert.equal(post.title, 'Vote now: Season 28 Manager of the Season Awards');
  assert.match(post.markdown, /Voting closes Sun 15 Nov, 12:00 \(UK time\)/);
  assert.match(post.markdown, /\*\*Overall Manager of the Season\*\*: Chris East[\s\S]*\*\*Division 1 Manager of the Season\*\*: André Guerra, Ash L/);
  assert.match(post.markdown, /https:\/\/awards\.smtop100\.blog\/vote/);
  const huge = { ...event, voting_questions: Array.from({ length: 30 }, (_, q) => ({ title: `Category ${q} with a long name`, sort_order: q,
    voting_options: Array.from({ length: 10 }, (_, o) => ({ label: `Nominee ${q}-${o} with a long label`, sort_order: o })) })) };
  const long = formatVotePost(huge).markdown;
  assert.ok(long.length <= 3900, 'fits');
  assert.match(long, /…\n\nVote with your Manager Portal account: https:\/\/awards\.smtop100\.blog\/vote/, 'link survives shortening');
});
