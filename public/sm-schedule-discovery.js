(()=>{try{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first.');return;}
const MAX_RESOURCES=120,MAX_ROWS=200,MAX_CANDIDATES=200;
const text=v=>v===null||v===undefined?null:(String(v).trim()||null);
const number=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const safeUrl=raw=>{try{const u=new URL(raw,location.href);return u.origin===location.origin?u:null;}catch{return null;}};
const sensitive=/(?:token|session|sessid|phpsessid|auth|secret|password|passwd|cookie|key)/i;
const sanitize=raw=>{const u=safeUrl(raw);if(!u)return null;for(const key of [...u.searchParams.keys()])if(sensitive.test(key))u.searchParams.set(key,'[redacted]');u.hash='';return u.href;};
const fixtureIdFromUrl=raw=>{const u=safeUrl(raw);if(!u)return null;for(const key of ['fixtureid','fixtureId','FixtureId','fixid','matchid']){const id=text(u.searchParams.get(key));if(id&&/^\d+$/.test(id))return id;}return null;};
const idsFromElement=el=>{
 const out=[];
 const attrs=['data-fixtureid','data-fixture-id','data-fixture','data-fixid','data-matchid','data-match-id','data-match'];
 for(const name of attrs){const id=text(el.getAttribute&&el.getAttribute(name));if(id&&/^\d+$/.test(id))out.push(id);}
 if(el.id&&/^(?:fixture|fix|match)[-_]?\d+$/i.test(el.id)){const m=el.id.match(/\d+/);if(m)out.push(m[0]);}
 for(const node of el.querySelectorAll?el.querySelectorAll('a[href*="fixture"],a[href*="match"],form[action*="fixture"],form[action*="match"],input[type="hidden"]'):[]){
   const raw=node.tagName==='FORM'?node.getAttribute('action'):node.getAttribute('href');
   const fromUrl=raw&&fixtureIdFromUrl(raw);if(fromUrl)out.push(fromUrl);
   if(node.tagName==='INPUT'&&/^(?:fixtureid|fixid|matchid)$/i.test(node.name||'')){const id=text(node.value);if(id&&/^\d+$/.test(id))out.push(id);}
 }
 return [...new Set(out)];
};
const rows=[];
for(const el of [...document.querySelectorAll('tr,li,.fixture,.fixture-row,.schedule-row,.match-row,[data-fixtureid],[data-fixture-id]')].slice(0,600)){
 const ids=idsFromElement(el);if(!ids.length)continue;
 const rowText=text(el.innerText||el.textContent);if(!rowText)continue;
 rows.push({fixtureIds:ids,text:rowText.slice(0,500)});
 if(rows.length>=MAX_ROWS)break;
}
const resources=performance.getEntriesByType('resource').slice(-MAX_RESOURCES).map(e=>({url:sanitize(e.name),initiatorType:e.initiatorType||null,startTime:Math.round(e.startTime)})).filter(x=>x.url);
const candidates=[];
const seen=new Set();
const add=(id,source)=>{if(!id||seen.has(id)||candidates.length>=MAX_CANDIDATES)return;seen.add(id);candidates.push({fixtureId:id,source});};
for(const row of rows)for(const id of row.fixtureIds)add(id,'dom');
for(const resource of resources){const id=fixtureIdFromUrl(resource.url);if(id)add(id,'resource');}
for(const el of [...document.querySelectorAll('a[href],form')].slice(0,600)){const raw=el.tagName==='FORM'?el.getAttribute('action'):el.getAttribute('href');const id=raw&&fixtureIdFromUrl(raw);if(id)add(id,'navigation');}
const page=new URL(location.href);
const setupId=(()=>{const id=text(page.searchParams.get('sid'));return id&&id!=='0'?id:null;})();
const clubId=(()=>{const id=text(page.searchParams.get('clubid'));return id&&id!=='0'?id:null;})();
const data={kind:'soccerManagerScheduleDiscovery',version:1,capturedAt:new Date().toISOString(),sourcePage:location.origin+location.pathname,setupId,clubId,summary:{fixtureCandidates:candidates.length,domRows:rows.length,resources:resources.length},fixtureCandidates:candidates,rows,resources};
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='top100-sm-schedule-discovery-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
alert('Schedule discovery complete: '+candidates.length+' fixture IDs found from '+rows.length+' schedule rows. Diagnostic JSON downloaded.');
}catch(err){alert('Schedule discovery failed: '+(err&&err.message?err.message:String(err)));}})();
