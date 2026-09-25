(()=>{try{
window.__top100SmRouterExecuted={at:Date.now(),version:'schedule-runtime-195'};
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const origin='https://tournaments.smtop100.blog';
const load=(id,src,onerror)=>{if(document.getElementById(id)){alert('Top 100 Sync helper is already loading.');return false;}const script=document.createElement('script');script.id=id;script.src=src+(src.includes('?')?'&':'?')+'v='+Date.now();script.async=true;script.onload=()=>script.remove();script.onerror=()=>{script.remove();if(onerror)onerror();};(document.head||document.documentElement).appendChild(script);return true;};
const pending=window.__top100SmRouterWindow;
const closePending=()=>{if(pending){try{pending.close();}catch{}}if(window.__top100SmRouterWindow===pending)delete window.__top100SmRouterWindow;};
let menuCleanup=null;
const runSync=()=>{
if(menuCleanup){window.removeEventListener('pagehide',menuCleanup);menuCleanup=null;}
const session=(crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
const win=pending;
if(!win||win.closed){closePending();alert('Please allow pop-ups for Soccer Manager, then run Top 100 Sync again.');return;}
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

};
const existingMenu=document.getElementById('top100-sm-sync-menu');
if(existingMenu){
 closePending();
 const existingPending=existingMenu.__top100PendingWindow;
 if(existingPending){try{existingPending.close();}catch{}}
 existingMenu.remove();
 return;
}
const menu=document.createElement('div');
menu.__top100PendingWindow=pending;
menuCleanup=()=>{const owned=menu.__top100PendingWindow;if(owned){try{owned.close();}catch{}}};
window.addEventListener('pagehide',menuCleanup,{once:true});
menu.id='top100-sm-sync-menu';
menu.setAttribute('role','dialog');
menu.setAttribute('aria-label','Top 100 Sync');
menu.style.cssText='position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);width:min(92vw,390px);box-sizing:border-box;padding:16px;border-radius:12px;background:#111;color:#fff;font:16px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);text-align:left';
const title=document.createElement('div');title.textContent='Top 100 Sync';title.style.cssText='font-size:19px;font-weight:700;margin-bottom:6px';menu.appendChild(title);
const note=document.createElement('div');note.textContent=window.__top100ReplayTraceStop?'Replay network trace is armed.':window.__top100ScheduleTraceStop?'Schedule network trace is armed.':'What would you like to do?';note.style.cssText='margin-bottom:12px;color:#ddd';menu.appendChild(note);
const buttons=document.createElement('div');buttons.style.cssText='display:flex;gap:8px;flex-wrap:wrap';menu.appendChild(buttons);
const button=(label,action,primary=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='border:0;border-radius:8px;padding:10px 12px;font:inherit;font-weight:650;cursor:pointer;background:'+(primary?'#fff':'#333')+';color:'+(primary?'#111':'#fff');b.onclick=()=>{menu.remove();action();};buttons.appendChild(b);};
if(window.__top100ReplayTraceStop){
 button('Download trace',()=>{closePending();window.__top100ReplayTraceStop();},true);
 button('Close',()=>closePending());
}else if(window.__top100ScheduleTraceStop){
 button('Download schedule trace',()=>{closePending();window.__top100ScheduleTraceStop();},true);
 button('Close',()=>closePending());
}else{
 button('Trace completed match',()=>{closePending();load('top100-sm-replay-network-trace-script',origin+'/sm-replay-network-trace.js',()=>alert('Could not load replay network trace helper.'));},true);
 button('Inspect schedule runtime',()=>{closePending();load('top100-sm-schedule-runtime-script',origin+'/sm-schedule-runtime.js',()=>alert('Could not load schedule runtime helper.'));},true);
 button('Trace schedule data',()=>{closePending();load('top100-sm-schedule-network-trace-script',origin+'/sm-schedule-network-trace.js',()=>alert('Could not load schedule trace helper.'));});
 button('Capture schedule response',()=>{closePending();load('top100-sm-schedule-response-script',origin+'/sm-schedule-response.js',()=>alert('Could not load schedule response helper.'));});
 button('Discover schedule results',()=>{closePending();load('top100-sm-schedule-discovery-script',origin+'/sm-schedule-discovery.js',()=>alert('Could not load schedule discovery helper.'));});
 button('Backfill Hamburg season',()=>{closePending();load('top100-sm-hamburg-season-backfill-script',origin+'/sm-hamburg-season-backfill.js',()=>alert('Could not load Hamburg season backfill helper.'));});
 button('Normal sync',()=>runSync());
 button('Close',()=>closePending());
}
(document.body||document.documentElement).appendChild(menu);
return;
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
