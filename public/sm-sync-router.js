(()=>{try{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const origin='https://tournaments.smtop100.blog';
const load=(id,src,onerror)=>{if(document.getElementById(id)){alert('Top 100 Sync helper is already loading.');return false;}const script=document.createElement('script');script.id=id;script.src=src+(src.includes('?')?'&':'?')+'v='+Date.now();script.async=true;script.onload=()=>script.remove();script.onerror=()=>{script.remove();if(onerror)onerror();};(document.head||document.documentElement).appendChild(script);return true;};
const pending=window.__top100SmRouterWindow;
const closePending=()=>{if(pending){try{pending.close();}catch{}}if(window.__top100SmRouterWindow===pending)delete window.__top100SmRouterWindow;};
if(window.__top100ReplayTraceStop){closePending();if(confirm('Download the replay network trace now?'))window.__top100ReplayTraceStop();return;}
if(!window.liveMatchXML&&confirm('Arm replay network trace? After this, open a completed match.')){closePending();load('top100-sm-replay-network-trace-script',origin+'/sm-replay-network-trace.js',()=>alert('Could not load replay network trace helper.'));return;}
const session=(crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
const win=pending;
if(!win||win.closed){closePending();alert('Top 100 Sync lost its reserved window. Run the bookmarklet again.');return;}
try{win.location.replace(origin+'/admin/soccer-manager-sync?collectorSession='+encodeURIComponent(session));}catch{win.location=origin+'/admin/soccer-manager-sync?collectorSession='+encodeURIComponent(session);}
if(window.__top100SmRouterWindow===pending)delete window.__top100SmRouterWindow;
window.__top100SmSyncBootstrap={session,win};
const existing=document.getElementById('top100-sm-sync-collector-script');
if(existing){existing.onerror=null;existing.onload=null;existing.remove();}
const script=document.createElement('script');
script.id='top100-sm-sync-collector-script';
script.src=origin+'/sm-sync-collector.js?v='+Date.now()+'&invocation='+encodeURIComponent(session);
script.async=true;
script.onerror=()=>{
 const active=window.__top100SmSyncBootstrap;
 if(active&&active.session===session&&active.win===win){
   try{win.close();}catch{}
   delete window.__top100SmSyncBootstrap;
   alert('Top 100 Sync could not load its collector script. Soccer Manager may be blocking external scripts.');
 }
};
(document.head||document.documentElement).appendChild(script);
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
