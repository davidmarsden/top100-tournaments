import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Transfer bans in force (rule 7), for every signed-in manager: public_transfer_bans().
// Shown on the Manager Portal home and Squad & Transfers, and used by the transfer board, so
// nobody deals with a banned club by mistake. A manager whose own club is banned gets a banner.

const longDate = (value) => (value ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

export const BAN_TERMS = {
  external_cash_sales_only: 'Cash sales to clubs outside Top 100 only',
  no_transfers: 'No transfers at all',
};

function started(ban) {
  return ban.starts_on <= new Date().toISOString().slice(0, 10);
}

// Active bans for a world, or [] (also while loading or on error: callers that must show an
// error state use the hook's error).
export function useTransferBans(enabled = true, worldSlug = 'top-100') {
  const [bans, setBans] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled || !supabase) return undefined;
    let active = true;
    supabase.rpc('public_transfer_bans', { p_world_slug: worldSlug }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setError(rpcError.message || 'Could not load the transfer bans.');
      else setBans(Array.isArray(data) ? data : []);
    });
    return () => { active = false; };
  }, [enabled, worldSlug]);
  return { bans, error };
}

// The banner a banned manager sees about their own club.
export function OwnClubBanBanner({ bans, sourceClubId }) {
  const ban = (bans || []).find((row) => sourceClubId && String(row.source_club_id) === String(sourceClubId));
  if (!ban) return null;
  return (
    <div className="transfer-ban-banner" role="alert">
      <strong>{ban.club_name} is under a transfer ban {started(ban) ? 'until' : `from ${longDate(ban.starts_on)} to`} {longDate(ban.ends_on)}.</strong>
      {' '}{BAN_TERMS[ban.terms] || ban.terms}. Any other deal breaks the ban (rule 7). <a href="https://smtop100.blog/rules/">Read the rules</a>
    </div>
  );
}

// The full list. Renders nothing when there are no bans and hideWhenEmpty is set.
export default function TransferBansCard({ bans, error = '', hideWhenEmpty = false }) {
  if (!error && bans && !bans.length && hideWhenEmpty) return null;
  if (!error && !bans && hideWhenEmpty) return null;
  return (
    <section className="card portal-panel transfer-bans-card" aria-labelledby="transfer-bans-heading">
      <div className="card-header"><p className="eyebrow">Rule 7</p><h2 id="transfer-bans-heading">Transfer bans{bans ? ` (${bans.length})` : ''}</h2></div>
      <p className="muted">These clubs can't sign players, take loans or deal with other Top 100 managers until their ban ends. Don't offer them deals or accept theirs.</p>
      {error ? <p className="status">Couldn’t load this list: {error}</p>
        : !bans ? <p className="muted">Loading…</p>
          : !bans.length ? <p className="muted">No club is under a transfer ban.</p>
            : (
              <div className="table-wrap">
                <table className="portal-table">
                  <thead><tr><th>Club</th><th>Manager</th><th>Div</th><th>Until</th><th>Allowed</th></tr></thead>
                  <tbody>
                    {bans.map((ban) => (
                      <tr key={`${ban.source_club_id}-${ban.starts_on}`}>
                        <td><strong>{ban.club_name}</strong></td>
                        <td>{ban.manager_name || '–'}</td>
                        <td>{ban.division ?? '–'}</td>
                        <td>{started(ban) ? '' : `from ${longDate(ban.starts_on)} to `}{longDate(ban.ends_on)}</td>
                        <td>{BAN_TERMS[ban.terms] || ban.terms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </section>
  );
}
