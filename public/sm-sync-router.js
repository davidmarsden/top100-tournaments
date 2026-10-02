(()=>{try{
window.__top100SmRouterExecuted={at:Date.now(),version:'private-lab-bridge-2'};
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const id='top100-sm-private-lab-router-script';
if(document.getElementById(id)){alert('Top 100 Sync helper is already loading.');return;}
const pending=window.__top100SmRouterWindow;
const script=document.createElement('script');
script.id=id;
script.src='https://lab.smtop100.blog/sm-sync-router.js?v='+Date.now();
script.async=true;
script.onload=()=>script.remove();
script.onerror=()=>{script.remove();if(window.__top100SmRouterWindow===pending){if(pending){try{pending.close();}catch{}}delete window.__top100SmRouterWindow;}alert('Top 100 Sync could not load the private Manager Lab router.');};
(document.head||document.documentElement).appendChild(script);
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
