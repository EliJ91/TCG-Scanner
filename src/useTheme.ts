import { useEffect, useState } from 'react';
export function useTheme() {
  const [dark, setDark] = useState(() => {
    try { const saved = localStorage.getItem('cardslinger-theme'); if (saved) return saved === 'dark'; } catch { /* Storage may be blocked. */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f7f7f7');
    try { localStorage.setItem('cardslinger-theme', dark ? 'dark' : 'light'); } catch { /* Theme still works this session. */ }
  }, [dark]);
  return { dark, setDark };
}
