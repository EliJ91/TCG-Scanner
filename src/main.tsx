import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.warn); });
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
