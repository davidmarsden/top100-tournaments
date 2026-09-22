const SYNC_URL = 'https://tournaments.smtop100.blog/admin/soccer-manager-sync';
const MESSAGE_TYPE = 'top100-sm-sync-payloads';
const ACK_TYPE = 'top100-sm-sync-ack';

export function isAllowedSoccerManagerOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (url.hostname === 'soccermanager.com' || url.hostname.endsWith('.soccermanager.com'));
  } catch {
    return false;
  }
}

export function collectorBookmarklet() {
  const code = `(async()=>{try{
const target='${SYNC_URL}',msgType='${MESSAGE_TYPE}',ackType='${ACK_TYPE}';
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const patterns=[/competition-ajax\\.php/i,/club-ajax-mobile\\.php/i,/playerchanges[^/]*\\.php/i,/transfer[^/]*market[^/]*\\.php/i];
const urls=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(u=>patterns.some(r=>r.test(u))))];
if(!urls.length){alert('No supported Soccer Manager data requests found on this page yet. Open a league table, club, player changes or transfer market screen, then try again.');return;}
const payloads=[];
for(const url of urls){try{const res=await fetch(url,{credentials:'include',cache:'no-store'});if(!res.ok)continue;const type=(res.headers.get('content-type')||'').toLowerCase();if(!type.includes('json')){const text=await res.text();try{payloads.push({url,data:JSON.parse(text)});}catch{}continue;}payloads.push({url,data:await res.json()});}catch{}}
if(!payloads.length){alert('Top 100 Sync found the requests but could not read any JSON responses.');return;}
const win=window.open(target,'top100-sm-sync');
if(!win){alert('Please allow pop-ups for Soccer Manager, then try Top 100 Sync again.');return;}
let done=false;
const onMessage=e=>{if(e.origin==='https://tournaments.smtop100.blog'&&e.data&&e.data.type===ackType){done=true;window.removeEventListener('message',onMessage);}};
window.addEventListener('message',onMessage);
const packet={type:msgType,version:1,sourceOrigin:location.origin,capturedAt:new Date().toISOString(),payloads};
for(let i=0;i<30&&!done;i++){try{win.postMessage(packet,'https://tournaments.smtop100.blog');}catch{}await new Promise(r=>setTimeout(r,1000));}
if(!done)alert('Top 100 Sync opened, but did not acknowledge the data. Make sure you are signed in there and try again.');
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();`;
  return 'javascript:' + encodeURIComponent(code);
}

export const soccerManagerCollectorProtocol = {
  syncUrl: SYNC_URL,
  messageType: MESSAGE_TYPE,
  ackType: ACK_TYPE,
};
