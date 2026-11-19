import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Who has taken the rules check (manager.smtop100.blog/rules-check), for the admin pages:
// waiting list, vacancy applications, reappointment reviews and Manager Alerts. One request per
// page load, shared by every badge on the page. Passing isn't required for anything yet.

const RULES_CHECK_URL = 'https://manager.smtop100.blog/rules-check';
const shortDate = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

let cache = null;
function loadResults() {
  if (!cache) {
    cache = supabase.rpc('rules_check_results').then(({ data, error }) => {
      if (error) { cache = null; return null; }
      const byManager = new Map();
      const byWaitingEntry = new Map();
      (data || []).forEach((row) => {
        if (row.managerId) byManager.set(String(row.managerId), row);
        (row.waitingEntryIds || []).forEach((id) => byWaitingEntry.set(String(id), row));
      });
      return { byManager, byWaitingEntry };
    });
  }
  return cache;
}

export function useRulesCheckResults() {
  const [results, setResults] = useState(null);
  useEffect(() => {
    let active = true;
    if (supabase) loadResults().then((loaded) => { if (active) setResults(loaded); });
    return () => { active = false; };
  }, []);
  return results;
}

// "Rules check: passed 19 Nov 2026", "tried 2×, not passed yet" or "not taken".
export function RulesCheckBadge({ managerId, waitingEntryId }) {
  const results = useRulesCheckResults();
  if (!results) return null;
  const row = (waitingEntryId != null && results.byWaitingEntry.get(String(waitingEntryId)))
    || (managerId != null && results.byManager.get(String(managerId)));
  const text = !row ? 'not taken'
    : row.passedAt ? `passed ${shortDate(row.passedAt)}`
      : `tried ${row.attempts}×, not passed yet`;
  return (
    <span className={`rules-check-badge ${row?.passedAt ? 'is-passed' : ''}`} title="The rules check is optional for now">
      Rules check: {text}
    </span>
  );
}

// For managers: an optional prompt, or when they passed.
export function RulesCheckPrompt({ context = '' }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let active = true;
    if (supabase) {
      supabase.rpc('my_rules_check', { p_world_slug: 'top-100' }).then(({ data }) => { if (active) setStatus(data || {}); });
    }
    return () => { active = false; };
  }, []);
  if (status?.passedAt) {
    return <p className="rules-check-prompt is-passed">✅ You passed the <a href={RULES_CHECK_URL}>rules check</a> on {shortDate(status.passedAt)}.</p>;
  }
  return (
    <p className="rules-check-prompt">
      <strong>Optional:</strong> take the <a href={RULES_CHECK_URL}>rules check</a>{context ? ` ${context}` : ''}: ten quick questions on the squad limit,
      transfers and how Top 100 is run. You can retake it as often as you like, and the administrators can see when you pass.
    </p>
  );
}
