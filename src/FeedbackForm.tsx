import { useState, type FormEvent } from 'react';
import { feedbackMessageLimit, feedbackSubjectLimit } from './core/feedback';

export function FeedbackForm({ endpoint, close }: { endpoint: string; close: () => void }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const form = new FormData(event.currentTarget);
    const message = String(form.get('message') ?? '').trim();
    if (!message) { setError('Enter a message.'); return; }
    setSending(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: String(form.get('subject') ?? '').trim(), message }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429) { setError('Too many messages. Try again in a minute.'); return; }
      if (response.status !== 201) throw new Error('Submission failed');
      setSent(true);
    } catch {
      setError('Could not send your message. Check your connection and try again.');
    } finally { setSending(false); }
  };

  if (sent) return <>
    <div className="confirm-content"><p role="status">Thanks. Your message was sent.</p></div>
    <div className="dialog-footer"><button type="button" className="button dark" onClick={close}>Done</button></div>
  </>;

  return <form onSubmit={submit}>
    <div className="confirm-content">
      <p className="dialog-intro">All messages are completely anonymous and help development.</p>
      <label className="select-setting feedback-subject">Subject (optional)
        <input name="subject" maxLength={feedbackSubjectLimit} disabled={sending} />
      </label>
      <label className="select-setting feedback-message">Message
        <textarea name="message" rows={5} maxLength={feedbackMessageLimit} disabled={sending} required />
      </label>
      {error && <p className="name-error" role="alert">{error}</p>}
    </div>
    <div className="dialog-footer">
      <button type="submit" className="button dark" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</button>
    </div>
  </form>;
}
