import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ManagerAccountsManager() {
  const [claims, setClaims] = useState([]);
  const [status, setStatus] = useState('Loading manager claims...');
  const [loading, setLoading] = useState(false);
  const [managerOverrides, setManagerOverrides] = useState({});

  useEffect(() => { loadClaims(); }, []);

  async function loadClaims() {
    setLoading(true);
    const { data, error } = await supabase.from('manager_portal_claims')
      .select('id, email, claimed_manager_name, claimed_club_name, suggested_manager_id, status, review_notes, created_at, managers:suggested_manager_id(id, name, display_name)')
      .order('created_at', { ascending: false });
    if (error) setStatus('Could not load manager claims: ' + error.message);
    else { setClaims(data || []); setStatus(`${data?.length || 0} manager claims loaded.`); }
    setLoading(false);
  }

  async function approve(claim) {
    const override = managerOverrides[claim.id];
    const managerId = override ? Number(override) : claim.suggested_manager_id;
    if (!managerId) return setStatus('Enter the canonical manager ID before approving this claim.');
    if (!window.confirm(`Approve ${claim.claimed_manager_name} / ${claim.claimed_club_name} for ${claim.email}?`)) return;
    setLoading(true);
    const { error } = await supabase.rpc('approve_manager_portal_claim', { target_claim_id: claim.id, target_manager_id: managerId });
    if (error) setStatus('Approval failed: ' + error.message);
    else { setStatus('Manager account linked successfully.'); await loadClaims(); }
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
      <div className="card-header row"><div><p className="eyebrow">Manager Portal</p><h3>Pending account claims</h3><p className="muted">Managers verify their email, then claim the manager name and club already held in the tournament records.</p></div><button type="button" className="secondary" onClick={loadClaims} disabled={loading}>Refresh claims</button></div>
      <p className="status">{status}</p>
      {!pending.length ? <p className="muted">No manager claims are waiting for approval.</p> : <div className="entrant-list">{pending.map((claim) => <article className="entrant-row registration-row" key={claim.id}><div className="registration-details"><strong>{claim.claimed_manager_name} · {claim.claimed_club_name}</strong><span>{claim.email}</span><span>{claim.suggested_manager_id ? `Suggested manager: ${claim.managers?.display_name || claim.managers?.name || 'Manager'} (#${claim.suggested_manager_id})` : 'No unique automatic match found'}</span><label>Canonical manager ID<input type="number" value={managerOverrides[claim.id] ?? claim.suggested_manager_id ?? ''} onChange={(event) => setManagerOverrides((current) => ({ ...current, [claim.id]: event.target.value }))} /></label></div><div className="button-row"><button type="button" onClick={() => approve(claim)} disabled={loading}>Approve and link</button><button type="button" className="danger" onClick={() => reject(claim)} disabled={loading}>Reject</button></div></article>)}</div>}
    </section>
    <section className="entrant-panel"><p className="eyebrow">History</p><h3>Reviewed claims</h3>{!reviewed.length ? <p className="muted">No claims reviewed yet.</p> : <div className="entrant-list">{reviewed.map((claim) => <article className="entrant-row" key={claim.id}><div><strong>{claim.claimed_manager_name} · {claim.claimed_club_name}</strong><span>{claim.email} · {claim.status}</span>{claim.review_notes && <span>{claim.review_notes}</span>}</div></article>)}</div>}</section>
  </div>;
}
