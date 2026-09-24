(()=>{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first.');return;}
const key=/^(?:fixture(?:-?id)?|fix(?:id)?|match(?:-?id)?|mid|game(?:-?id)?|club(?:-?id)?|clubid|sid|season|turn|action)$/i;
const sensitive=/(?:token|session|sessid|phpsessid|auth|secret|password|passwd|cookie|key)/i;
const max=200,startedAt=new Date().toISOString(),events=[];
const projectUrl=(raw)=>{try{const u=new URL(raw,location.href);if(u.origin!==location.origin)return null;const p=new URL(u.origin+u.pathname);for(const [k,v] of u.searchParams.entries())if(key.test(k)&&!sensitive.test(k)&&!sensitive.test(v))p.searchParams.append(k,String(v).slice(0,500));return p.href;}catch{return null;}};
const bodyFields=(body)=>{const out=[];try{let entries=null;if(body instanceof URLSearchParams)entries=body.entries();else if(body instanceof FormData)entries=body.entries();else if(typeof body==='string'&&body.length<=10000)entries=new URLSearchParams(body).entries();if(entries)for(const [k,v] of entries)if(typeof v==='string'&&key.test(k)&&!sensitive.test(k)&&!sensitive.test(v))out.push([k,v.slice(0,500)]);}catch{}return out.slice(0,40);};
const add=(row)=>{if(events.length<max)events.push({...row,at:Math.round(performance.now())});};
const originalFetch=window.fetch;
const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send;
window.fetch=async function(input,init){const raw=typeof input==='string'?input:input&&input.url;const url=projectUrl(raw);const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();const fields=bodyFields(init&&init.body);const start=performance.now();try{const response=await originalFetch.apply(this,arguments);if(url)add({transport:'fetch',method,url,fields,status:response.status,contentType:(response.headers.get('content-type')||'').slice(0,120),duration:Math.round(performance.now()-start)});return response;}catch(err){if(url)add({transport:'fetch',method,url,fields,error:String(err&&err.message||err).slice(0,160),duration:Math.round(performance.now()-start)});throw err;}};
XMLHttpRequest.prototype.open=function(method,url){this.__top100Trace={method:String(method||'GET').toUpperCase(),url:projectUrl(url),start:0};return originalOpen.apply(this,arguments);};
XMLHttpRequest.prototype.send=function(body){const meta=this.__top100Trace;if(meta){meta.fields=bodyFields(body);meta.start=performance.now();this.addEventListener('loadend',()=>{if(meta.url)add({transport:'xhr',method:meta.method,url:meta.url,fields:meta.fields,status:this.status,contentType:String(this.getResponseHeader('content-type')||'').slice(0,120),duration:Math.round(performance.now()-meta.start)});},{once:true});}return originalSend.apply(this,arguments);};
const stop=()=>{
window.fetch=originalFetch;XMLHttpRequest.prototype.open=originalOpen;XMLHttpRequest.prototype.send=originalSend;
const data={capturedAt:new Date().toISOString(),startedAt,pageUrl:projectUrl(location.href),events};
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='top100-sm-replay-network-trace-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);delete window.__top100ReplayTraceStop;
};
window.__top100ReplayTraceStop=stop;
alert('Replay network trace armed. Open a completed match, then run the Top 100 bookmarklet again and choose/trigger the trace download.');
})();