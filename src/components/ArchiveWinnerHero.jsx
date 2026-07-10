import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';

function routeParts() {
  const [worldSlug, competitionSlug, seasonSlug] = window.location.pathname.split('/').filter(Boolean);
  return { worldSlug, competitionSlug, seasonSlug };
}

export default function ArchiveWinnerHero() {
  const [winner, setWinner] = useState('');
  const [target, setTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const findTarget = () => {
      const node = document.querySelector('.knockout-only-archive-route .hero-countdown');
      if (node && !cancelled) setTarget(node);
      else if (!cancelled) window.setTimeout(findTarget, 100);
    };
    findTarget();
    loadWinner();
    return () => { cancelled = true; };

    async function loadWinner() {
      const { worldSlug, competitionSlug, seasonSlug } = routeParts();
      if (!worldSlug || !competitionSlug || !seasonSlug || !supabase) return;

      const { data: tournaments, error: tournamentError } = await supabase
        .from('tournaments')
        .select('id')
        .eq('is_public', true)
        .eq('public_slug', seasonSlug.toLowerCase())
        .eq('game_worlds.slug', worldSlug)
        .eq('competition_types.slug', competitionSlug);
      if (cancelled || tournamentError || !tournaments?.length) return;

      const tournamentId = tournaments[0].id;
      const { data: finals, error: finalError } = await supabase
        .from('matches')
        .select('id, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, match_order')
        .eq('tournament_id', tournamentId)
        .eq('stage', 'knockout')
        .eq('round', 'Final')
        .order('match_order', { ascending: false });
      if (cancelled || finalError || !finals?.length) return;

      const final = finals[0];
      const winnerEntryId = final.winner_entry_id
        || (Number(final.home_score) > Number(final.away_score) ? final.home_entry_id : final.away_entry_id);
      if (!winnerEntryId) return;

      const { data: entry, error: entryError } = await supabase
        .from('tournament_entries')
        .select('teams(name)')
        .eq('id', winnerEntryId)
        .maybeSingle();
      if (!cancelled && !entryError && entry?.teams?.name) setWinner(entry.teams.name);
    }
  }, []);

  if (!target || !winner) return null;
  return createPortal(
    <div className="archive-winner-content">
      <span>Champion</span>
      <strong>🏆 {winner}</strong>
      <small>Tournament winner</small>
    </div>,
    target,
  );
}
