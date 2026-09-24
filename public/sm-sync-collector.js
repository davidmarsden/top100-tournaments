(async()=>{try{
const target='https://tournaments.smtop100.blog/admin/soccer-manager-sync',helloType='top100-sm-sync-hello',msgType='top100-sm-sync-payloads',readyType='top100-sm-sync-ready',ackType='top100-sm-sync-ack',enginePaths=new Set(['/js/projx/constants.js','/js/projx/jsutil.js','/js/projx/random.js','/js/projx/randomdata.js','/js/projx/attributes.js','/js/projx/formationdata.js','/js/projx/positions.js','/js/projx/matchreportcommentary.js','/js/pages/livematch.js','/js/pages/livematch2d.js']);
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const patterns=[/competition-ajax\.php/i,/club-ajax-mobile\.php/i,/playerchanges[^/]*\.php/i,/transfer[^/]*market[^/]*\.php/i];
const sensitive=/(?:token|session|sessid|phpsessid|auth|secret|password|passwd|cookie|key)/i;
const sanitize=u=>{try{const x=new URL(u,location.href);if(x.origin!==location.origin)return null;for(const k of [...x.searchParams.keys()])if(sensitive.test(k))x.searchParams.set(k,'[redacted]');x.hash='';return x.toString();}catch{return null;}};
const resources=performance.getEntriesByType('resource').filter(e=>{try{return new URL(e.name,location.href).origin===location.origin;}catch{return false;}});
const diagnostics=resources.slice(-50).map(e=>({url:sanitize(e.name),initiatorType:e.initiatorType||null,startTime:Math.round(e.startTime)})).filter(e=>e.url);
const matched=resources.map(e=>e.name).filter(u=>patterns.some(r=>r.test(u)));
const seen=new Set(),urls=[];
for(let i=matched.length-1;i>=0;i--){if(seen.has(matched[i]))continue;seen.add(matched[i]);urls.push(matched[i]);}
urls.reverse();
const session=(crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
const syncUrl=target+'?collectorSession='+encodeURIComponent(session);
const win=window.open(syncUrl,'top100-sm-sync');
if(!win){alert('Please allow pop-ups for Soccer Manager, then try Top 100 Sync again.');return;}
let ready=false,done=false;
const onMessage=e=>{if(e.origin!=='https://tournaments.smtop100.blog'||e.source!==win||!e.data||e.data.session!==session)return;if(e.data.type===readyType)ready=true;if(e.data.type===ackType){done=true;window.removeEventListener('message',onMessage);}};
window.addEventListener('message',onMessage);
const payloads=[];
for(const url of urls){try{const res=await fetch(url,{credentials:'include',cache:'no-store'});if(!res.ok)continue;const type=(res.headers.get('content-type')||'').toLowerCase();const safeUrl=sanitize(url);if(!safeUrl)continue;if(!type.includes('json')){const text=await res.text();try{payloads.push({url:safeUrl,data:JSON.parse(text)});}catch{}continue;}payloads.push({url:safeUrl,data:await res.json()});}catch{}}
const engineCandidates=[];
const engineSeen=new Set();
for(const entry of resources){try{const u=new URL(entry.name,location.href);if(u.origin!==location.origin||!enginePaths.has(u.pathname)||engineSeen.has(u.pathname))continue;engineSeen.add(u.pathname);engineCandidates.push(u);}catch{}}
const matchEngineSources=[];
let engineBytes=0;
const maxFileChars=2000000,maxTotalChars=6000000;
for(const u of engineCandidates){try{const res=await fetch(u.href,{credentials:'include',cache:'no-store'});const finalUrl=new URL(res.url||u.href,location.href);if(finalUrl.origin!==location.origin||finalUrl.pathname!==u.pathname){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Redirected outside allowlisted asset path'});continue;}if(!res.ok){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'HTTP '+res.status});continue;}const contentType=(res.headers.get('content-type')||'').toLowerCase();if(!(contentType.includes('javascript')||contentType.includes('ecmascript')||contentType.includes('text/plain'))){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Unexpected content type '+(contentType||'unknown')});continue;}const text=await res.text();if(text.length>maxFileChars){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Source exceeded '+maxFileChars+' characters'});continue;}if(engineBytes+text.length>maxTotalChars){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Bundle exceeded '+maxTotalChars+' characters'});continue;}engineBytes+=text.length;matchEngineSources.push({url:u.origin+u.pathname,source:text,error:null});}catch(err){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:err&&err.message?err.message:'Fetch failed'});}}
if(!payloads.length&&!diagnostics.length&&!matchEngineSources.length){window.removeEventListener('message',onMessage);alert('Top 100 Sync could not see any same-origin resource requests on this page.');return;}
for(let i=0;i<30&&!ready;i++){try{win.postMessage({type:helloType,version:1,session,sourceOrigin:location.origin},'https://tournaments.smtop100.blog');}catch{}await new Promise(r=>setTimeout(r,1000));}
if(!ready){window.removeEventListener('message',onMessage);alert('Top 100 Sync opened, but the newly loaded page did not become ready. Make sure you are signed in there and try again.');return;}
const packet={type:msgType,version:1,session,sourceOrigin:location.origin,capturedAt:new Date().toISOString(),payloads,diagnostics,matchEngineSources};
for(let i=0;i<30&&!done;i++){try{win.postMessage(packet,'https://tournaments.smtop100.blog');}catch{}await new Promise(r=>setTimeout(r,1000));}
window.removeEventListener('message',onMessage);
if(!done)alert('Top 100 Sync became ready, but did not acknowledge the data. Try again.');
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
