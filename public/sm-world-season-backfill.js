(()=>{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first.');return;}
if(window.__top100WorldBackfillRunning){alert('Game-world backfill is already running.');return;}
const MAX_REPORT_BYTES=2000000,MAX_ATTEMPTS=3,DELAY_MS=220,MAX_REPORTS=1600,CHUNK_SIZE=100;
const text=v=>v===null||v===undefined?null:(String(v).trim()||null);
const nonZeroId=v=>{const id=text(v);return id&&id!=='0'&&/^\d+$/.test(id)?id:null;};
const fixtureId=row=>nonZeroId(row?.FixtureId??row?.fixtureID??row?.fixtureId);
const completed=row=>String(row?.Played??row?.played??'')==='1'&&String(row?.Bye??row?.bye??'0')!=='1'&&fixtureId(row);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const parseJson=async response=>{const length=Number(response.headers.get('content-length')||0);if(length>MAX_REPORT_BYTES)throw new Error('Report exceeds '+MAX_REPORT_BYTES+' bytes');let raw='';if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_REPORT_BYTES){await reader.cancel();throw new Error('Report exceeds '+MAX_REPORT_BYTES+' bytes');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}else{const buffer=await response.arrayBuffer();if(buffer.byteLength>MAX_REPORT_BYTES)throw new Error('Report exceeds '+MAX_REPORT_BYTES+' bytes');raw=new TextDecoder().decode(buffer);}try{return JSON.parse(raw);}catch{throw new Error('Soccer Manager returned non-JSON for '+response.url);}};
const fetchReport=async id=>{const u=new URL('/matchreport-ajax-mobile.php',location.origin);u.searchParams.set('fixtureid',id);u.searchParams.set('action','mr');let lastError;for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){try{const response=await fetch(u.href,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status+' '+response.statusText);return await parseJson(response);}catch(err){lastError=err;if(attempt<MAX_ATTEMPTS)await sleep(500*Math.pow(2,attempt-1));}}throw lastError;};
const reportWrapper=raw=>({fixtureId:text(raw?.fixtureID??raw?.FixtureId),date:text(raw?.TurnDate??raw?.FullTurnDate),competition:text(raw?.TournName??raw?.TournamentName),home:{clubId:text(raw?.HomeClubID),name:text(raw?.HomeTeamName),score:Number.isFinite(Number(raw?.HomeTeamScore))?Number(raw.HomeTeamScore):null},away:{clubId:text(raw?.AwayClubID),name:text(raw?.AwayTeamName),score:Number.isFinite(Number(raw?.AwayTeamScore))?Number(raw.AwayTeamScore):null},raw});
const findFixtures=value=>{const out=[];const seen=new Set();const walk=(v,depth)=>{if(depth>9||v===null||v===undefined)return;if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(typeof v!=='object')return;const id=fixtureId(v);if(id&&completed(v)&&!seen.has(id)){seen.add(id);out.push(id);}for(const x of Object.values(v))walk(x,depth+1);};walk(value,0);return out;};
const download=(data,index)=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='top100-world-season-backfill-'+String(index).padStart(2,'0')+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);};
const saveBundle=(chunks,manifest)=>{const bundle={kind:'worldSeasonMatchBackfill',version:1,runId:manifest.runId,capturedAt:manifest.capturedAt,setupId:manifest.setupId,discovery:manifest.summary,clubs:manifest.clubs,reports:chunks.flat(),failures:manifest.failures};download(bundle,1);};
(async()=>{window.__top100WorldBackfillRunning=true;try{
 if(typeof window.API_getClubSchedule!=='function')throw new Error('Soccer Manager schedule API is not loaded. Open a Top 100 club → Schedule, let it load, then try again.');
 const schedule=window.API_getClubSchedule();if(!Array.isArray(schedule)||!schedule.length)throw new Error('No loaded club schedule was found.');
 const seedIds=[...new Set(schedule.filter(completed).map(fixtureId))];if(!seedIds.length)throw new Error('The loaded schedule contains no completed fixtures.');
 const queue=[...seedIds],queued=new Set(queue),fetched=new Set(),failures=[],chunks=[];let current=[],setupId=nonZeroId(new URL(location.href).searchParams.get('sid'))||nonZeroId(window.g_setupid??window.g_setupId??window.g_gameworldid),clubs=new Map();
 const runId=new Date().toISOString().replace(/[:.]/g,'-');
 const flush=()=>{if(!current.length)return;chunks.push(current);current=[];};
 while(queue.length&&fetched.size<MAX_REPORTS){
   const id=queue.shift();if(fetched.has(id))continue;
   try{
     const raw=await fetchReport(id);const reportSetup=nonZeroId(raw?.SetupID??raw?.setupId??raw?.GameWorldID??raw?.gameWorldId);
     if(setupId&&reportSetup&&reportSetup!==setupId)throw new Error('Fixture belongs to another game world');
     setupId=setupId||reportSetup;
     const wrapped=reportWrapper(raw);if(!wrapped.fixtureId)wrapped.fixtureId=id;
     for(const side of [wrapped.home,wrapped.away])if(side.clubId)clubs.set(side.clubId,side.name||side.clubId);
     current.push(wrapped);fetched.add(id);
     for(const discovered of findFixtures(raw)){if(!queued.has(discovered)&&!fetched.has(discovered)){queued.add(discovered);queue.push(discovered);}}
     if(current.length>=CHUNK_SIZE)flush();
   }catch(err){fetched.add(id);failures.push({fixtureId:id,error:String(err&&err.message||err)});}
   if(queue.length)await sleep(DELAY_MS);
 }
 flush();
 if(!setupId)throw new Error('Could not establish the Soccer Manager setup id.');
 const manifest={kind:'worldSeasonMatchBackfillManifest',version:1,runId,capturedAt:new Date().toISOString(),setupId,summary:{source:'schedule seed + completed-fixture graph',seedFixtures:seedIds.length,uniqueFixturesSeen:queued.size,reportsAttempted:fetched.size,reportsCaptured:fetched.size-failures.length,failures:failures.length,clubsSeen:clubs.size,queueRemaining:queue.length,safetyCap:MAX_REPORTS,chunks:chunks.length},clubs:[...clubs].map(([clubId,name])=>({clubId,name})),failures};
 const ok=confirm('Game-world crawl complete: '+manifest.summary.reportsCaptured+' reports across '+clubs.size+' clubs.'+(queue.length?' Safety cap reached with '+queue.length+' fixture(s) still queued.':'')+'\n\nTap OK to download one import bundle. This explicit tap avoids browsers blocking automatic multi-downloads.');
 if(ok)saveBundle(chunks,manifest);
 else window.__top100WorldBackfillResult={chunks,manifest};
 alert(ok?'Backfill bundle downloaded. Import it in Soccer Manager Sync.':'Download cancelled. The captured result remains in this page as window.__top100WorldBackfillResult until you navigate away.');
}catch(err){alert('Game-world backfill failed: '+String(err&&err.message||err));}finally{delete window.__top100WorldBackfillRunning;}})();
})();