(()=>{try{
// Legacy entry point for Top 100 Sync bookmarklets created on tournaments.smtop100.blog.
// Sync now lives in top100-manager-lab: load the same helpers, in the same order, as the lab's own
// bookmarklet (player-changes DOM adapter, then router), so old bookmarklets keep working unchanged.
window.__top100SmRouterExecuted={at:Date.now(),version:'private-lab-bridge-3'};
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const id='top100-sm-private-lab-router-script';
if(document.getElementById(id)){alert('Top 100 Sync helper is already loading.');return;}
const pending=window.__top100SmRouterWindow;
const loadRouter=()=>{
const script=document.createElement('script');
script.id=id;
script.src='https://lab.smtop100.blog/sm-sync-router.js?v='+Date.now();
script.async=true;
script.onload=()=>script.remove();
script.onerror=()=>{script.remove();if(window.__top100SmRouterWindow===pending){if(pending){try{pending.close();}catch{}}delete window.__top100SmRouterWindow;}alert('Top 100 Sync could not load the private Manager Lab router.');};
(document.head||document.documentElement).appendChild(script);
};
const bridge=document.createElement('script');
bridge.src='https://lab.smtop100.blog/sm-player-changes-dom-adapter.js?v='+Date.now();
bridge.async=true;
bridge.onload=()=>{bridge.remove();loadRouter();};
bridge.onerror=()=>{bridge.remove();loadRouter();};
(document.head||document.documentElement).appendChild(bridge);
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
