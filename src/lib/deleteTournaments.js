import { supabase } from './supabaseClient';

export async function deleteTournamentsOnServer(ids) {
  const cleanIds = [...new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!cleanIds.length) throw new Error('No tournaments selected.');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) throw new Error('Your admin session has expired. Log in again.');

  const response = await fetch('/.netlify/functions/delete-tournaments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ ids: cleanIds }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Delete failed (${response.status})`);
  return payload;
}
