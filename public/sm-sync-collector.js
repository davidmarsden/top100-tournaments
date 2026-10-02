(()=>{try{
const invocation=new URL(document.currentScript&&document.currentScript.src?document.currentScript.src:'',location.href).searchParams.get('invocation');
const id='top100-sm-private-lab-collector-script';
if(document.getElementById(id)){return;}
const bootstrap=window.__top100SmSyncBootstrap;
const script=document.createElement('script');
script.id=id;
script.src='https://lab.smtop100.blog/sm-sync-collector.js?v='+Date.now()+(invocation?'&invocation='+encodeURIComponent(invocation):'');
script.async=true;
script.onload=()=>script.remove();
script.onerror=()=>{script.remove();if(window.__top100SmSyncBootstrap===bootstrap){if(bootstrap?.win){try{bootstrap.win.close();}catch{}}delete window.__top100SmSyncBootstrap;}alert('Top 100 Sync could not load the private Manager Lab collector.');};
(document.head||document.documentElement).appendChild(script);
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
