import React, { useEffect, useMemo, useRef, useState } from 'react';
import useStore from '../state/store';
import { Cover } from './UI';
import { Close, Search, Plus, Check, PinFillIc } from './Icons';
import { songsWord } from '../lib/util';

/**
 * «Добавить в плейлист» — общий выбор для любого места приложения.
 * Открывается через setUI({ addToOpen: { ids: [...], title: '…' } }).
 * Показывает только свои плейлисты: чужие (расшаренные) сервер править не даёт.
 */
export default function AddToPlaylist() {
  const addToOpen = useStore((s) => s.addToOpen);
  const setUI = useStore((s) => s.setUI);
  const playlists = useStore((s) => s.playlists);
  const pins = useStore((s) => s.settings.pins);
  const { splitPlaylists, addTracksToPlaylist, createPlaylistWith, pinIndex, orderPlaylists } = useStore.getState();

  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState([]);
  const inputRef = useRef(null);

  const open = !!addToOpen;
  const ids = addToOpen?.ids || [];

  useEffect(() => {
    if (!open) { setQ(''); setNewName(''); setCreating(false); setDone([]); return; }
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setUI({ addToOpen: null }); } };
    window.addEventListener('keydown', esc);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.removeEventListener('keydown', esc);
  }, [open, setUI]);

  const mine = useMemo(() => {
    const list = orderPlaylists(splitPlaylists(playlists).mine);
    const s = q.trim().toLowerCase();
    const found = s ? list.filter((p) => p.name.toLowerCase().includes(s)) : list;
    // закреплённые — вверх, остальные в порядке сервера
    return [...found].sort((a, b) => {
      const pa = pinIndex('playlist', a.id), pb = pinIndex('playlist', b.id);
      if (pa === pb) return 0;
      if (pa < 0) return 1;
      if (pb < 0) return -1;
      return pa - pb;
    });
  }, [playlists, q, pins, splitPlaylists, pinIndex]);

  if (!open) return null;

  const add = async (pl) => {
    setBusy(pl.id);
    const ok = await addTracksToPlaylist(pl.id, ids);
    setBusy(null);
    if (ok) {
      setDone((d) => [...d, pl.id]);
      setTimeout(() => setUI({ addToOpen: null }), 550);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy('__new');
    const pl = await createPlaylistWith(name, ids);
    setBusy(null);
    if (pl) setUI({ addToOpen: null });
  };

  const what = addToOpen.title || (ids.length === 1 ? 'трек' : songsWord(ids.length));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setUI({ addToOpen: null })}>
      <div className="modal atp" style={{ width: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ marginBottom: 4 }}>Добавить в плейлист</h3>
            <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{what}</div>
          </div>
          <button className="icon-btn" onClick={() => setUI({ addToOpen: null })}><Close size={14} /></button>
        </div>

        <div className="search-box atp-search">
          <Search size={14} />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Найти свой плейлист"
          />
        </div>

        {creating ? (
          <div className="atp-new">
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="Название плейлиста"
            />
            <button className="pill-btn" disabled={!newName.trim() || busy === '__new'} onClick={create}>Создать</button>
            <button className="btn-ghost" onClick={() => setCreating(false)}>Отмена</button>
          </div>
        ) : (
          <button className="atp-row new" onClick={() => { setCreating(true); setNewName(q); }}>
            <span className="atp-plus"><Plus size={18} /></span>
            <div className="meta"><div className="name">Новый плейлист</div><div className="sub">Создать и добавить сразу</div></div>
          </button>
        )}

        <div className="atp-list">
          {mine.map((pl) => (
            <button key={pl.id} className={`atp-row${done.includes(pl.id) ? ' done' : ''}`} disabled={!!busy} onClick={() => add(pl)}>
              <Cover id={pl.coverArt || pl.id} size={100} alt={pl.name} />
              <div className="meta">
                <div className="name">
                  {pl.name}
                  {useStore.getState().isPinned('playlist', pl.id) && <PinFillIc size={11} />}
                </div>
                <div className="sub">{songsWord(pl.songCount || 0)}</div>
              </div>
              <span className="atp-act">
                {done.includes(pl.id) ? <Check size={16} /> : busy === pl.id ? <i className="spinner sm" /> : <Plus size={16} />}
              </span>
            </button>
          ))}
          {!mine.length && (
            <div className="muted" style={{ padding: '18px 4px', fontSize: 13, lineHeight: 1.6 }}>
              {q ? 'Ничего не найдено.' : 'Своих плейлистов пока нет.'} Общие плейлисты других пользователей
              редактировать нельзя — создайте свой.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
