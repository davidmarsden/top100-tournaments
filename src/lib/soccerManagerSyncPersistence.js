import { supabase } from './supabaseClient';

const SENSITIVE_QUERY_KEY = /(?:token|session|sessid|phpsessid|auth|secret|password|passwd|cookie|key)/i;

export function sanitizeSoccerManagerSourceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(url.hostname === 'soccermanager.com' || url.hostname.endsWith('.soccermanager.com'))) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[redacted]');
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseSourceContext(sourceUrl) {
  const safeUrl = sanitizeSoccerManagerSourceUrl(sourceUrl);
  if (!safeUrl) return {};
  try {
    const url = new URL(safeUrl);
    return {
      sourceUrl: safeUrl,
      setupId: url.searchParams.get('sid') || null,
      clubId: url.searchParams.get('clubid') || null,
      action: url.searchParams.get('action') || null,
    };
  } catch {
    return {};
  }
}

function entity(entityType, entityKey, scopeKey, data) {
  if (!entityType || !entityKey || !data) return null;
  return {
    entityType: String(entityType),
    entityKey: String(entityKey),
    scopeKey: scopeKey ? String(scopeKey) : null,
    data,
  };
}

function compact(values) {
  return values.filter(Boolean);
}

function competitionEntities(entry) {
  const payload = entry.payload;
  const setupId = payload?.world?.setupId;
  if (!setupId) return [];

  const rows = [
    entity('world', setupId, setupId, payload.world),
  ];

  for (const division of payload.divisions || []) {
    const leagueKey = division.leagueId || division.division;
    if (!leagueKey) continue;
    const scope = `${setupId}:league:${leagueKey}`;
    const { standings = [], ...divisionData } = division;
    rows.push(entity('division', `${setupId}:${leagueKey}`, setupId, {
      setupId,
      ...divisionData,
    }));
    for (const standing of standings) {
      if (!standing?.clubId) continue;
      rows.push(entity('standing', `${setupId}:${leagueKey}:${standing.clubId}`, scope, {
        setupId,
        leagueId: division.leagueId || null,
        division: division.division || null,
        ...standing,
      }));
    }
  }

  for (const manager of payload.managers || []) {
    if (!manager?.clubId) continue;
    rows.push(entity('manager_assignment', `${setupId}:${manager.clubId}`, setupId, {
      setupId,
      ...manager,
    }));
  }

  for (const fixture of [...(payload.results || []), ...(payload.fixtures || [])]) {
    if (!fixture?.sourceId) continue;
    rows.push(entity('fixture', `${setupId}:${fixture.sourceId}`, setupId, {
      setupId,
      ...fixture,
    }));
  }

  for (const season of payload.history || []) {
    const seasonKey = season?.seasonId || season?.season;
    if (seasonKey === null || seasonKey === undefined) continue;
    rows.push(entity('season_history', `${setupId}:${seasonKey}`, setupId, {
      setupId,
      ...season,
    }));
  }

  for (const player of payload.playerLeaders || []) {
    if (!player?.playerId) continue;
    rows.push(entity('player_leader', `${setupId}:${player.playerId}`, setupId, {
      setupId,
      ...player,
    }));
  }

  return compact(rows);
}

function squadEntities(entry) {
  const payload = entry.payload;
  const context = parseSourceContext(entry.sourceUrl);
  const setupId = payload?.club?.setupId || context.setupId;
  const clubId = payload?.club?.clubId || context.clubId;
  if (!setupId || !clubId) return [];

  const scope = `${setupId}:club:${clubId}`;
  return compact((payload.players || []).map((player) => {
    const playerKey = player?.playerDataId || player?.playerId;
    if (!playerKey) return null;
    return entity('squad_player', `${setupId}:${playerKey}`, scope, {
      setupId,
      clubId,
      ...player,
    });
  }));
}

function transferEntities(entry) {
  return compact((entry.payload?.transfers || []).map((transfer) => {
    const key = transfer?.transferId
      || [transfer?.playerId, transfer?.acceptedDate, transfer?.fromClubId, transfer?.toClubId].filter(Boolean).join(':');
    if (!key) return null;
    return entity('transfer', key, 'transfer-market', transfer);
  }));
}

function playerChangeEntities(entry) {
  const rows = [];
  const addRows = (items, kind) => {
    for (const item of items || []) {
      if (!item?.playerId) continue;
      const signature = [
        item.playerId,
        item.changeType || kind,
        item.oldRating,
        item.newRating,
        item.oldPositionId,
        item.newPositionId,
      ].map((value) => value ?? '').join(':');
      rows.push(entity('player_change', signature, 'player-changes', { eventKind: kind, ...item }));
    }
  };
  addRows(entry.payload?.changes, 'change');
  addRows(entry.payload?.newPlayers, 'new');
  return rows;
}

function financeEntities(entry) {
  const context = parseSourceContext(entry.sourceUrl);
  const scope = [context.setupId || 'unknown-world', context.clubId || 'unknown-club'].join(':');
  return [entity('club_finance', scope, scope, {
    setupId: context.setupId || null,
    clubId: context.clubId || null,
    ...entry.payload,
  })];
}

export function extractSoccerManagerEntities(entries) {
  const output = [];
  const seen = new Map();

  for (const entry of entries || []) {
    if (!entry?.payload?.kind) continue;
    let entities = [];
    if (entry.payload.kind === 'competition') entities = competitionEntities(entry);
    if (entry.payload.kind === 'clubSquad') entities = squadEntities(entry);
    if (entry.payload.kind === 'transfers') entities = transferEntities(entry);
    if (entry.payload.kind === 'playerChanges') entities = playerChangeEntities(entry);
    if (entry.payload.kind === 'clubFinance') entities = financeEntities(entry);

    for (const row of entities) {
      const identity = `${row.entityType}\u0000${row.entityKey}`;
      seen.set(identity, row);
    }
  }

  for (const row of seen.values()) output.push(row);
  return output;
}

export function normalizedPayloadForPersistence(entries) {
  return (entries || []).map((entry) => ({
    source: entry.name || null,
    sourceUrl: sanitizeSoccerManagerSourceUrl(entry.sourceUrl),
    ...entry.payload,
  }));
}

export async function stageSoccerManagerSync(entries, capturedAt = null) {
  if (!supabase) throw new Error('Supabase is not connected.');
  const normalizedPayload = normalizedPayloadForPersistence(entries);
  const entities = extractSoccerManagerEntities(entries);
  if (!normalizedPayload.length) throw new Error('There is no normalized Soccer Manager data to stage.');

  const { data, error } = await supabase.rpc('stage_soccer_manager_sync', {
    target_payload: normalizedPayload,
    target_entities: entities,
    target_captured_at: capturedAt || new Date().toISOString(),
  });
  if (error) throw error;
  return {
    runId: data,
    sourceCount: normalizedPayload.length,
    entityCount: entities.length,
  };
}

export async function reviewSoccerManagerSyncChange(changeId, decision) {
  if (!supabase) throw new Error('Supabase is not connected.');
  const { data, error } = await supabase.rpc('review_soccer_manager_sync_change', {
    target_change_id: changeId,
    target_decision: decision,
  });
  if (error) throw error;
  return data;
}

export async function reviewSoccerManagerSyncRun(runId, decision) {
  if (!supabase) throw new Error('Supabase is not connected.');
  const { data, error } = await supabase.rpc('review_soccer_manager_sync_run', {
    target_run_id: runId,
    target_decision: decision,
  });
  if (error) throw error;
  return Number(data || 0);
}
