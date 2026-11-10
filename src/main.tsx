import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.warn); });
}

if (import.meta.env.PROD && window.location.origin === 'https://elij91.github.io') {
  window.addEventListener('load', () => {
    const visitPixel = new Image();
    visitPixel.referrerPolicy = 'no-referrer';
    visitPixel.src = 'https://jernitcg.goatcounter.com/count?p=/TCG-Scanner/';
  }, { once: true });
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
