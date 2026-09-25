(()=>{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first.');return;}
if(window.__top100HamburgBackfillRunning){alert('Hamburger SV season backfill is already running.');return;}
const TARGET_CLUB_ID='48506708',TARGET_NAME='Hamburger SV',MAX_FIXTURES=80,DELAY_MS=180,MAX_DISCOVERY_REPORTS=80;
const safeUrl=(raw)=>{try{const u=new URL(raw,location.href);return u.origin===location.origin?u:null;}catch{return null;}};
const number=(v)=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const text=(v)=>v===null||v===undefined?null:(String(v).trim()||null);
const played=(row)=>String(row?.Played??row?.played??'')==='1'||number(row?.HomeScore??row?.homeScore)!==null&&number(row?.AwayScore??row?.awayScore)!==null&&Boolean(row?.FixtureUnixTime??row?.fixtureUnixTime);
const fixtureId=(row)=>text(row?.FixtureId??row?.fixtureID??row?.fixtureId);
const clubIds=(row)=>[text(row?.HomeTeamId??row?.HomeClubID??row?.homeClubId),text(row?.AwayTeamId??row?.AwayClubID??row?.awayClubId)];
const looksFixture=(row)=>row&&typeof row==='object'&&fixtureId(row)&&clubIds(row).some(Boolean);
const collectFixtures=(value,out,seen=new WeakSet())=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);if(Array.isArray(value)){for(const item of value)collectFixtures(item,out,seen);return;}if(looksFixture(value)){const id=fixtureId(value);if(id&&!out.has(id))out.set(id,value);}for(const child of Object.values(value))collectFixtures(child,out,seen);};
const parseJson=async(response)=>{const raw=await response.text();try{return JSON.parse(raw);}catch{throw new Error('Soccer Manager returned non-JSON for '+response.url);}};
const normalizeReport=(raw)=>{const side=text(raw?.HomeClubID)===TARGET_CLUB_ID?'home':text(raw?.AwayClubID)===TARGET_CLUB_ID?'away':null;const opponent=side==='home'?text(raw?.AwayTeamName):side==='away'?text(raw?.HomeTeamName):null;const cap=side==='home'?'Home':side==='away'?'Away':null;const stats=cap?{possession:number(raw[cap+'Poss']),shots:number(raw[cap+'ShotsOnGoal']),shotsOnTarget:number(raw[cap+'ShotsOnTarget']),corners:number(raw[cap+'Corners'])}:null;return {fixtureId:text(raw?.fixtureID??raw?.FixtureId),date:text(raw?.TurnDate??raw?.FullTurnDate),competition:text(raw?.TournName??raw?.TournamentName),home:{clubId:text(raw?.HomeClubID),name:text(raw?.HomeTeamName),score:number(raw?.HomeTeamScore??raw?.HomeScore)},away:{clubId:text(raw?.AwayClubID),name:text(raw?.AwayTeamName),score:number(raw?.AwayTeamScore??raw?.AwayScore)},hamburg:{side,opponent,stats},schema:{topLevelFields:Object.keys(raw||{}).sort(),fieldCount:Object.keys(raw||{}).length},raw};};
const download=(data)=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='top100-hamburg-season-match-backfill-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const replayFixtureFromResources=()=>{const entries=performance.getEntriesByType('resource');for(let i=entries.length-1;i>=0;i--){const u=safeUrl(entries[i]?.name);if(u&&u.pathname.endsWith('/matchreport-ajax-mobile.php')&&u.searchParams.get('action')==='mr'){const id=text(u.searchParams.get('fixtureid'));if(id)return id;}}return null;};
const replayFixtureFromDom=()=>{const selectors=['[aria-current="true"]','[aria-selected="true"]','.active','.selected','.current','#match-report','#matchreport','.match-report','.matchreport'];const roots=[];for(const selector of selectors)for(const node of document.querySelectorAll(selector))if(!roots.includes(node))roots.push(node);for(const root of roots){const nodes=[root,...root.querySelectorAll('input[type="hidden"],[data-fixtureid],[data-fixture-id],[data-matchid],[data-match-id]')];for(const node of nodes){const values=[node.dataset?.fixtureid,node.dataset?.fixtureId,node.dataset?.matchid,node.dataset?.matchId,/^(?:fixtureid|fixid|matchid)$/i.test(node.name||'')?node.value:null];for(const value of values){const id=text(value);if(id&&/^\d+$/.test(id))return id;}}}return null;};
(async()=>{
window.__top100HamburgBackfillRunning=true;
try{
const seedUrl=new URL('/matchreport-ajax-mobile.php',location.origin);const page=new URL(location.href);const pageFixture=text(page.searchParams.get('fixtureid')||page.searchParams.get('fixid')||page.searchParams.get('matchid'))||replayFixtureFromResources()||replayFixtureFromDom();
if(!pageFixture){alert('Could not identify the displayed match. Open a completed Hamburger SV match and use View Match or Play 2D Match once, then run Top 100 Sync → Backfill Hamburg season.');return;}
seedUrl.searchParams.set('fixtureid',pageFixture);seedUrl.searchParams.set('action','mr');
const seed=await parseJson(await fetch(seedUrl.href,{credentials:'include'}));
if(text(seed?.HomeClubID)!==TARGET_CLUB_ID&&text(seed?.AwayClubID)!==TARGET_CLUB_ID&&text(seed?.HomeTeamName)!==TARGET_NAME&&text(seed?.AwayTeamName)!==TARGET_NAME){throw new Error('The open completed match does not involve Hamburger SV.');}
const discovered=new Map();collectFixtures(seed,discovered);
const reports=[],failures=[],fetched=new Set();
const fetchReport=async(id)=>{const u=new URL('/matchreport-ajax-mobile.php',location.origin);u.searchParams.set('fixtureid',id);u.searchParams.set('action','mr');const response=await fetch(u.href,{credentials:'include'});if(!response.ok)throw new Error('HTTP '+response.status);return parseJson(response);};
const addReport=(raw)=>{const id=fixtureId(raw);if(!id||fetched.has(id))return;fetched.add(id);reports.push(normalizeReport(raw));collectFixtures(raw,discovered);};
addReport(seed);
const queue=()=>{const pending=[...discovered.values()].filter(row=>played(row)&&!fetched.has(fixtureId(row)));const target=[],bridge=[];for(const row of pending)(clubIds(row).includes(TARGET_CLUB_ID)?target:bridge).push(row);return [...target,...bridge].slice(0,MAX_DISCOVERY_REPORTS);};
let discoveryFetches=0;
while(discoveryFetches<MAX_DISCOVERY_REPORTS&&reports.length<MAX_FIXTURES){
 const next=queue()[0];if(!next)break;
 const id=fixtureId(next);discoveryFetches++;
 try{const raw=await fetchReport(id);addReport(raw);}catch(err){fetched.add(id);failures.push({fixtureId:id,error:String(err&&err.message||err)});}
 if(discoveryFetches<MAX_DISCOVERY_REPORTS)await sleep(DELAY_MS);
}
const hamburgReports=reports.filter(report=>report.home.clubId===TARGET_CLUB_ID||report.away.clubId===TARGET_CLUB_ID);
const nonHamburgReports=reports.length-hamburgReports.length;
reports.length=0;reports.push(...hamburgReports);
const byCompetition={};for(const report of reports){const key=report.competition||'Unknown';byCompetition[key]=(byCompetition[key]||0)+1;}
const data={kind:'hamburgSeasonMatchBackfill',version:1,capturedAt:new Date().toISOString(),sourcePage:location.origin+location.pathname,targetClub:{clubId:TARGET_CLUB_ID,name:TARGET_NAME},summary:{fixturesDiscovered:[...discovered.values()].filter(row=>clubIds(row).includes(TARGET_CLUB_ID)&&played(row)).length,reportsFetched:reports.length,discoveryReportsFetched:fetched.size,nonHamburgDiscoveryReports:nonHamburgReports,failures:failures.length,byCompetition},reports,failures};
download(data);alert('Hamburg backfill complete: '+reports.length+' Hamburg reports fetched'+(failures.length?' ('+failures.length+' failed)':'')+'. JSON downloaded for review.');
}catch(err){alert('Hamburg season backfill failed: '+String(err&&err.message||err));}finally{delete window.__top100HamburgBackfillRunning;}
})();
})();