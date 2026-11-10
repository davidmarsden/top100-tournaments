import { supabase } from './supabaseClient';

// The Publishing Desk (write.smtop100.blog). Opened from the Manager Portal with a one-time sign-in
// token (netlify/functions/write-handoff.js), so a signed-in manager doesn't sign in again there.
export const PUBLISHING_DESK_URL = 'https://write.smtop100.blog/';

export async function openPublishingDesk() {
  try {
    const { data } = (await supabase?.auth.getSession()) || {};
    const token = data?.session?.access_token;
    if (token) {
      const response = await fetch('/.netlify/functions/write-handoff', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.url) {
        window.location.assign(body.url);
        return;
      }
    }
  } catch {
    // Fall through to the Desk's own sign-in.
  }
  window.location.assign(PUBLISHING_DESK_URL);
}

// For a link to the Desk: a plain click opens it signed in; other clicks (new tab) use the plain link.
export function publishingDeskClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openPublishingDesk();
}
