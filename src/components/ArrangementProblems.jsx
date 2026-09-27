import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ArrangementProblems({ selectedTournament }) {
  const [rows,setRows]=useState([]);
  const [error,setError]=useState('');
  const [refreshKey,setRefreshKey]=useState(0);
  useEffect(()=>{ let live=true;
    async function load(){
      if(!selectedTournament?.id){setRows([]);return;}
      const {data,error}=await supabase.from('manager_match_arrangements')
        .select('id,match_id,status,reported_at,updated_at,evidence_name,auth_user_id,tournament_entry_id,matches!inner(id,tournament_id,fixture_date,home_entry_id,away_entry_id,home_entry:tournament_entries!matches_home_entry_id_fkey(team:teams(name)),away_entry:tournament_entries!matches_away_entry_id_fkey(team:teams(name)))')
        .eq('status','problem').eq('matches.tournament_id',selectedTournament.id).order('updated_at',{ascending:false});
      if(!live)return; if(error){setError(error.message);setRows([]);}else{setError('');setRows(data||[]);}
    } load(); return()=>{live=false};
  },[selectedTournament?.id,refreshKey]);
  async function openEvidence(row){
    setError('');
    const evidenceWindow=window.open('about:blank','_blank');
    if(!evidenceWindow){setError('Your browser blocked the evidence window. Allow pop-ups for this site and try again.');return;}
    try {
      evidenceWindow.opener=null;
      const {data:pathData,error:pathError}=await supabase.rpc('get_manager_match_evidence_path',{p_arrangement_id:row.id});
      if(pathError||!pathData) throw new Error(pathError?.message||'No evidence attached.');
      const {data,error}=await supabase.storage.from('match-evidence').createSignedUrl(pathData,300);
      if(error||!data?.signedUrl) throw new Error(error?.message||'Could not create evidence link.');
      evidenceWindow.location.replace(data.signedUrl);
    } catch(error) {
      evidenceWindow.close();
      setError(error.message);
    }
  }
  return <section className="arrangement-problems">
    <div className="card-header row"><div><p className="eyebrow">Arrangement problems</p><h3>Manager escalations</h3></div><button type="button" className="secondary" onClick={()=>setRefreshKey(k=>k+1)}>Refresh escalations</button></div>
    {error&&<p className="warning-card">{error}</p>}
    {!rows.length?<p className="muted">No arrangement problems have been reported for this tournament.</p>:
      <div className="fixture-list">{rows.map(row=>{const match=row.matches; const home=match?.home_entry?.team?.name||'Home'; const away=match?.away_entry?.team?.name||'Away'; const reporter=row.tournament_entry_id===match?.home_entry_id?home:row.tournament_entry_id===match?.away_entry_id?away:'Unknown team'; const side=row.tournament_entry_id===match?.home_entry_id?'home':row.tournament_entry_id===match?.away_entry_id?'away':'unknown'; return <article className="portal-fixture" key={row.id}>
        <div><strong>{home} v {away}</strong><p><strong>{reporter}</strong> ({side}) reported a problem arranging this fixture.</p></div>
        <div className="button-row">{row.evidence_name?<button type="button" className="secondary" onClick={()=>openEvidence(row)}>View evidence</button>:<span className="muted">No evidence attached</span>}</div>
      </article>})}</div>}
  </section>;
}
