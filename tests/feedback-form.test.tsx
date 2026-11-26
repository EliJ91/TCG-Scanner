// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FeedbackForm } from '../src/FeedbackForm';

it('shows the server’s daily limit message and lets the visitor keep their unsent feedback', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(async () => Response.json({ error: 'Feedback has reached its daily limit. Please try again after midnight UTC.' }, { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FeedbackForm endpoint="https://feedback.example/feedback" close={() => {}} />));
    container.querySelector('textarea')!.value = 'Please keep this message';
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('after midnight UTC');
    expect(container.querySelector('textarea')!.value).toBe('Please keep this message');
    expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
