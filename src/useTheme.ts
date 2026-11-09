import { useEffect, useState } from 'react';
export function useTheme() {
  const [dark, updateDark] = useState(() => {
    try { const saved = localStorage.getItem('cardslinger-theme'); if (saved) return saved === 'dark'; } catch { /* Storage may be blocked. */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f7f7f7');
  }, [dark]);
  const setDark = (value: boolean) => {
    try { localStorage.setItem('cardslinger-theme', value ? 'dark' : 'light'); } catch { /* Theme still works this session. */ }
    updateDark(value);
  };
  return { dark, setDark };
}
