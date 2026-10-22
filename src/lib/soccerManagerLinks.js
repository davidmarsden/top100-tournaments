// Links into soccermanager.com. Soccer Manager has no app, API or deep-link
// scheme, so these are ordinary web URLs observed in the SM web app:
//
// - select-gameworld.php?action=setup&setup=<setupId>   switch to / enter a game world
// - multiplayer.php?action=setclub&clubid=<clubId>&sid=<setupId>   your own club in that world
// - multiplayer.php?action=oppclub&clubdataid=<clubDataId>   any club; SM shows it in the
//   game world your SM session is currently in
//
// setupId is game_worlds.external_world_id, clubId the world-specific SM club id
// and clubDataId SM's club catalogue id (captured in standings by Top 100 Sync).
const SM_ORIGIN = 'https://www.soccermanager.com';

function positiveId(value) {
  const text = String(value ?? '').trim();
  return /^[1-9]\d{0,11}$/.test(text) ? text : null;
}

export function smWorldUrl(setupId) {
  const id = positiveId(setupId);
  return id ? `${SM_ORIGIN}/select-gameworld.php?action=setup&setup=${id}` : null;
}

export function smMyClubUrl(setupId, clubId) {
  const world = positiveId(setupId);
  const club = positiveId(clubId);
  return world && club ? `${SM_ORIGIN}/multiplayer.php?action=setclub&clubid=${club}&sid=${world}` : null;
}

export function smClubUrl(clubDataId) {
  const id = positiveId(clubDataId);
  return id ? `${SM_ORIGIN}/multiplayer.php?action=oppclub&clubdataid=${id}` : null;
}
