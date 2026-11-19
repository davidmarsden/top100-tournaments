import { useCallback, useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import { signInFromOtherTop100Sites } from './ManagerEntry.jsx';

// The rules check (manager.smtop100.blog/rules-check): ten questions drawn from the rules (six on
// the squad limit and transfers, four on activity, vacancies and how Top 100 is run). Marked on
// the server (submit_rules_check); every answer must be right to pass, with as many tries as the
// manager likes. Open to anyone signed in, including waiting-list applicants. Passing applies any
// shorter ban the administrators offered for it.

const longDate = (value) => (value ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function Shell({ children }) {
  return <main className="manager-portal-shell rules-check">{children}</main>;
}

export default function RulesCheckPage() {
  const [signedIn, setSignedIn] = useState(true);
  const [questions, setQuestions] = useState(null);
  const [status, setStatus] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!hasSupabaseConfig || !supabase) { setMessage('Supabase is not connected.'); return; }
    const { data: session } = await supabase.auth.getSession();
    if (!session.session && !(await signInFromOtherTop100Sites().catch(() => null))) { setSignedIn(false); return; }
    setSignedIn(true);
    const [bank, mine] = await Promise.all([
      supabase.rpc('rules_check_questions'),
      supabase.rpc('my_rules_check', { p_world_slug: 'top-100' }),
    ]);
    if (bank.error || mine.error) { setMessage((bank.error || mine.error).message); return; }
    setQuestions(bank.data || []);
    setStatus(mine.data || {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('submit_rules_check', { p_answers: answers, p_world_slug: 'top-100' });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setResult(data);
    if (data.passed) load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function tryAgain() {
    // Keep the right answers; clear only the wrong ones.
    const wrong = new Set((result?.wrong || []).map((row) => row.id));
    setAnswers((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !wrong.has(id))));
    setResult(null);
  }

  if (!signedIn) {
    return <Shell><section className="card manager-login-card"><h1>Sign in first</h1><p className="muted">Use your Manager Portal sign-in. You'll come straight back here.</p><a className="button" href="/?next=/rules-check">Sign in</a></section></Shell>;
  }
  if (!questions || !status) return <Shell><section className="card"><h1>{message || 'Loading…'}</h1></section></Shell>;

  const reduction = status.reduction;
  const allAnswered = questions.every((q) => answers[q.id] !== undefined);
  const wrongIds = new Set((result?.wrong || []).map((row) => row.id));

  return (
    <Shell>
      <section className="manager-portal-hero">
        <p className="eyebrow">Top 100 · Rules check</p>
        <h1>Top 100 rules check</h1>
        <p className="muted">
          Ten questions from the <a href="https://smtop100.blog/rules/">Top 100 rules</a>: the squad limit, transfers, and how
          clubs, vacancies and activity work. Get every one right to pass; you can try as many times as you like, and each
          try draws a fresh set. For managers, applicants and anyone thinking of joining.
        </p>
        {reduction && !reduction.reducedAt && (
          <p className="rules-check__offer">Passing shortens your club's transfer ban to end on <strong>{longDate(reduction.reducedEndsOn)}</strong> instead of {longDate(reduction.endsOn)}.</p>
        )}
        {status.passedAt && <p className="rules-check__passed">✅ You passed on {longDate(status.passedAt)}.{reduction?.reducedAt ? ` Your club's transfer ban now ends on ${longDate(reduction.endsOn)}.` : ''}</p>}
      </section>

      {message && <p className="status" role="status">{message}</p>}

      {result && (
        <section className={`card rules-check__result ${result.passed ? 'is-pass' : 'is-fail'}`} aria-live="polite">
          <h2>{result.passed ? 'Passed: every answer right' : `${result.score} of ${result.total} right`}</h2>
          {result.passed
            ? <p>{result.banEndsOn ? `Your club's transfer ban now ends on ${longDate(result.banEndsOn)}. The admin team has been told.` : 'Thanks: the admin team can see you passed.'}</p>
            : (
              <>
                <p>Here's what the rules say about the ones you missed. Your right answers are kept.</p>
                <ul>{result.wrong.map((row) => <li key={row.id}>{row.why}</li>)}</ul>
                <button type="button" onClick={tryAgain}>Try again</button>
              </>
            )}
        </section>
      )}

      {!result && (
        <form onSubmit={submit}>
          {questions.map((q, index) => (
            <fieldset key={q.id} className={`card rules-check__question${wrongIds.has(q.id) ? ' is-wrong' : ''}`}>
              <legend><span className="muted">{index + 1}. Rule {q.rule}</span><br />{q.question}</legend>
              {q.options.map((option, optionIndex) => (
                <label key={option} className="rules-check__option">
                  <input type="radio" name={q.id} checked={answers[q.id] === optionIndex}
                    onChange={() => setAnswers({ ...answers, [q.id]: optionIndex })} />{' '}{option}
                </label>
              ))}
            </fieldset>
          ))}
          <p><button type="submit" disabled={!allAnswered || busy}>{busy ? 'Checking…' : allAnswered ? 'Check my answers' : 'Answer every question'}</button></p>
        </form>
      )}
    </Shell>
  );
}
