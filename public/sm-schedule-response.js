(()=>{try{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first.');return;}
if(window.__top100ScheduleTraceRunning){alert('Schedule response capture is already running.');return;}
const text=v=>v===null||v===undefined?null:(String(v).trim()||null);
const safeUrl=raw=>{try{const u=new URL(raw,location.href);return u.origin===location.origin?u:null;}catch{return null;}};
const page=new URL(location.href);
const nonZeroId=v=>{const id=text(v);return id&&id!=='0'?id:null;};
const clubId=nonZeroId(page.searchParams.get('clubid'));
const setupId=nonZeroId(page.searchParams.get('sid'));
const observed=[...performance.getEntriesByType('resource')].reverse().map(e=>safeUrl(e.name)).find(u=>u&&u.pathname.endsWith('/club-ajax-mobile.php')&&u.searchParams.get('action')==='scheduledraw');
const scheduleUrl=observed?new URL(observed.href):new URL('/club-ajax-mobile.php',location.origin);
if(!observed){
 if(!clubId||!setupId){alert('Open a club Schedule page first, let it load, then run Top 100 Sync → Capture schedule response.');return;}
 scheduleUrl.searchParams.set('action','scheduledraw');scheduleUrl.searchParams.set('getdata','0');scheduleUrl.searchParams.set('gettemplate','1');scheduleUrl.searchParams.set('clubid',clubId);scheduleUrl.searchParams.set('sid',setupId);
}
window.__top100ScheduleTraceRunning=true;
(async()=>{try{
 const response=await fetch(scheduleUrl.href,{credentials:'include',cache:'no-store'});
 if(!response.ok)throw new Error('HTTP '+response.status);
 const contentType=(response.headers.get('content-type')||'').toLowerCase();
 const body=await response.text();
 if(body.length>2000000)throw new Error('Schedule response exceeded 2,000,000 characters.');
 let parsed=null,parseError=null;
 try{parsed=JSON.parse(body);}catch(err){parseError=err&&err.message?err.message:'Not JSON';}
 const data={kind:'soccerManagerScheduleResponse',version:1,capturedAt:new Date().toISOString(),sourcePage:location.origin+location.pathname,setupId,clubId,request:{path:scheduleUrl.pathname,action:scheduleUrl.searchParams.get('action'),getdata:scheduleUrl.searchParams.get('getdata'),gettemplate:scheduleUrl.searchParams.get('gettemplate')},response:{contentType,parseError,data:parsed,text:parsed===null?body:null}};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='top100-sm-schedule-response-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 alert('Schedule response captured'+(parsed===null?' as text':' as JSON')+'. Diagnostic downloaded.');
}catch(err){alert('Schedule response capture failed: '+(err&&err.message?err.message:String(err)));}finally{delete window.__top100ScheduleTraceRunning;}})();
}catch(err){alert('Schedule response capture failed: '+(err&&err.message?err.message:String(err)));}})();
