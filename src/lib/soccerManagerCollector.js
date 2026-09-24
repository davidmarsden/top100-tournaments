const SYNC_URL = 'https://tournaments.smtop100.blog/admin/soccer-manager-sync';
const HELLO_TYPE = 'top100-sm-sync-hello';
const MESSAGE_TYPE = 'top100-sm-sync-payloads';
const READY_TYPE = 'top100-sm-sync-ready';
const ACK_TYPE = 'top100-sm-sync-ack';

export const MATCH_ENGINE_DIAGNOSTIC_PATHS = Object.freeze([
  '/js/projx/constants.js',
  '/js/projx/jsutil.js',
  '/js/projx/random.js',
  '/js/projx/randomdata.js',
  '/js/projx/attributes.js',
  '/js/projx/formationdata.js',
  '/js/projx/positions.js',
  '/js/projx/matchreportcommentary.js',
  '/js/pages/livematch.js',
  '/js/pages/livematch2d.js',
]);

export function isAllowedSoccerManagerOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (url.hostname === 'soccermanager.com' || url.hostname.endsWith('.soccermanager.com'));
  } catch {
    return false;
  }
}

export function collectorBookmarklet() {
  const code = `(()=>{try{
if(location.protocol!=='https:'||!(location.hostname==='soccermanager.com'||location.hostname.endsWith('.soccermanager.com'))){alert('Open Soccer Manager first, then run Top 100 Sync.');return;}
const existing=document.getElementById('top100-sm-sync-collector-script');
if(existing)existing.remove();
const script=document.createElement('script');
script.id='top100-sm-sync-collector-script';
script.src='https://tournaments.smtop100.blog/sm-sync-collector.js?v='+Date.now();
script.async=true;
script.onerror=()=>alert('Top 100 Sync could not load its collector script. Soccer Manager may be blocking external scripts.');
(document.head||document.documentElement).appendChild(script);
}catch(err){alert('Top 100 Sync failed: '+(err&&err.message?err.message:String(err)));}})();`;
  return 'javascript:' + encodeURIComponent(code);
}

export const soccerManagerCollectorProtocol = {
  syncUrl: SYNC_URL,
  helloType: HELLO_TYPE,
  messageType: MESSAGE_TYPE,
  readyType: READY_TYPE,
  ackType: ACK_TYPE,
};
