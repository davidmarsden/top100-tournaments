import fs from 'node:fs';

const component = fs.readFileSync(new URL('../src/components/AdminPollBuilder.jsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261002_audited_voting_deadline_edits.sql', import.meta.url), 'utf8');

for (const expected of ['Edit poll closing date', 'update_voting_event_deadline', 'new_closes_at', "['draft', 'open']"]) {
  if (!component.includes(expected)) throw new Error(`AdminPollBuilder missing: ${expected}`);
}
for (const expected of ['update_voting_event_deadline', "v_status not in ('draft', 'open')", 'event_deadline_updated', 'public.is_admin()']) {
  if (!migration.includes(expected)) throw new Error(`deadline migration missing: ${expected}`);
}

console.log('Poll deadline editor regression check passed.');
