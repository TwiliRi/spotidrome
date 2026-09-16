import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import useStore, { setRouteNow } from './state/store';
import useShortcuts from './lib/shortcuts';
import useCompact from './lib/useCompact';
import useUiLayout from './lib/uiLayout';

import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import PlayerBar from './components/PlayerBar';
import RightPanel from './components/RightPanel';
import NowPlaying from './components/NowPlaying';
import DiceRoll from './components/DiceRoll';
import RandomVinyl from './components/RandomVinyl';
import RandomCosmos from './components/RandomCosmos';
import RandomBlackHole from './components/RandomBlackHole';
import ContextMenu from './components/ContextMenu';
import MiniPlayer from './components/MiniPlayer';
import LayoutModal from './components/LayoutModal';
import AddToPlaylist from './components/AddToPlaylist';
import { EqualizerModal, SettingsModal, AboutModal, Toasts } from './components/Modals';

import Login from './pages/Login';
import Home from './pages/Home';
import Search from './pages/Search';
import Library from './pages/Library';
import Album from './pages/Album';
import Artist from './pages/Artist';
import Playlist from './pages/Playlist';
import Liked from './pages/Liked';
import Offline from './pages/Offline';
import Disliked from './pages/Disliked';
import Recent from './pages/Recent';
import Stats from './pages/Stats';
import Genre from './pages/Genre';

function Main() {
  const loc = useLocation();
  const ref = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const heroColor = useStore((s) => s.heroColor);
  const pageTitle = useStore((s) => s.pageTitle);
  const pagePlay = useStore((s) => s.pagePlay);
  const pageRoute = useStore((s) => s.pageRoute);
  const libraryVersion = useStore((s) => s.libraryVersion);

  /* Маршрут запоминаем прямо в рендере: страницы ставят заголовок в своих
     эффектах, то есть уже после этого, — и их заголовок оказывается «своим»
     для текущего адреса. Заголовок прошлой страницы мы просто не показываем. */
  setRouteNow(loc.pathname);
  const fresh = pageRoute === loc.pathname;

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [loc.pathname, loc.search]);

  return (
    <main className="main">
      <div className="scroll" ref={ref} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 80)}>
        <TopBar
          scrolled={scrolled}
          heroColor={fresh ? heroColor : '#121212'}
          title={fresh ? pageTitle : ''}
          pagePlay={fresh ? pagePlay : null}
        />
        <Routes key={libraryVersion}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/library" element={<Library />} />
          <Route path="/album/:id" element={<Album />} />
          <Route path="/artist/:id" element={<Artist />} />
          <Route path="/playlist/:id" element={<Playlist />} />
          <Route path="/liked" element={<Liked />} />
          <Route path="/recent" element={<Recent />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/offline" element={<Offline />} />
          <Route path="/disliked" element={<Disliked />} />
          <Route path="/genre/:name" element={<Genre />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </main>
  );
}

/* Плавающая карточка мини-плеера — для браузера, где размер окна не наш.
   Таскается мышью за любое место, кроме кнопок и ползунков. */
function MiniFloat() {
  const miniPos = useStore((s) => s.miniPos);
  const [pos, setPos] = useState(miniPos || { x: window.innerWidth - 372, y: window.innerHeight - 500 });
  const drag = useRef(null);
  const last = useRef(pos);

  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      const { dx, dy } = drag.current;
      const p = {
        x: Math.max(8, Math.min(window.innerWidth - 356, e.clientX - dx)),
        y: Math.max(8, Math.min(window.innerHeight - 120, e.clientY - dy)),
      };
      last.current = p;
      setPos(p);
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove('grabbing');
      useStore.getState().setUI({ miniPos: last.current });   // запомним, где оставили
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const down = (e) => {
    if (e.button !== 0 || e.target.closest('.no-drag')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    document.body.classList.add('grabbing');
  };

  return (
    <div className="mini-float" style={{ left: pos.x, top: pos.y }} onPointerDown={down}>
      <MiniPlayer layout="mini" />
    </div>
  );
}

const isDesktop = typeof window !== 'undefined' && !!window.desktop;

/* Свёрнутое приложение (браузер: своего окна нет, поэтому сворачиваем
   интерфейс в плашку — музыка продолжает играть, плашка возвращает всё назад). */
function MinimizedBar() {
  const restore = useStore((s) => s.restoreApp);
  const track = useStore((s) => s.current());
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') restore(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restore]);

  return (
    <div className="minbar">
      <button className="minbar-btn" onClick={restore} title="Развернуть приложение" data-testid="app-restore">
        <span className="minbar-ic" aria-hidden="true">▶</span>
        <span className="minbar-txt">
          <b>Spotidrome</b>
          <i>{track ? `${track.title} — ${track.artist}` : 'приложение свёрнуто'}</i>
        </span>
        <span className="minbar-hint">Развернуть</span>
      </button>
    </div>
  );
}

export default function App() {
  const booted = useStore((s) => s.booted);
  const connected = useStore((s) => s.connected);
  const boot = useStore((s) => s.boot);
  const queueOpen = useStore((s) => s.queueOpen);
  const nowPlayingOpen = useStore((s) => s.nowPlayingOpen);
  const eqOpen = useStore((s) => s.eqOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const aboutOpen = useStore((s) => s.aboutOpen);
  const addToOpen = useStore((s) => s.addToOpen);
  const contextMenu = useStore((s) => s.contextMenu);
  const dice = useStore((s) => s.dice);
  const miniForced = useStore((s) => s.miniForced);
  const appMinimized = useStore((s) => s.appMinimized);
  const layoutOpen = useStore((s) => s.layoutOpen);
  const { layout } = useCompact();
  const ui = useUiLayout();
  useShortcuts();

  useEffect(() => { boot(); }, []); // eslint-disable-line

  /* класс на <html> — чтобы CSS знал про компактный режим */
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.layout = layout;
    return () => { delete el.dataset.layout; };
  }, [layout]);

  /* Пока поверх интерфейса лежит что-то полноэкранное (плеер во весь экран,
     настройки, эквалайзер…), верхняя панель не должна таскать окно.
     В Electron её `-webkit-app-region: drag` живёт на уровне окна: клики в этой
     полосе уходят системе на перетаскивание и до кнопок просто не доходят —
     в браузере этого нет, поэтому баг виден только в собранном приложении. */
  const overlayOpen = nowPlayingOpen || eqOpen || settingsOpen || aboutOpen || layoutOpen
    || !!addToOpen || !!contextMenu || !!dice;
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.overlay = overlayOpen ? 'on' : 'off';
    return () => { delete el.dataset.overlay; };
  }, [overlayOpen]);

  if (!booted) {
    return <div className="login"><div className="spinner" /></div>;
  }

  /* «свернуть приложение» — в браузере это единственный способ убрать всё с экрана */
  if (appMinimized) return <MinimizedBar />;

  /* окно ужато до размера плеера — показываем только плеер */
  if (connected && layout !== 'full') {
    return (
      <>
        <MiniPlayer layout={layout} />
        {layout === 'mini' && <Toasts />}
      </>
    );
  }

  if (!connected) return (
    <div className="login-shell">
      <TitleBar minimal />
      <Login />
      <Toasts />
    </div>
  );

  return (
    <>
      <div
        className={[
          'app',
          queueOpen ? 'with-right' : '',
          `sb-${ui.sidebarSide}`,
          `q-${ui.queueSide}`,
          ui.showSidebar ? '' : 'no-sidebar',
          ui.showTitlebar ? '' : 'no-titlebar',
        ].filter(Boolean).join(' ')}
      >
        {/* без верхней панели в десктопе остаётся тонкая полоска: за неё
            двигают окно, на ней же кнопки свернуть/развернуть/закрыть */}
        {ui.showTitlebar ? <TitleBar /> : (isDesktop && <TitleBar minimal />)}
        {ui.showSidebar && <Sidebar />}
        <Main />
        {queueOpen && <RightPanel />}
        <PlayerBar />
      </div>

      {miniForced && <MiniFloat />}
      {nowPlayingOpen && <NowPlaying />}
      <DiceRoll />
      <RandomVinyl />
      <RandomCosmos />
      <RandomBlackHole />
      {eqOpen && <EqualizerModal />}
      {settingsOpen && <SettingsModal />}
      {layoutOpen && <LayoutModal />}
      {aboutOpen && <AboutModal />}
      <AddToPlaylist />
      <ContextMenu />
      <Toasts />
    </>
  );
}
