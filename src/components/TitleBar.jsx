import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import { filterHistory, timeAgo, normalizeQuery } from '../lib/searchHistory';
import {
  Logo, Home, HomeFill, Search, ChevronLeft, ChevronRight, Gear, Sliders,
  Download, Info, Close, GridIc, Library, Check, ChevronDown, Dice, LayoutIc, Clock, Trash,
} from './Icons';

const desktop = typeof window !== 'undefined' ? window.desktop : null;
const isMac = desktop?.platform === 'darwin';

/* --- иконки кнопок окна (Windows/Linux) --- */
const WinMin = () => (<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.6" width="10" height="1" fill="currentColor" /></svg>);
const WinMax = () => (<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg>);
const WinRestore = () => (
  <svg width="10" height="10" viewBox="0 0 10 10">
    <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
    <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" />
  </svg>
);
const WinClose = () => (
  <svg width="10" height="10" viewBox="0 0 10 10">
    <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1.1" fill="none" />
  </svg>
);

export default function TitleBar({ minimal = false }) {
  const nav = useNavigate();
  const loc = useLocation();
  // точечные подписки: поле поиска не должно перерисовываться на каждую
  // отметку времени проигрывания (иначе карета «прыгает» при наборе)
  const setUI = useStore((s) => s.setUI);
  const credentials = useStore((s) => s.credentials);
  const serverInfo = useStore((s) => s.serverInfo);
  const logout = useStore((s) => s.logout);
  const musicFolders = useStore((s) => s.musicFolders);
  const settings = useStore((s) => s.settings);
  const setMusicFolder = useStore((s) => s.setMusicFolder);
  const loadMusicFolders = useStore((s) => s.loadMusicFolders);
  const rollDice = useStore((s) => s.rollDice);
  const randomBusy = useStore((s) => s.randomBusy);
  const searchHistory = useStore((s) => s.searchHistory);
  const pushSearchHistory = useStore((s) => s.pushSearchHistory);
  const removeSearchHistory = useStore((s) => s.removeSearchHistory);
  const clearSearchHistory = useStore((s) => s.clearSearchHistory);
  const [q, setQ] = useState('');
  const [histOpen, setHistOpen] = useState(false);      // выпадающая история под полем
  const [hl, setHl] = useState(-1);                      // строка, выбранная стрелками
  const [menu, setMenu] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const [folderMenu, setFolderMenu] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const searchRef = useRef(null);

  const isHome = loc.pathname === '/';
  const isSearch = loc.pathname.startsWith('/search');

  /* состояние окна */
  useEffect(() => {
    if (!desktop?.onWindowState) return;
    desktop.isMaximized?.().then(setMaximized).catch(() => {});
    return desktop.onWindowState((s) => { setMaximized(!!s.maximized); setFocused(!!s.focused); });
  }, []);

  /* история навигации */
  useEffect(() => { setCanBack(window.history.length > 1); }, [loc.key]);

  /* поиск: локальный ввод -> адрес */
  useEffect(() => {
    if (!isSearch) return;
    const t = setTimeout(() => {
      const cur = new URLSearchParams(loc.search).get('q') || '';
      if (cur !== q) nav(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`, { replace: true });
    }, 240);
    return () => clearTimeout(t);
  }, [q, isSearch]); // eslint-disable-line

  useEffect(() => {
    const v = new URLSearchParams(loc.search).get('q') || '';
    if (isSearch && v !== q) setQ(v);
    if (!isSearch && q) setQ('');
  }, [loc.pathname, loc.search]); // eslint-disable-line

  /* фокус в поиск по «/» */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const hotSearch = (e.key === '/' && tag !== 'input' && tag !== 'textarea')
        || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'l' || e.key === 'L'));
      if (hotSearch) {
        e.preventDefault();
        nav('/search');
        setTimeout(() => inputRef.current?.focus(), 40);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  useEffect(() => {
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) { setMenu(false); setFolderMenu(false); }
      if (!searchRef.current?.contains(e.target)) setHistOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => { if (!minimal) loadMusicFolders(); }, [minimal, loadMusicFolders]);

  const focusSearch = () => {
    if (!isSearch) nav('/search');
    setHistOpen(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  /* история поиска: показываем, только когда есть что показывать */
  const histItems = useMemo(() => (searchHistory.length ? filterHistory(searchHistory, q) : []), [searchHistory, q]);

  /* Поиск по явному действию: Enter в поле или клик по лупе. набор текста
     историю не трогает — иначе в ней оседает весь мусор, набранный по дороге. */
  const runQuery = (text) => {
    const v = normalizeQuery(text === undefined ? q : text);
    setQ(v);
    setHl(-1);
    setHistOpen(false);
    pushSearchHistory(v);
    nav(`/search${v ? `?q=${encodeURIComponent(v)}` : ''}`);
    inputRef.current?.focus();
  };

  const onSearchKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runQuery(hl >= 0 && histItems[hl] ? histItems[hl].q : undefined);
      return;
    }
    if (!histItems.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHistOpen(true); setHl((i) => (i + 1) % histItems.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHistOpen(true); setHl((i) => (i <= 0 ? histItems.length - 1 : i - 1)); }
    else if (e.key === 'Escape') { if (histOpen) { e.stopPropagation(); setHistOpen(false); setHl(-1); } }
  };

  const user = credentials?.demo ? 'DE' : (credentials?.username || 'U').slice(0, 2).toUpperCase();
  const activeFolder = settings.musicFolderId != null
    ? musicFolders.find((f) => String(f.id) === String(settings.musicFolderId))
    : null;

  return (
    <header className={`titlebar${isMac ? ' mac' : ''}${focused ? '' : ' blurred'}${minimal ? ' minimal' : ''}`}>
      <div className="tb-left">
        <div className="tb-brand no-drag" onDoubleClick={() => desktop?.maximizeToggle?.()}>
          <span className="tb-logo"><Logo size={26} /></span>
          <span className="tb-name">Spotidrome</span>
        </div>
        {!minimal && (
        <div className="tb-nav">
          <button className="tb-round sm no-drag" title="Назад" onClick={() => nav(-1)} disabled={!canBack}>
            <ChevronLeft size={15} />
          </button>
          <button className="tb-round sm no-drag" title="Вперёд" onClick={() => nav(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
        )}
      </div>

      {minimal ? <div /> : (
      <div className="tb-center">
        <button
          className={`tb-round no-drag${isHome ? ' active' : ''}`}
          title="Главная"
          onClick={() => nav('/')}
        >
          {isHome ? <HomeFill size={22} /> : <Home size={22} />}
        </button>

        <button
          className={`tb-round no-drag dice${randomBusy ? ' busy' : ''}`}
          title="Случайный трек (Shift+R)"
          aria-label="Случайный трек"
          disabled={randomBusy}
          onClick={(e) => rollDice(e.currentTarget.getBoundingClientRect())}
        >
          <Dice size={20} />
        </button>

        <div className="tb-search-wrap no-drag" ref={searchRef}>
          <div
            className={`tb-search no-drag${isSearch ? ' active' : ''}${histOpen && histItems.length ? ' open' : ''}`}
            onClick={focusSearch}
          >
            <button
              className="tb-go"
              title="Искать"
              aria-label="Искать"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); runQuery(); }}
            >
              <Search size={19} />
            </button>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setHl(-1); if (!isSearch) nav('/search'); }}
              onFocus={() => { if (histItems.length) setHistOpen(true); }}
              onKeyDown={onSearchKey}
              placeholder="Что хотите послушать?"
              aria-label="Поиск"
              autoComplete="off"
              spellCheck="false"
            />
            {q ? (
              <button className="tb-clear" title="Очистить" onClick={(e) => { e.stopPropagation(); setQ(''); inputRef.current?.focus(); }}>
                <Close size={13} />
              </button>
            ) : (
              <>
                <span className="tb-divider" />
                <button className="tb-browse" title="Обзор" onClick={(e) => { e.stopPropagation(); nav('/search'); }}>
                  <GridIc size={17} />
                </button>
              </>
            )}
          </div>

          {/* недавние запросы: стрелки выбирают, крестик убирает по одному */}
          {histOpen && !!histItems.length && (
            <div className="tb-hist" onMouseDown={(e) => e.preventDefault()}>
              <div className="tb-hist-head">
                <span>{q.trim() ? 'Совпадения в истории' : 'Недавние поиски'}</span>
                <button title="Очистить всю историю" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); clearSearchHistory(); setHl(-1); }}>
                  <Trash size={12} /> Очистить
                </button>
              </div>
              {histItems.map((it, i) => (
                <div key={it.q} className={`tb-hist-item${i === hl ? ' hl' : ''}`} onMouseEnter={() => setHl(i)}>
                  <button className="tb-hist-q" title={`Искать «${it.q}»`} onMouseDown={(e) => { e.preventDefault(); runQuery(it.q); }}>
                    <Clock size={13} />
                    <span>{it.q}</span>
                  </button>
                  <span className="tb-hist-ago">{timeAgo(it.at)}</span>
                  <button className="tb-hist-x" title="Убрать из истории" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeSearchHistory(it.q); }}>
                    <Close size={11} />
                  </button>
                </div>
              ))}
              <div className="tb-hist-foot"><span>↑ ↓ — выбор</span><span>Enter — искать</span><span>Esc — закрыть</span></div>
            </div>
          )}
        </div>
      </div>
      )}

      <div className="tb-right">
        {!minimal && (
        <div className="no-drag" style={{ position: 'relative' }} ref={menuRef}>
          <button className={`tb-avatar${menu ? ' active' : ''}`} onClick={() => setMenu((v) => !v)} title="Профиль">{user}</button>
          {menu && (
            <div className="ctx profile-menu" style={{ position: 'absolute', right: 0, top: 42, left: 'auto' }}>
              <div className="pm-head">
                <span className="pm-ava">{user}</span>
                <span className="pm-who">
                  <b>{credentials?.demo ? 'Демо-режим' : (credentials?.username || 'Пользователь')}</b>
                  <i>{credentials?.demo ? 'локальная библиотека' : (credentials?.url || '')}</i>
                </span>
              </div>
              {serverInfo && !credentials?.demo && (
                <div className="sub-label" style={{ textTransform: 'none' }}>
                  {serverInfo.type} {serverInfo.serverVersion || serverInfo.version}
                </div>
              )}

              {musicFolders.length > 1 && (
                <>
                  <div className="sep" />
                  <button className="pm-expand" onClick={() => setFolderMenu((v) => !v)}>
                    <Library size={14} />
                    <span>Музыкальная папка</span>
                    <em className="pm-val">{activeFolder ? activeFolder.name : 'Все папки'}</em>
                    <span className={`pm-chev${folderMenu ? ' open' : ''}`}><ChevronDown size={9} /></span>
                  </button>

                  {folderMenu && (
                    <div className="pm-sub">
                      <button onClick={() => { setMusicFolder(null); setFolderMenu(false); setMenu(false); }}>
                        <span className="fm-check">{activeFolder ? null : <Check size={12} />}</span>
                        Все папки
                      </button>
                      {musicFolders.map((f) => {
                        const on = String(settings.musicFolderId) === String(f.id);
                        return (
                          <button key={f.id} onClick={() => { setMusicFolder(f.id); setFolderMenu(false); setMenu(false); }}>
                            <span className="fm-check">{on ? <Check size={12} /> : null}</span>
                            <span style={{ color: on ? 'var(--green)' : undefined }}>{f.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              <div className="sep" />
              <button onClick={() => { setMenu(false); setUI({ eqOpen: true }); }}>
                <Sliders size={14} /> Эквалайзер
                <span className="pm-hint">E</span>
              </button>
              <button onClick={() => { setMenu(false); setUI({ layoutOpen: true }); }}><LayoutIc size={14} /> Интерфейс и раскладка</button>
              <button onClick={() => { setMenu(false); setUI({ settingsOpen: true }); }}><Gear size={14} /> Настройки</button>
              <button onClick={() => { setMenu(false); nav('/offline'); }}><Download size={14} /> Офлайн-загрузки</button>
              <button onClick={() => { setMenu(false); setUI({ aboutOpen: true }); }}><Info size={14} /> О программе</button>
              <div className="sep" />
              <button style={{ color: '#f5707a' }} onClick={() => { setMenu(false); logout(); }}>Выйти</button>
            </div>
          )}
        </div>
        )}

        {desktop && !isMac && (
          <div className="tb-winbtns no-drag">
            <button className="tb-winbtn" title="Свернуть" onClick={() => desktop.minimize()}><WinMin /></button>
            <button className="tb-winbtn" title={maximized ? 'Восстановить' : 'Развернуть'} onClick={() => desktop.maximizeToggle().then(setMaximized)}>
              {maximized ? <WinRestore /> : <WinMax />}
            </button>
            <button className="tb-winbtn close" title="Закрыть" onClick={() => desktop.closeWindow()}><WinClose /></button>
          </div>
        )}
      </div>
    </header>
  );
}
