import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import { seasonNumberFromCode, seasonSlugFromCode, slugify } from '../lib/tournamentSlugs';

const TournamentContext = createContext(null);
const groupCodes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const defaultTournamentForm = {
  gameWorldName: 'Top 100',
  gameWorldSlug: 'top-100',
  seasonCode: 'S28',
  competitionName: 'Youth Cup',
  competitionSlug: 'youth-cup',
  tournamentName: 'S28 Youth Cup',
  maxEntries: 64,
  teamsPerGroup: 4,
  groupCount: 16,
  knockoutTeams: 32,
  secondaryBracketName: 'Shield',
  registrationStatus: 'closed',
};

export const demoEntrants = ['Genoa', 'Espanyol', 'Bayern Munich', 'Barcelona', 'CSKA', 'Hertha Berlin', 'Independiente', 'River Plate', 'Montpellier', 'West Brom', 'Club Brugge', 'Juventus', 'Leicester Youth', 'Levante', 'Dortmund', 'Hamburg', 'Stoke City', 'Sao Paulo', 'FC Porto', 'Sampdoria', 'Sporting', 'SC Internacional', 'Chelsea', 'Anderlecht', 'Celtic Factory', 'Dynamo Moskva', 'Besiktas', 'PSV', 'AC Milan', 'Crystal Palace', 'Fenerbahce', 'Monaco', 'Benfica', 'Cruzeiro', 'Liverpool', 'Athletic Club', 'Tottenham', 'Werder Bremen', 'Villarreal', 'Real Madrid', 'Udinese', 'Valencia', 'Wolfsburg', 'CR Flamengo', 'Leverkusen', 'Swansea', 'Newcastle United', 'Saint Etienne', 'Ajax', 'Roma', 'Lazio', 'Marseille', 'Fiorentina', 'Lyon', 'Sevilla', 'Porto B', 'Everton', 'Napoli', 'Atalanta', 'Boca Juniors', 'Palmeiras', 'Flamengo Youth', 'Galatasaray', 'Rangers'].map((teamName, index) => ({ id: index + 1, team_name: teamName, manager_name: 'Manager ' + (index + 1), seed: index + 1, rating: 100 - Math.floor(index / 4) }));

export function normalStatus(tournament) { return String(tournament?.status || 'draft').toLowerCase(); }
export function isArchived(tournament) { return normalStatus(tournament) === 'archived'; }
export function isPlaceholderArchive(tournament) { return tournament?.archive_quality === 'placeholder' || (normalStatus(tournament) === 'archived' && Number(tournament?.actual_entries || 0) === 0 && tournament?.source !== 'challonge'); }
export function completed(match) { return match.status === 'played' || match.status === 'forfeit'; }
function sortTournaments(items) { const rank = { published: 0, groups_approved: 1, draft: 2, completed: 3, archived: 4 }; return [...items].sort((a, b) => (rank[normalStatus(a)] ?? 2) - (rank[normalStatus(b)] ?? 2) || Number(isPlaceholderArchive(a)) - Number(isPlaceholderArchive(b)) || new Date(b.created_at || 0) - new Date(a.created_at || 0)); }
function generateGroups(entries, groupCount) {
  const groups = groupCodes.slice(0, groupCount).map((code, index) => ({ code, group_order: index + 1, entries: [] }));
  for (let start = 0; start < entries.length; start += groupCount) {
    const potNumber = Math.floor(start / groupCount) + 1;
    const pot = entries.slice(start, start + groupCount);
    const orderedPot = potNumber % 2 === 1 ? pot : [...pot].reverse();
    orderedPot.forEach((entry, index) => { const group = groups[index % groupCount]; if (group) group.entries.push({ ...entry, group_code: group.code, pot: potNumber }); });
  }
  return groups;
}
function roundRobinRounds(entries) {
  const teams = [...entries];
  if (teams.length % 2 === 1) teams.push({ bye: true });
  const rounds = [];
  let rotation = [...teams];
  for (let roundIndex = 0; roundIndex < teams.length - 1; roundIndex += 1) {
    const pairings = [];
    for (let index = 0; index < teams.length / 2; index += 1) {
      const first = rotation[index];
      const second = rotation[rotation.length - 1 - index];
      if (!first.bye && !second.bye) pairings.push(roundIndex % 2 === 0 ? [first, second] : [second, first]);
    }
    rounds.push(pairings);
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }
  return rounds;
}
function generateFixtures(groups) {
  const fixtures = [];
  let matchOrder = 1;
  groups.forEach((group) => {
    const firstLegRounds = roundRobinRounds(group.entries);
    const allRounds = [...firstLegRounds, ...firstLegRounds.map((round) => round.map(([home, away]) => [away, home]))];
    allRounds.forEach((roundPairings, roundIndex) => roundPairings.forEach(([home, away]) => fixtures.push({ group_code: group.code, round: 'MD' + (roundIndex + 1), leg: roundIndex < firstLegRounds.length ? 1 : 2, match_order: matchOrder++, home_entry_id: home.id, away_entry_id: away.id, home_placeholder: home.team_name, away_placeholder: away.team_name })));
  });
  return fixtures;
}

export function TournamentProvider({ children }) {
  const [form, setForm] = useState(defaultTournamentForm);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState([]);
  const [progressStats, setProgressStats] = useState({ groupTotal: 0, groupPlayed: 0, knockoutTotal: 0, knockoutPlayed: 0 });
  const canUseDatabase = hasSupabaseConfig && supabase;

  useEffect(() => { if (canUseDatabase) loadTournaments(); }, [canUseDatabase]);
  const selectedTournament = useMemo(() => tournaments.find((item) => item.id === selectedTournamentId) || tournaments.find((item) => !isArchived(item) && !isPlaceholderArchive(item)) || tournaments.find((item) => !isPlaceholderArchive(item)) || tournaments[0] || null, [selectedTournamentId, tournaments]);
  useEffect(() => { if (canUseDatabase && selectedTournament?.id) loadProgressStats(selectedTournament.id); }, [canUseDatabase, selectedTournament?.id]);

  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function buildPreview(entries) {
    const groupCount = Number(selectedTournament?.group_count || form.groupCount || Math.ceil(entries.length / Number(form.teamsPerGroup || 4)) || 16);
    const sorted = [...entries].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || String(a.team_name).localeCompare(String(b.team_name))).map((entry, index) => ({ ...entry, seed: index + 1 }));
    const groups = generateGroups(sorted, groupCount);
    const fixtures = generateFixtures(groups);
    setPreview({ groups, fixtures });
    setStatus('Groups generated by average rating: ' + groups.length + ' groups and ' + fixtures.length + ' fixtures.');
    return { groups, fixtures };
  }
  function demoPreview() { return buildPreview(demoEntrants.slice(0, Number(form.maxEntries || 64))); }
  async function loadTournaments() {
    setLoading(true);
    setStatus('Loading tournaments...');
    const fullSelect = 'id, name, status, source, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at, season_number, public_slug, slug, is_public, archive_quality, registration_status, game_worlds(id, name, slug), competition_types(id, name, slug)';
    let result = await supabase.from('tournaments').select(fullSelect).order('created_at', { ascending: false });
    if (result.error) result = await supabase.from('tournaments').select('id, name, status, source, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at, season_number, public_slug, slug, is_public, registration_status, game_worlds(id, name, slug), competition_types(id, name, slug)').order('created_at', { ascending: false });
    if (result.error) result = await supabase.from('tournaments').select('id, name, status, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at').order('created_at', { ascending: false });
    const { data, error } = result;
    if (error) setStatus('Could not load tournaments: ' + error.message);
    else { const ordered = sortTournaments(data || []); setTournaments(ordered); if (!selectedTournamentId && ordered[0]) setSelectedTournamentId(ordered.find((item) => !isPlaceholderArchive(item))?.id || ordered[0].id); setBulkSelectedIds((ids) => ids.filter((id) => ordered.some((item) => item.id === id))); setStatus('Tournaments loaded'); }
    setLoading(false);
  }
  async function loadProgressStats(tournamentId) {
    const { data, error } = await supabase.from('matches').select('id, stage, status').eq('tournament_id', tournamentId);
    if (error) return setProgressStats({ groupTotal: 0, groupPlayed: 0, knockoutTotal: 0, knockoutPlayed: 0 });
    const matches = data || [];
    const groupMatches = matches.filter((match) => match.stage === 'group');
    const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
    setProgressStats({ groupTotal: groupMatches.length, groupPlayed: groupMatches.filter(completed).length, knockoutTotal: knockoutMatches.length, knockoutPlayed: knockoutMatches.filter(completed).length });
  }
  async function refreshTournamentData() { await loadTournaments(); const tournamentId = selectedTournament?.id || selectedTournamentId; if (tournamentId) await loadProgressStats(tournamentId); }
  async function deleteRows(table, tournamentIds) { if (!tournamentIds.length) return; const { error } = await supabase.from(table).delete().in('tournament_id', tournamentIds); if (error && !String(error.message || '').includes('does not exist')) throw error; }
  async function deleteByMatchIds(table, matchIds) { if (!matchIds.length) return; const { error } = await supabase.from(table).delete().in('match_id', matchIds); if (error && !String(error.message || '').includes('does not exist')) throw error; }
  async function deleteTournamentIds(ids, label = 'selected') {
    if (!canUseDatabase || !ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${label} tournament(s) and their fixtures, groups, entries and honours? This cannot be undone.`)) return;
    setLoading(true); setStatus(`Deleting ${label} tournaments...`);
    try {
      await deleteRows('match_comments', ids); await deleteRows('achievements', ids); await deleteRows('honours', ids); await deleteRows('tournament_round_dates', ids);
      const { data: matchRows, error: matchFindError } = await supabase.from('matches').select('id').in('tournament_id', ids);
      if (matchFindError) throw matchFindError;
      const matchIds = (matchRows || []).map((match) => match.id);
      await deleteByMatchIds('forfeits', matchIds); await deleteByMatchIds('match_comments', matchIds);
      await deleteRows('matches', ids); await deleteRows('groups', ids); await deleteRows('tournament_entries', ids); await deleteRows('tournament_rounds', ids); await deleteRows('tournament_stages', ids);
      const { error: tournamentError } = await supabase.from('tournaments').delete().in('id', ids);
      if (tournamentError) throw tournamentError;
      setSelectedTournamentId((current) => ids.includes(current) ? null : current); setBulkSelectedIds([]); setPreview(null); await loadTournaments(); setStatus(`Deleted ${ids.length} tournament(s).`);
    } catch (error) { setStatus('Delete failed: ' + error.message); }
    setLoading(false);
  }
  async function updateTournamentIds(ids, nextStatus) {
    if (!canUseDatabase || !ids.length) return;
    setLoading(true); setStatus(`Marking ${ids.length} tournament(s) as ${nextStatus}...`);
    const patch = { status: nextStatus };
    if (nextStatus === 'archived' || nextStatus === 'completed') patch.archived_at = new Date().toISOString();
    const { error } = await supabase.from('tournaments').update(patch).in('id', ids);
    if (error) setStatus('Status update failed: ' + error.message); else { await loadTournaments(); setStatus(`Marked ${ids.length} tournament(s) as ${nextStatus}.`); }
    setLoading(false);
  }
  async function findOrCreate(table, match, row) {
    const { data: existing, error: findError } = await supabase.from(table).select('id').match(match).maybeSingle();
    if (findError) throw findError;
    if (existing) return existing.id;
    const { data, error } = await supabase.from(table).insert(row).select('id').single();
    if (error) throw error;
    return data.id;
  }
  async function createTournament(event) {
    event.preventDefault();
    if (!canUseDatabase) return setStatus('Add your Supabase environment variables in Netlify before saving.');
    setLoading(true); setStatus('Creating tournament...');
    try {
      const seasonNumber = seasonNumberFromCode(form.seasonCode);
      const seasonId = await findOrCreate('seasons', { code: form.seasonCode }, { code: form.seasonCode, number: seasonNumber });
      const competitionId = await findOrCreate('competitions', { name: form.competitionName }, { name: form.competitionName, competition_type: form.competitionSlug || 'youth-cup' });
      const gameWorldSlug = slugify(form.gameWorldSlug || form.gameWorldName || 'top-100') || 'top-100';
      const competitionSlug = slugify(form.competitionSlug || form.competitionName || 'youth-cup') || 'youth-cup';
      let gameWorldId = null;
      let competitionTypeId = null;
      try {
        gameWorldId = await findOrCreate('game_worlds', { slug: gameWorldSlug }, { name: form.gameWorldName || 'Top 100', slug: gameWorldSlug, display_order: gameWorldSlug === 'top-100' ? 1 : 100 });
        competitionTypeId = await findOrCreate('competition_types', { slug: competitionSlug }, { name: form.competitionName, slug: competitionSlug, default_max_entries: Number(form.maxEntries), default_group_count: Number(form.groupCount), default_teams_per_group: Number(form.teamsPerGroup), default_knockout_teams: Number(form.knockoutTeams), default_secondary_bracket_name: form.secondaryBracketName || null });
      } catch { gameWorldId = null; competitionTypeId = null; }
      const basePayload = { season_id: seasonId, competition_id: competitionId, name: form.tournamentName, status: 'draft', format: 'groups_then_knockout', source: 'app', max_entries: Number(form.maxEntries), actual_entries: 0, group_count: Number(form.groupCount), teams_per_group: Number(form.teamsPerGroup), knockout_teams: Number(form.knockoutTeams), secondary_bracket_name: form.secondaryBracketName || null, rules_notes: 'Created from Top 100 tournament app dashboard' };
      const v2Payload = { ...basePayload, game_world_id: gameWorldId, competition_type_id: competitionTypeId, season_number: seasonNumber, slug: slugify(form.tournamentName), public_slug: seasonSlugFromCode(form.seasonCode), is_public: true, archive_quality: 'unknown', registration_status: form.registrationStatus || 'closed' };
      let result = await supabase.from('tournaments').insert(v2Payload).select('id').single();
      if (result.error) result = await supabase.from('tournaments').insert(basePayload).select('id').single();
      const { data, error } = result;
      if (error) throw error;
      setSelectedTournamentId(data.id); setStatus(form.tournamentName + ' created successfully.'); await loadTournaments();
    } catch (error) { setStatus('Create failed: ' + error.message); }
    setLoading(false);
  }

  const value = { form, updateField, tournaments, selectedTournament, selectedTournamentId, setSelectedTournamentId, status, setStatus, loading, preview, setPreview, bulkSelectedIds, setBulkSelectedIds, progressStats, canUseDatabase, buildPreview, demoPreview, refreshTournamentData, deleteTournamentIds, updateTournamentIds, createTournament };
  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>;
}

export function useTournament() {
  const value = useContext(TournamentContext);
  if (!value) throw new Error('useTournament must be used inside TournamentProvider');
  return value;
}
