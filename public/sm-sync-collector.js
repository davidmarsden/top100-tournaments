(()=>{try{
const invocation=new URL(document.currentScript&&document.currentScript.src?document.currentScript.src:'',location.href).searchParams.get('invocation');
const id='top100-sm-private-lab-collector-script';
const existing=document.getElementById(id);if(existing)existing.remove();
const script=document.createElement('script');
script.id=id;
script.src='https://lab.smtop100.blog/sm-sync-collector.js?v='+Date.now()+(invocation?'&invocation='+encodeURIComponent(invocation):'');
script.async=true;
script.onload=()=>script.remove();
script.onerror=()=>{script.remove();const active=window.__top100SmSyncBootstrap;if(active?.win){try{active.win.close();}catch{}}delete window.__top100SmSyncBootstrap;alert('Top 100 Sync could not load the private Manager Lab collector.');};
(document.head||document.documentElement).appendChild(script);
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
