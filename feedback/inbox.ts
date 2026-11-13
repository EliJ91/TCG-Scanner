import { feedbackCategories, type FeedbackCategory } from '../src/core/feedback';

export interface Feedback {
  id: string;
  subject?: string;
  category?: FeedbackCategory;
  message: string;
  createdAt: string;
}

function escapeHtml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function page(scannerUrl: string, content: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Feedback Inbox · JerniTCG Scanner</title>
  <style>
    :root { color-scheme: light dark; --background: #f7f7f7; --surface: #fff; --text: #191919; --muted: #606060; --border: #ddd; }
    @media (prefers-color-scheme: dark) { :root { --background: #000; --surface: #141414; --text: #f2f2f2; --muted: #aaa; --border: #333; } }
    body { margin: 0; padding: 24px 16px; background: var(--background); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
    main { max-width: 40rem; margin: 0 auto; }
    header, .message-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    h1 { font-size: 1.5rem; margin: 12px 0; }
    h2 { font-size: 1rem; margin: 0; overflow-wrap: anywhere; }
    a { color: inherit; }
    .button, button { display: inline-block; box-sizing: border-box; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
    .primary { background: var(--text); color: var(--background); border-color: transparent; }
    article { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 14px 0; }
    time, .muted { color: var(--muted); font-size: .875rem; }
    .message { white-space: pre-wrap; overflow-wrap: anywhere; }
    form { margin: 0; }
    .pagination { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
  </style>
</head>
<body><main>
  <header><h1>Feedback Inbox</h1><a href="${escapeHtml(scannerUrl)}">Back to scanner</a></header>
  ${content}
</main></body>
</html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function inbox(scannerUrl: string, messages: Feedback[], cursor: string | undefined, onOlderPage: boolean) {
  const cards = messages.map(({ id, subject, category, message, createdAt }) => `<article>
    <div class="message-heading"><h2>${escapeHtml(subject || (category && feedbackCategories[category]) || 'No subject')}</h2>
      <time datetime="${escapeHtml(createdAt)}">${escapeHtml(createdAt.slice(0, 16).replace('T', ' '))} UTC</time>
    </div>
    <p class="message">${escapeHtml(message)}</p>
    <form method="post" action="/inbox/delete/${encodeURIComponent(id)}"><button type="submit">Delete</button></form>
  </article>`).join('');
  return page(scannerUrl, `
    <form method="post" action="/logout"><button type="submit">Sign out</button></form>
    ${cards || '<p class="muted">No messages here.</p>'}
    <nav class="pagination" aria-label="Inbox pages">
      ${onOlderPage ? '<a class="button" href="/inbox">Newest messages</a>' : ''}
      ${cursor ? `<a class="button" href="/inbox?cursor=${encodeURIComponent(cursor)}">Older messages</a>` : ''}
    </nav>
  `);
}
