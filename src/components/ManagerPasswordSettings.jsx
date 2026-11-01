import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export const MIN_PASSWORD_LENGTH = 8;

// Optional password for the Manager Portal account, so a manager can sign in with email and
// password as well as with an email link or code. Supabase may ask for a recent sign-in
// before changing a password: then it emails a code, which is entered here.
export default function ManagerPasswordSettings({ session }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!session?.user || !supabase) return null;

  async function save(event) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) { setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (password !== confirm) { setMessage('The two passwords do not match.'); return; }
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.updateUser(needsCode ? { password, nonce: nonce.trim() } : { password });
    if (error && !needsCode && /reauthenticat/i.test(`${error.code || ''} ${error.message || ''}`)) {
      const { error: sendError } = await supabase.auth.reauthenticate();
      setBusy(false);
      if (sendError) { setMessage(sendError.message || 'Could not send the confirmation code.'); return; }
      setNeedsCode(true);
      setMessage(`To confirm it's you, we've emailed a code to ${session.user.email}. Enter it below.`);
      return;
    }
    setBusy(false);
    if (error) { setMessage(error.message || 'Could not save the password.'); return; }
    setPassword('');
    setConfirm('');
    setNonce('');
    setNeedsCode(false);
    setMessage(`Password saved. You can now sign in with ${session.user.email} and this password, as well as with an email link or code.`);
  }

  return (
    <section className="card manager-password-card">
      <p className="eyebrow">Your account</p>
      <h2>Password (optional)</h2>
      <p className="muted">
        Set a password to sign in with your email and password instead of waiting for an email. Email links and codes still work.
        To change it later, enter a new one here.
      </p>
      <form onSubmit={save}>
        <input type="email" autoComplete="username" value={session.user.email || ''} readOnly hidden />
        <label>New password<input type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></label>
        <label>Type it again<input type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={confirm} onChange={(event) => setConfirm(event.target.value)} required disabled={busy} /></label>
        {needsCode && <label>Code from the email<input type="text" inputMode="numeric" autoComplete="one-time-code" value={nonce} onChange={(event) => setNonce(event.target.value)} required disabled={busy} /></label>}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : needsCode ? 'Confirm and save password' : 'Save password'}</button>
      </form>
      {message && <p className="status" role="status">{message}</p>}
    </section>
  );
}
