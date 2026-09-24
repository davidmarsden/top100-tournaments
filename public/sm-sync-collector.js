(async()=>{try{
const target='https://tournaments.smtop100.blog/admin/soccer-manager-sync',helloType='top100-sm-sync-hello',msgType='top100-sm-sync-payloads',readyType='top100-sm-sync-ready',ackType='top100-sm-sync-ack',enginePaths=new Set(['/js/projx/constants.js','/js/projx/jsutil.js','/js/projx/random.js','/js/projx/randomdata.js','/js/projx/attributes.js','/js/projx/formationdata.js','/js/projx/positions.js','/js/projx/matchreportcommentary.js','/js/pages/livematch.js','/js/pages/livematch2d.js','/js/common/multiplayer_videoplayer.js']);
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
let invocation=null;
try{invocation=new URL(document.currentScript&&document.currentScript.src?document.currentScript.src:'',location.href).searchParams.get('invocation');}catch{}
const bootstrap=window.__top100SmSyncBootstrap;
const ownsBootstrap=!!(invocation&&bootstrap&&bootstrap.session===invocation&&bootstrap.win&&!bootstrap.win.closed);
if(!ownsBootstrap)return;
const session=bootstrap.session;
const syncUrl=target+'?collectorSession='+encodeURIComponent(session);
const win=bootstrap.win;
if(window.__top100SmSyncBootstrap===bootstrap)delete window.__top100SmSyncBootstrap;
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
const maxReplayChars=2000000,maxReplayContextChars=250000;
let matchReplay=null,replayPageContext=null;
const safeReplayContextValue=value=>{
  if(value===null||value===undefined)return null;
  const text=String(value);
  if(text.length>500)return text.slice(0,500);
  return text;
};
const redactReplayContextText=value=>{
  if(value===null||value===undefined)return value;
  let text=String(value);
  const sensitiveName='[A-Za-z0-9_-]*(?:token|session|sessid|phpsessid|auth|secret|password|passwd|cookie|key)[A-Za-z0-9_-]*';
  const sensitiveExact=new RegExp('^'+sensitiveName+'$','i');
  const attr=/([A-Za-z_:][-A-Za-z0-9_:.]*)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))/g;
  const redactHtmlTag=tag=>{
    const attrs=[];
    let match;
    while((match=attr.exec(tag))!==null)attrs.push({name:match[1],value:match[2]??match[3]??match[4]??'',start:match.index,end:attr.lastIndex,raw:match[0]});
    attr.lastIndex=0;
    const nameAttr=attrs.find(item=>item.name.toLowerCase()==='name');
    if(!nameAttr||!sensitiveExact.test(nameAttr.value))return tag;
    const secretAttr=attrs.find(item=>/^(?:value|content)$/i.test(item.name));
    if(!secretAttr)return tag;
    const eq=secretAttr.raw.indexOf('=');
    if(eq<0)return tag;
    const prefix=secretAttr.raw.slice(0,eq+1);
    const rawValue=secretAttr.raw.slice(eq+1);
    const quote=rawValue[0]==='"'||rawValue[0]==="'"?rawValue[0]:'';
    const replacement=prefix+(quote?quote+'[redacted]'+quote:'[redacted]');
    return tag.slice(0,secretAttr.start)+replacement+tag.slice(secretAttr.end);
  };
  let rebuilt='',cursor=0;
  const opener=/<(?:input|meta)\\b/gi;
  let open;
  while((open=opener.exec(text))!==null){
    let quote=null,end=-1;
    for(let i=opener.lastIndex;i<text.length;i++){
      const ch=text[i];
      if(quote){if(ch===quote)quote=null;continue;}
      if(ch==='"'||ch==="'"){quote=ch;continue;}
      if(ch==='>'){end=i+1;break;}
    }
    if(end<0)break;
    rebuilt+=text.slice(cursor,open.index)+redactHtmlTag(text.slice(open.index,end));
    cursor=end;
    opener.lastIndex=end;
  }
  if(cursor)text=rebuilt+text.slice(cursor);
  const quotedAssignment=new RegExp("([\\\"']?"+sensitiveName+"[\\\"']?\\s*[:=]\\s*)([\\\"'])([\\s\\S]*?)\\2","gi");
  text=text.replace(quotedAssignment,'$1$2[redacted]$2');
  const quotedAttribute=new RegExp("((?:data-)?"+sensitiveName+"\\s*=\\s*)([\\\"'])([\\s\\S]*?)\\2","gi");
  text=text.replace(quotedAttribute,'$1$2[redacted]$2');
  text=text.replace(new RegExp("([?&]"+sensitiveName+"=)[^&#\\s\\\"'<>]*","gi"),'$1[redacted]');
  text=text.replace(new RegExp("((?:data-)?"+sensitiveName+"\\s*=\\s*)[^\\\"'\\s<>;&]*","gi"),'$1[redacted]');
  text=text.replace(new RegExp("([\\\"']?"+sensitiveName+"[\\\"']?\\s*[:=]\\s*)[^\\\"'\\s,;}<]*","gi"),'$1[redacted]');
  return text;
};
const captureReplayPageContext=()=>{
  const safePageUrl=sanitize(location.href);
  const params={};
  try{const page=new URL(location.href);for(const [key,value] of page.searchParams.entries()){if(sensitive.test(key))params[key]='[redacted]';else params[key]=safeReplayContextValue(value);}}catch{}
  const scripts=[];
  for(const script of Array.from(document.scripts||[])){
    if(script.src)continue;
    const source=script.textContent||'';
    const markerMatch=/liveMatchXML|fixture|match/i.exec(source);
    if(!markerMatch)continue;
    const marker=markerMatch.index;
    const start=Math.max(0,marker-5000),end=Math.min(source.length,marker+15000);
    const excerpt=redactReplayContextText(source.slice(start,end));
    scripts.push(excerpt);
    if(scripts.length>=8)break;
  }
  const identifiers={};
  const idPattern=/(fixture|fix|match|mid|game|club|sid|season|turn)/i;
  for(const el of Array.from(document.querySelectorAll('[data-fixture],[data-fixture-id],[data-match],[data-match-id],[data-fix],[data-id],input[type="hidden"]')).slice(0,300)){
    const pairs=[];
    if(el.id)pairs.push(['id',el.id]);
    if(el.name)pairs.push(['name',el.name]);
    for(const attr of Array.from(el.attributes||[]))if(attr.name.startsWith('data-'))pairs.push([attr.name,attr.value]);
    if(el.type==='hidden'&&el.value)pairs.push(['value',el.value]);
    const label=pairs.map(([k,v])=>k+'='+(sensitive.test(k)||sensitive.test(String(el.id||''))||sensitive.test(String(el.name||''))?'[redacted]':v)).join(' ');
    if(!idPattern.test(label))continue;
    const key=(el.id||el.name||pairs.find(([k])=>k.startsWith('data-'))?.[0]||'element')+':'+Object.keys(identifiers).length;
    identifiers[key]=safeReplayContextValue(redactReplayContextText(label));
    if(Object.keys(identifiers).length>=80)break;
  }
  let htmlAroundReplay=null;
  try{
    const html=document.documentElement?.outerHTML||'';
    const marker=html.indexOf('liveMatchXML');
    if(marker>=0)htmlAroundReplay=redactReplayContextText(html.slice(Math.max(0,marker-10000),Math.min(html.length,marker+30000)));
    if(htmlAroundReplay&&htmlAroundReplay.length>maxReplayContextChars)htmlAroundReplay=htmlAroundReplay.slice(0,maxReplayContextChars);
  }catch{}
  return {url:safePageUrl,title:document.title||null,params,identifiers,inlineScripts:scripts,htmlAroundReplay,error:null};
};
try{
  const replayXml=typeof window.liveMatchXML==='string'?window.liveMatchXML:null;
  if(replayXml){
    const safePageUrl=sanitize(location.href);
    if(replayXml.length>maxReplayChars){
      matchReplay={url:safePageUrl,xml:null,error:'Replay XML exceeded '+maxReplayChars+' characters'};
    }else{
      matchReplay={url:safePageUrl,xml:replayXml,error:null};
    }
  }
}catch(err){
  matchReplay={url:sanitize(location.href),xml:null,error:err&&err.message?err.message:'Replay capture failed'};
}
try{
  if(matchReplay)replayPageContext=captureReplayPageContext();
}catch(err){
  replayPageContext={url:sanitize(location.href),title:document.title||null,params:{},identifiers:{},inlineScripts:[],htmlAroundReplay:null,error:err&&err.message?err.message:'Replay page context capture failed'};
}
for(const u of engineCandidates){try{const res=await fetch(u.href,{credentials:'include',cache:'no-store'});const finalUrl=new URL(res.url||u.href,location.href);if(finalUrl.origin!==location.origin||finalUrl.pathname!==u.pathname){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Redirected outside allowlisted asset path'});continue;}if(!res.ok){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'HTTP '+res.status});continue;}const contentType=(res.headers.get('content-type')||'').toLowerCase();if(!(contentType.includes('javascript')||contentType.includes('ecmascript')||contentType.includes('text/plain'))){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Unexpected content type '+(contentType||'unknown')});continue;}const text=await res.text();if(text.length>maxFileChars){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Source exceeded '+maxFileChars+' characters'});continue;}if(engineBytes+text.length>maxTotalChars){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:'Bundle exceeded '+maxTotalChars+' characters'});continue;}engineBytes+=text.length;matchEngineSources.push({url:u.origin+u.pathname,source:text,error:null});}catch(err){matchEngineSources.push({url:u.origin+u.pathname,source:null,error:err&&err.message?err.message:'Fetch failed'});}}
if(!payloads.length&&!diagnostics.length&&!matchEngineSources.length&&!matchReplay){window.removeEventListener('message',onMessage);alert('Top 100 Sync could not see any same-origin resource requests or match replay data on this page.');return;}
for(let i=0;i<30&&!ready;i++){try{win.postMessage({type:helloType,version:1,session,sourceOrigin:location.origin},'https://tournaments.smtop100.blog');}catch{}await new Promise(r=>setTimeout(r,1000));}
if(!ready){window.removeEventListener('message',onMessage);alert('Top 100 Sync opened, but the newly loaded page did not become ready. Make sure you are signed in there and try again.');return;}
const packet={type:msgType,version:1,session,sourceOrigin:location.origin,capturedAt:new Date().toISOString(),payloads,diagnostics,matchEngineSources,matchReplay,replayPageContext};
for(let i=0;i<30&&!done;i++){try{win.postMessage(packet,'https://tournaments.smtop100.blog');}catch{}await new Promise(r=>setTimeout(r,1000));}
window.removeEventListener('message',onMessage);
if(!done)alert('Top 100 Sync became ready, but did not acknowledge the data. Try again.');
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();
