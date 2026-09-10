import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import useStore from './state/store';
import { initDesktopMedia } from './lib/desktopMedia';
import './styles.css';

// удобный доступ к стору/API из DevTools в режиме разработки
if (import.meta.env.DEV) {
  window.__store = useStore;
  import('./lib/api').then((m) => { window.__api = m.default; });
  import('./lib/covers').then((m) => { window.__covers = m; });
}

// кнопки управления на панели задач / в трее / MPRIS (только в Electron)
initDesktopMedia();

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
);
