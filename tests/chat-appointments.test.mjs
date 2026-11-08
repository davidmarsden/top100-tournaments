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
});
