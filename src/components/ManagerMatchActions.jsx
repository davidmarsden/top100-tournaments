import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const STATES = {
  sent: { label: 'REQUEST SENT', icon: '✓' },
  received: { label: 'REQUEST RECEIVED', icon: '✓' },
  chased: { label: 'CHASED', icon: '✉️' },
  arranged: { label: 'ARRANGED', icon: '✓' },
  problem: { label: 'PROBLEM', icon: '⚠️' },
};

function opponentName(match, entry) {
  const home = match.home_entry_id === entry.id;
  return home ? (match.away_entry?.teams?.name || match.away_placeholder || 'opponent') : (match.home_entry?.teams?.name || match.home_placeholder || 'opponent');
}
function dateLabel(value) {
  if (!value) return 'Date TBC';
  const [y,m,d] = value.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
}

export default function ManagerMatchActions({ session, selectedEntry, fixtures = [] }) {
  const [reports,setReports]=useState({});
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [uploading,setUploading]=useState('');
  const ALLOWED_EVIDENCE_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif']);

  useEffect(()=>{
    if (!session?.user?.id || !fixtures.length) { setReports({}); return; }
    let active=true;
    supabase.from('manager_match_arrangements').select('*').eq('auth_user_id',session.user.id).in('match_id',fixtures.map(f=>f.id))
      .then(({data,error})=>{ if(!active)return; if(error)setMessage(error.message); else setReports(Object.fromEntries((data||[]).map(r=>[r.match_id,r]))); });
    return ()=>{active=false};
  },[session?.user?.id, fixtures.map(f=>f.id).join(',')]);

  const rows=useMemo(()=>fixtures.map(match=>{
    const home=match.home_entry_id===selectedEntry?.id;
    return {match,home,opponent:opponentName(match,selectedEntry),report:reports[match.id]||null};
  }),[fixtures,selectedEntry,reports]);

  async function record(match,status) {
    if(uploading){ setMessage('Wait for the evidence upload to finish before changing the fixture status.'); return; }
    setBusy(match.id+status); setMessage('');
    const {data,error}=await supabase.rpc('record_manager_match_arrangement_action',{
      p_match_id: match.id,
      p_tournament_entry_id: selectedEntry.id,
      p_status: status,
    });
    if(error){setMessage(error.message);setBusy('');return;}
    setReports(current=>({...current,[match.id]:Array.isArray(data)?data[0]:data}));
    setBusy('');
  }

  async function uploadEvidence(match,file) {
    if(!file)return;
    const current=reports[match.id];
    if(!current?.status){
      setMessage('Record what happened first, then attach evidence to that action.');
      return;
    }
    if(!ALLOWED_EVIDENCE_TYPES.has(file.type)){setMessage('Evidence must be a JPEG, PNG, WebP or GIF image.');return;}
    if(file.size>8*1024*1024){setMessage('Evidence images must be 8 MB or smaller.');return;}
    setUploading(match.id); setMessage('');
    const extByType={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
    const ext=extByType[file.type];
    const previousPath=current.evidence_path;
    const previousFile=previousPath?.split('/').pop()||'';
    const slot=previousFile.startsWith('evidence-a.')?'b':'a';
    const path=`${session.user.id}/${match.id}/evidence-${slot}.${ext}`;
    const uploaded=await supabase.storage.from('match-evidence').upload(path,file,{contentType:file.type,upsert:false});
    if(uploaded.error){setMessage(uploaded.error.message);setUploading('');return;}
    const {data,error}=await supabase.rpc('attach_manager_match_evidence',{
      p_match_id: match.id,
      p_evidence_path: path,
      p_evidence_name: file.name,
    });
    if(error){
      await supabase.storage.from('match-evidence').remove([path]);
      setMessage(error.message);
    } else {
      // Alternate between two bounded keys so the currently referenced object is
      // never overwritten before the metadata swap succeeds.
      if(previousPath && previousPath!==path) {
        const removed=await supabase.storage.from('match-evidence').remove([previousPath]);
        if(removed.error)setMessage('New evidence saved, but the previous file could not be removed: '+removed.error.message);
      }
      setReports(old=>({...old,[match.id]:Array.isArray(data)?data[0]:data}));
    }
    setUploading('');
  }

  if(!selectedEntry || !rows.length)return null;
  return <section className="card match-action-centre">
    <div className="card-header"><p className="eyebrow">👤 My Matches</p><h2>What do I need to do?</h2></div>
    <p className="muted">Record what has actually happened. Once a request is sent or received, the advice updates. Add a screenshot when useful — especially if a fixture becomes disputed.</p>
    {message&&<p className="status" role="status">{message}</p>}
    <div className="match-action-list">{rows.map(({match,home,opponent,report})=>{
      const done=report?.status==='arranged'||(home&&report?.status==='sent')||(!home&&report?.status==='received');
      const state=report?STATES[report.status]:null;
      return <article className={`match-action-row ${done?'is-done':''} ${report?.status==='problem'?'has-problem':''}`} key={match.id}>
        <div className="match-action-badge">{state?`${state.icon} ${state.label}`:(home?'🏠 YOU SEND':'📨 THEY SEND')}</div>
        <div className="match-action-fixture"><strong>{opponent}</strong><span>{match.round} · {match.bracket||match.stage}</span><time>{dateLabel(match.fixture_date)}</time></div>
        <div className="match-action-advice">{done?<><strong>Nothing else to do.</strong><span>{home?'Friendly request recorded as sent.':'Friendly request recorded as received.'}</span></>:report?.status==='chased'?<><strong>Chase recorded.</strong><span>Waiting for {opponent}. Add evidence or flag a problem if needed.</span></>:report?.status==='problem'?<><strong>Needs organiser help.</strong><span>Your problem report is recorded. Add evidence below if you have it.</span></>:<span>{home?`Send the Soccer Manager friendly request to ${opponent}.`:`Expect a friendly request from ${opponent}. If it has not arrived, chase them — do not wait for the deadline.`}</span>}</div>
        <div className="match-action-controls">
          {home?<button type="button" onClick={()=>record(match,'sent')} disabled={!!busy||!!uploading}>✓ Request sent</button>:<><button type="button" onClick={()=>record(match,'received')} disabled={!!busy||!!uploading}>✓ Request received</button><button type="button" className="secondary" onClick={()=>record(match,'chased')} disabled={!!busy||!!uploading}>✉️ I chased them</button></>}
          {report?.status!=='problem'&&<button type="button" className="secondary danger-soft" onClick={()=>record(match,'problem')} disabled={!!busy||!!uploading}>⚠️ Problem arranging match</button>}
          <label className="button secondary evidence-button">📎 {uploading===match.id?'Uploading…':report?.evidence_path?'Replace evidence':'Add evidence'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading===match.id} onChange={async e=>{const input=e.currentTarget; const file=input.files?.[0]; try{await uploadEvidence(match,file);}finally{input.value='';}}}/></label>
          {report?.evidence_name&&<small>📷 {report.evidence_name}</small>}
        </div>
      </article>
    })}</div>
  </section>;
}
