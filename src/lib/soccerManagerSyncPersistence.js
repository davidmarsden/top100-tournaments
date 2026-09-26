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

function nonZeroSourceId(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text || text === '0') return null;
  return text;
}

function parseSourceContext(sourceUrl) {
  const safeUrl = sanitizeSoccerManagerSourceUrl(sourceUrl);
  if (!safeUrl) return {};
  try {
    const url = new URL(safeUrl);
    return {
      sourceUrl: safeUrl,
      setupId: nonZeroSourceId(url.searchParams.get('sid')),
      clubId: nonZeroSourceId(url.searchParams.get('clubid')),
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
  const players = payload.players || [];
  const rosterPlayerIds = players
    .map((player) => nonZeroSourceId(player?.playerDataId) || nonZeroSourceId(player?.playerId))
    .filter(Boolean);

  const rows = [
    entity('squad_scope', scope, scope, {
      setupId,
      clubId,
      rosterPlayerIds,
      playerCount: rosterPlayerIds.length,
    }),
  ];

  for (const player of players) {
    const playerKey = nonZeroSourceId(player?.playerDataId) || nonZeroSourceId(player?.playerId);
    if (!playerKey) continue;
    rows.push(entity('squad_player', `${setupId}:${playerKey}`, scope, {
      setupId,
      clubId,
      ...player,
    }));
  }

  return compact(rows);
}

function transferEntities(entry, fallbackSetupId = null) {
  const sourceContext = parseSourceContext(entry.sourceUrl);
  const setupId = sourceContext.setupId || fallbackSetupId || null;
  if (!setupId) return [];
  const worldScope = setupId;
  return compact((entry.payload?.transfers || []).map((transfer) => {
    const localKey = transfer?.transferId
      || [transfer?.playerId, transfer?.acceptedDate, transfer?.fromClubId, transfer?.toClubId].filter(Boolean).join(':');
    if (!localKey) return null;
    return entity('transfer', `${worldScope}:${localKey}`, worldScope, {
      setupId,
      turn: entry.payload?.turn ?? null,
      ...transfer,
    });
  }));
}

function playerChangeEntities(entry, fallbackSetupId = null) {
  const sourceContext = parseSourceContext(entry.sourceUrl);
  const setupId = sourceContext.setupId || fallbackSetupId || null;
  if (!setupId) return [];
  const rows = [];
  const addRows = (items, kind) => {
    for (const item of items || []) {
      if (!item?.playerId) continue;
      const worldScope = setupId;
      const occurrence = item.eventId
        ? `id:${item.eventId}`
        : item.eventDate
          ? `date:${item.eventDate}`
          : item.turn !== null && item.turn !== undefined
            ? `turn:${item.turn}`
            : null;

      // Player changes are events, not mutable player state. Without a source
      // occurrence discriminator, a later repeat of the same transition would
      // collide with the earlier event, so leave it unstaged rather than merge it.
      if (!occurrence) continue;

      const signature = [
        worldScope,
        occurrence,
        item.playerId,
        item.changeType || kind,
        item.oldRating,
        item.newRating,
        item.oldPositionId,
        item.newPositionId,
      ].map((value) => value ?? '').join(':');
      rows.push(entity('player_change', signature, worldScope, { setupId, eventKind: kind, ...item }));
    }
  };
  addRows(entry.payload?.changes, 'change');
  addRows(entry.payload?.newPlayers, 'new');
  return rows;
}


function tacticsEntities(entry, fallbackContext = {}) {
  const payload = entry.payload;
  const context = parseSourceContext(entry.sourceUrl);
  const setupId = payload?.club?.setupId || context.setupId || fallbackContext.setupId || null;
  const clubId = payload?.club?.clubId || context.clubId || fallbackContext.clubId || null;
  if (!setupId || !clubId) return [];

  const scope = `${setupId}:club:${clubId}`;
  const occurrence = payload?.turnDate ? `date:${payload.turnDate}` : 'state';

  return [entity('tactics_snapshot', `${scope}:tactics:${occurrence}`, scope, {
    setupId,
    clubId,
    turnDate: payload?.turnDate || null,
    formationId: payload?.formationId || null,
    instructions: payload?.instructions || {},
    players: payload?.players || [],
  })];
}

function matchReplayEntities(entry) {
  const payload = entry.payload;
  const setupId = payload?.source?.setupId || null;
  const fixtureId = payload?.source?.fixtureId || null;
  if (!setupId || !fixtureId) return [];
  const scope = String(setupId);
  return [entity('match_snapshot', `${scope}:fixture:${fixtureId}`, scope, payload)];
}

function financeEntities(entry, fallbackContext = {}) {
  const context = parseSourceContext(entry.sourceUrl);
  const setupId = context.setupId || fallbackContext.setupId || null;
  const clubId = context.clubId || fallbackContext.clubId || null;
  if (!setupId || !clubId) return [];
  const scope = `${setupId}:club:${clubId}`;
  return [entity('club_finance', scope, scope, {
    setupId,
    clubId,
    ...entry.payload,
  })];
}

function inferSyncContext(entries) {
  const setupIds = new Set();
  const clubs = [];

  for (const entry of entries || []) {
    const sourceContext = parseSourceContext(entry?.sourceUrl);
    if (sourceContext.setupId) setupIds.add(String(sourceContext.setupId));

    if (entry?.payload?.kind === 'competition' && entry.payload?.world?.setupId) {
      setupIds.add(String(entry.payload.world.setupId));
    }

    if (entry?.payload?.kind === 'matchReplay' && entry.payload?.source?.setupId) {
      setupIds.add(String(entry.payload.source.setupId));
    }

    if (entry?.payload?.kind === 'clubSquad' || entry?.payload?.kind === 'clubTactics') {
      const setupId = entry.payload?.club?.setupId || sourceContext.setupId;
      const clubId = entry.payload?.club?.clubId || sourceContext.clubId;
      if (setupId) setupIds.add(String(setupId));
      if (setupId && clubId) clubs.push({ setupId: String(setupId), clubId: String(clubId) });
    }
  }

  const setupId = setupIds.size === 1 ? [...setupIds][0] : null;
  const distinctClubs = new Map();
  for (const club of clubs) {
    distinctClubs.set(`${club.setupId}\u0000${club.clubId}`, club);
  }

  const matchingClubs = setupId
    ? [...distinctClubs.values()].filter((club) => club.setupId === setupId)
    : [];

  return {
    setupId,
    club: matchingClubs.length === 1 ? matchingClubs[0] : null,
  };
}

export function extractSoccerManagerEntities(entries, options = {}) {
  const output = [];
  const seen = new Map();
  const inferred = options.inferredContext || inferSyncContext(entries);

  for (const entry of entries || []) {
    if (!entry?.payload?.kind) continue;
    let entities = [];
    if (entry.payload.kind === 'competition') entities = competitionEntities(entry);
    if (entry.payload.kind === 'clubSquad') entities = squadEntities(entry);
    if (entry.payload.kind === 'transfers') entities = transferEntities(entry, inferred.setupId);
    if (entry.payload.kind === 'playerChanges') entities = playerChangeEntities(entry, inferred.setupId);
    if (entry.payload.kind === 'clubTactics') entities = tacticsEntities(entry, inferred.club || {});
    if (entry.payload.kind === 'matchReplay') entities = matchReplayEntities(entry);
    if (entry.payload.kind === 'clubFinance') entities = financeEntities(entry, inferred.club || {});

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

export async function stageSoccerManagerSync(entries, capturedAt = null, options = {}) {
  if (!supabase) throw new Error('Supabase is not connected.');
  if (!Array.isArray(entries) || !entries.length) throw new Error('There is no normalized Soccer Manager data to stage.');

  const batchSize = Math.max(1, Number(options.batchSize) || 100);
  const timestamp = capturedAt || new Date().toISOString();
  const runIds = [];
  let sourceCount = 0;
  let entityCount = 0;

  // Preserve the original whole-import semantics before partitioning transport.
  // Context inference must see every source, and entity deduplication remains
  // whole-import last-wins even when duplicate fixtures straddle batch boundaries.
  const inferredContext = inferSyncContext(entries);
  const dedupedEntities = extractSoccerManagerEntities(entries, { inferredContext });
  const entityBatchCount = Math.max(1, Math.ceil(dedupedEntities.length / batchSize));
  const sourceBatchCount = Math.max(1, Math.ceil(entries.length / batchSize));
  const batches = Math.max(sourceBatchCount, entityBatchCount);

  // Large world backfills can be tens or hundreds of MB when serialized. Sending the
  // whole collection through one PostgREST RPC can fail at the browser/proxy layer.
  // Sources and the already-deduplicated entity stream are sliced independently so
  // each canonical entity is staged exactly once across the review runs.
  for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
    const sourceBatch = entries.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    const normalizedPayload = normalizedPayloadForPersistence(sourceBatch);
    const entities = dedupedEntities.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    if (!normalizedPayload.length && !entities.length) continue;

    options.onProgress?.({
      batch: batchIndex + 1,
      batches,
      stagedSources: sourceCount,
      totalSources: entries.length,
    });

    const { data, error } = await supabase.rpc('stage_soccer_manager_sync', {
      target_payload: normalizedPayload,
      target_entities: entities,
      target_captured_at: timestamp,
    });
    if (error) {
      const completed = runIds.length ? ` after staging ${runIds.length} earlier batch(es) successfully` : '';
      throw new Error(`${error.message}${completed}`);
    }
    runIds.push(data);
    sourceCount += normalizedPayload.length;
    entityCount += entities.length;
  }

  if (!runIds.length) throw new Error('There is no normalized Soccer Manager data to stage.');
  return {
    runId: runIds[runIds.length - 1],
    runIds,
    sourceCount,
    entityCount,
  };
}

export async function reviewSoccerManagerSyncRuns(runIds, decision, options = {}) {
  if (!supabase) throw new Error('Supabase is not connected.');
  const ids = [...new Set((runIds || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!ids.length) throw new Error('No Soccer Manager sync runs were selected.');

  let reviewedCount = 0;
  const completedRunIds = [];
  for (let index = 0; index < ids.length; index += 1) {
    const runId = ids[index];
    options.onProgress?.({
      index: index + 1,
      total: ids.length,
      runId,
      reviewedCount,
    });
    try {
      const reviewed = await reviewSoccerManagerSyncRun(runId, decision);
      reviewedCount += reviewed;
      completedRunIds.push(runId);
    } catch (error) {
      const completed = completedRunIds.length
        ? ` after completing ${completedRunIds.length} earlier run(s): #${completedRunIds[0]}–#${completedRunIds[completedRunIds.length - 1]}`
        : '';
      throw new Error(`Sync #${runId} failed: ${error.message}${completed}`);
    }
  }

  return { reviewedCount, completedRunIds };
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
