(()=>{try{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first.');return;}
const MAX_SOURCE=500000,MAX_SCRIPTS=80;
const text=v=>v===null||v===undefined?null:(String(v).trim()||null);
const secret=/(?:token|session|sessid|phpsessid|auth|secret|password|passwd|cookie|key)/i;
const sanitizedUrl=raw=>{try{const u=new URL(raw,location.href);if(u.origin!==location.origin)return null;for(const key of [...u.searchParams.keys()])if(secret.test(key))u.searchParams.set(key,'[REDACTED]');return u;}catch{return null;}};
const page=new URL(location.href),nonZero=v=>{const x=text(v);return x&&x!=='0'?x:null;};
const functionNames=['MENU_clubScheduleDraw','MENU_clubSchedule','clubScheduleDraw'];
const functions={};
for(const name of functionNames){try{const fn=window[name];if(typeof fn==='function'){const source=Function.prototype.toString.call(fn);functions[name]={source:source.length<=MAX_SOURCE?source:source.slice(0,MAX_SOURCE),truncated:source.length>MAX_SOURCE};}}catch(err){functions[name]={error:String(err&&err.message||err)};}}
const scripts=[...document.scripts].map(s=>s.src).filter(Boolean).map(raw=>sanitizedUrl(raw)?.href||null).filter(Boolean).slice(-MAX_SCRIPTS);
const resources=performance.getEntriesByType('resource').map(e=>{const u=sanitizedUrl(e.name);return u?{url:u.pathname+u.search,initiatorType:e.initiatorType}:null;}).filter(Boolean).filter(x=>/(schedule|club|multi|fixture|result)/i.test(x.url)).slice(-160);
const inline=[...document.scripts].filter(s=>!s.src&&/(MENU_clubScheduleDraw|scheduledraw)/.test(s.textContent||'')).slice(0,20).map(s=>{const v=s.textContent||'';return {source:v.slice(0,MAX_SOURCE),truncated:v.length>MAX_SOURCE};});
const data={kind:'soccerManagerScheduleRuntime',version:1,capturedAt:new Date().toISOString(),sourcePage:location.origin+location.pathname,setupId:nonZero(page.searchParams.get('sid')),clubId:nonZero(page.searchParams.get('clubid')),functions,scripts,inlineScripts:inline,relevantResources:resources};
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='top100-sm-schedule-runtime-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
alert('Schedule runtime diagnostic downloaded. Found '+Object.keys(functions).length+' schedule function'+(Object.keys(functions).length===1?'':'s')+' and '+scripts.length+' same-origin scripts.');
}catch(err){alert('Schedule runtime inspection failed: '+(err&&err.message?err.message:String(err)));}})();
