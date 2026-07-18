import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ManagerAccountsManager() {
  const [claims, setClaims] = useState([]);
  const [status, setStatus] = useState('Loading manager claims...');
  const [loading, setLoading] = useState(false);
  const [managerOverrides, setManagerOverrides] = useState({});
  const [selectedTeams, setSelectedTeams] = useState({});
  const [rememberAliases, setRememberAliases] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [suggestionErrors, setSuggestionErrors] = useState({});

  useEffect(() => { loadClaims(); }, []);

  async function loadClaims() {
    setLoading(true);
    const { data, error } = await supabase.from('manager_portal_claims')
      .select('id, email, claimed_manager_name, claimed_club_name, suggested_manager_id, status, review_notes, created_at, managers:suggested_manager_id(id, name, display_name)')
      .order('created_at', { ascending: false });

    if (error) {
      setStatus('Could not load manager claims: ' + error.message);
      setLoading(false);
      return;
    }

    const nextClaims = data || [];
    setClaims(nextClaims);
    setStatus(`${nextClaims.length} manager claims loaded.`);
    await loadSuggestions(nextClaims.filter((claim) => claim.status === 'pending'));
    setLoading(false);
  }

  async function loadSuggestions(pendingClaims) {
    const results = await Promise.all(pendingClaims.map(async (claim) => {
      const { data, error } = await supabase.rpc('manager_portal_claim_suggestions', {
        target_claim_id: claim.id,
      });
      return { claimId: claim.id, rows: data || [], error };
    }));

    setSuggestions(Object.fromEntries(results.map(({ claimId, rows, error }) => [claimId, error ? [] : rows])));
    setSuggestionErrors(Object.fromEntries(results.filter(({ error }) => error).map(({ claimId, error }) => [claimId, error.message])));

    setManagerOverrides((current) => {
      const next = { ...current };
      results.forEach(({ claimId, rows, error }) => {
        if (!error && rows[0] && !next[claimId]) next[claimId] = String(rows[0].manager_id);
      });
      return next;
    });

    setSelectedTeams((current) => {
      const next = { ...current };
      results.forEach(({ claimId, rows, error }) => {
        if (!error && rows[0] && !next[claimId]) next[claimId] = String(rows[0].team_id);
      });
      return next;
    });
  }

  function chooseSuggestion(claimId, suggestion) {
    setManagerOverrides((current) => ({ ...current, [claimId]: String(suggestion.manager_id) }));
    setSelectedTeams((current) => ({ ...current, [claimId]: String(suggestion.team_id) }));
    setRememberAliases((current) => ({ ...current, [claimId]: current[claimId] ?? true }));
  }

  async function approve(claim) {
    const managerId = Number(managerOverrides[claim.id] || claim.suggested_manager_id);
    const teamId = selectedTeams[claim.id] ? Number(selectedTeams[claim.id]) : null;
    if (!managerId) return setStatus('Choose a suggested match or enter the canonical manager ID.');

    const chosen = (suggestions[claim.id] || []).find((row) => Number(row.manager_id) === managerId && (!teamId || Number(row.team_id) === teamId));
    const canonicalLabel = chosen ? `${chosen.manager_name} · ${chosen.team_name}` : `manager #${managerId}`;
    if (!window.confirm(`Link ${claim.claimed_manager_name} · ${claim.claimed_club_name} to ${canonicalLabel}?`)) return;

    setLoading(true);
    const { error } = await supabase.rpc('approve_manager_portal_claim_with_alias', {
      target_claim_id: claim.id,
      target_manager_id: managerId,
      target_team_id: teamId,
      remember_team_alias: rememberAliases[claim.id] !== false,
    });

    if (error) setStatus('Approval failed: ' + error.message);
    else {
      setStatus(`Manager account linked successfully${teamId && rememberAliases[claim.id] !== false ? '; club spelling remembered.' : '.'}`);
      await loadClaims();
    }
    setLoading(false);
  }

  async function reject(claim) {
    const notes = window.prompt('Reason for rejection or correction needed:', claim.review_notes || 'Please check your manager name and current club.');
    if (notes === null) return;
    setLoading(true);
    const { error } = await supabase.rpc('reject_manager_portal_claim', { target_claim_id: claim.id, notes });
    if (error) setStatus('Rejection failed: ' + error.message);
    else { setStatus('Claim rejected. The manager can correct and resubmit it.'); await loadClaims(); }
    setLoading(false);
  }

  const pending = claims.filter((claim) => claim.status === 'pending');
  const reviewed = claims.filter((claim) => claim.status !== 'pending');

  return <div className="registration-manager">
    <section className="entrant-panel">
      <div className="card-header row">
        <div>
          <p className="eyebrow">Manager Portal</p>
          <h3>Pending account claims</h3>
          <p className="muted">Choose a ranked match, approve it in one click, and optionally remember unusual club spellings for future claims.</p>
        </div>
        <button type="button" className="secondary" onClick={loadClaims} disabled={loading}>Refresh claims</button>
      </div>
      <p className="status">{status}</p>

      {!pending.length ? <p className="muted">No manager claims are waiting for approval.</p> : <div className="entrant-list">
        {pending.map((claim) => {
          const claimSuggestions = suggestions[claim.id] || [];
          const suggestionError = suggestionErrors[claim.id];
          const selectedManagerId = Number(managerOverrides[claim.id] || claim.suggested_manager_id);
          const selectedTeamId = Number(selectedTeams[claim.id] || 0);
          return <article className="entrant-row registration-row" key={claim.id}>
            <div className="registration-details">
              <strong>{claim.claimed_manager_name} · {claim.claimed_club_name}</strong>
              <span>{claim.email}</span>

              {suggestionError ? <span className="error-text">Could not load likely matches: {suggestionError}</span> : claimSuggestions.length ? <div className="claim-suggestion-list">
                <span className="muted">Possible matches</span>
                {claimSuggestions.map((suggestion) => {
                  const selected = selectedManagerId === Number(suggestion.manager_id) && selectedTeamId === Number(suggestion.team_id);
                  return <button
                    type="button"
                    className={selected ? 'claim-suggestion selected' : 'claim-suggestion'}
                    key={`${suggestion.manager_id}-${suggestion.team_id}`}
                    onClick={() => chooseSuggestion(claim.id, suggestion)}
                  >
                    <strong>{suggestion.team_name}</strong>
                    <span>{suggestion.manager_name} · S{suggestion.latest_season || '—'}{suggestion.seed ? ` · seed ${suggestion.seed}` : ''}{suggestion.group_code ? ` · group ${suggestion.group_code}` : ''}</span>
                    <small>{suggestion.confidence} · {suggestion.score}% · {(suggestion.reasons || []).join(' · ')}</small>
                  </button>;
                })}
              </div> : <span>No likely match found. Search using the canonical manager ID below.</span>}

              <label>Canonical manager ID
                <input
                  type="number"
                  value={managerOverrides[claim.id] ?? claim.suggested_manager_id ?? ''}
                  onChange={(event) => setManagerOverrides((current) => ({ ...current, [claim.id]: event.target.value }))}
                />
              </label>

              {selectedTeamId > 0 && <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberAliases[claim.id] !== false}
                  onChange={(event) => setRememberAliases((current) => ({ ...current, [claim.id]: event.target.checked }))}
                />
                Remember “{claim.claimed_club_name}” as an alias for the selected club
              </label>}
            </div>
            <div className="button-row">
              <button type="button" onClick={() => approve(claim)} disabled={loading || !selectedManagerId}>Approve and link</button>
              <button type="button" className="danger" onClick={() => reject(claim)} disabled={loading}>Reject</button>
            </div>
          </article>;
        })}
      </div>}
    </section>

    <section className="entrant-panel">
      <p className="eyebrow">History</p>
      <h3>Reviewed claims</h3>
      {!reviewed.length ? <p className="muted">No claims reviewed yet.</p> : <div className="entrant-list">
        {reviewed.map((claim) => <article className="entrant-row" key={claim.id}>
          <div><strong>{claim.claimed_manager_name} · {claim.claimed_club_name}</strong><span>{claim.email} · {claim.status}</span>{claim.review_notes && <span>{claim.review_notes}</span>}</div>
        </article>)}
      </div>}
    </section>
  </div>;
}
