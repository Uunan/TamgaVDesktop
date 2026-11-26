import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Synchronously apply cached desktop theme before first paint (zero dark/light flash)
try {
  const params = new URLSearchParams(window.location.search);
  const dId = params.get('desktop') || 'main';
  const raw = localStorage.getItem(`tamga_prefs_v1_${dId}`);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.theme === 'light' || parsed?.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', parsed.theme);
    }
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
