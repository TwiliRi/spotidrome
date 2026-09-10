import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import { useCoverSrc } from '../lib/covers';
import useStore from '../state/store';
import TrackList from '../components/TrackList';
import { Cover, Spinner } from '../components/UI';
import { Play, Pause, DotsH, Download, Shuffle, PinIc, PinFillIc, Plus } from '../components/Icons';
import { useDominantColor, fmtLong, songsWord, indexById } from '../lib/util';

export default function Playlist() {
  const { id } = useParams();
  const nav = useNavigate();
  const playQueue = useStore((s) => s.playQueue);
  const current = useStore((s) => s.current);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const setUI = useStore((s) => s.setUI);
  const addToQueue = useStore((s) => s.addToQueue);
  const downloadMany = useStore((s) => s.downloadMany);
  const toast = useStore((s) => s.toast);
  const loadPlaylists = useStore((s) => s.loadPlaylists);
  const toggleShuffle = useStore((s) => s.toggleShuffle);
  const shuffle = useStore((s) => s.shuffle);
  const isMyPlaylist = useStore((s) => s.isMyPlaylist);
  const togglePin = useStore((s) => s.togglePin);
  const isPinned = useStore((s) => s.isPinned);
  const pins = useStore((st) => st.settings.pins);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  const coverSrc = useCoverSrc(data ? (data.playlist.coverArt || data.playlist.id) : null, 400);
  const hero = useDominantColor(coverSrc, '#45318c');
  useEffect(() => { setUI({ heroColor: hero }); }, [hero, setUI]);

  const load = () => api.getPlaylist(id)
    .then((d) => {
      if (!d?.playlist) throw new Error('Плейлист не найден');
      setData(d); setError('');
      setName(d.playlist.name);
      setUI({ pageTitle: d.playlist.name });
    })
    .catch((e) => setError(e.message || 'Не удалось загрузить плейлист'));
  useEffect(() => { setData(null); setError(''); load(); }, [id]); // eslint-disable-line

  useEffect(() => {
    if (!data) return;
    setUI({ pagePlay: () => useStore.getState().playQueue(data.songs, 0, { type: 'playlist', name: data.playlist.name }) });
  }, [data, setUI]);

  if (error && !data) {
    return (
      <div className="page page-pad-top">
        <div className="center-empty">
          <div>{error}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="pill-btn" onClick={load}>Повторить</button>
            <button className="btn-ghost" onClick={() => nav('/library?tab=playlists')}>К плейлистам</button>
          </div>
        </div>
      </div>
    );
  }
  if (!data) return <Spinner />;
  const { playlist, songs } = data;
  const mine = isMyPlaylist(playlist);
  const pinned = isPinned('playlist', id);
  const isHere = current() && songs.some((s) => s.id === current().id);

  const rename = async () => {
    setEditing(false);
    if (name.trim() && name !== playlist.name) {
      await api.updatePlaylist(id, { name: name.trim() }).catch((e) => toast(e.message, 'error'));
      loadPlaylists();
      load();
      toast('Плейлист переименован', 'success');
    }
  };

  /**
   * Убираем трек по его позиции в ИСХОДНОМ списке плейлиста. Индекс строки в
   * таблице не подходит: исключённые треки в ней скрыты, и сдвиг удалил бы
   * соседний трек.
   */
  const remove = async (track) => {
    const target = track && typeof track === 'object' ? track : songs[track];
    const index = indexById(songs, target);
    if (index < 0) { toast('Трек уже не в плейлисте', 'info'); load(); return; }
    try {
      await api.updatePlaylist(id, { songIndexToRemove: [index] });
    } catch (e) { toast(e.message, 'error'); return; }
    load();
    loadPlaylists();
  };

  const del = async () => {
    await api.deletePlaylist(id).catch((e) => toast(e.message, 'error'));
    loadPlaylists();
    toast('Плейлист удалён', 'success');
    nav('/library?tab=playlists');
  };

  const openMenu = (e) => {
    e.preventDefault();
    setUI({ contextMenu: { x: e.clientX, y: e.clientY, items: [
      mine && { label: 'Переименовать', onClick: () => setEditing(true) },
      {
        label: pinned ? 'Открепить' : 'Закрепить вверху медиатеки',
        icon: pinned ? <PinFillIc size={14} /> : <PinIc size={14} />,
        onClick: () => togglePin('playlist', id, playlist.name),
      },
      { label: 'Добавить в очередь', onClick: () => addToQueue(songs) },
      { label: 'Добавить треки в другой плейлист', icon: <Plus size={14} />, onClick: () => setUI({ addToOpen: { ids: songs.map((x) => x.id), title: `${playlist.name} — ${songs.length} трек(ов)` } }) },
      { label: 'Скачать все треки', onClick: () => downloadMany(songs) },
      mine && { sep: true },
      mine && { label: 'Удалить плейлист', danger: true, onClick: del },
      !mine && { label: 'Чужой плейлист — правка недоступна', header: true },
    ] } });
  };

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <Cover id={playlist.coverArt || playlist.id} size={600} alt={playlist.name} className="hero-art" />
        <div style={{ minWidth: 0 }}>
          <div className="hero-kind">
            {mine ? (playlist.public ? 'Мой публичный плейлист' : 'Мой плейлист') : 'Общий плейлист'}
            {!mine && <span className="shared-tag">только чтение</span>}
            {pinned && <span className="shared-tag" style={{ background: 'rgba(29,185,84,.18)', color: '#7ee2a8' }}>закреплён</span>}
          </div>
          {editing ? (
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={rename}
              onKeyDown={(e) => e.key === 'Enter' && rename()}
              style={{ fontSize: 48, fontWeight: 900, background: 'rgba(255,255,255,.1)', border: 0, color: '#fff', borderRadius: 6, padding: '4px 12px', margin: '8px 0 16px', width: '100%' }}
            />
          ) : (
            <h1 className="hero-title" onDoubleClick={() => mine && setEditing(true)}>{playlist.name}</h1>
          )}
          {playlist.comment && <div className="muted" style={{ marginBottom: 10 }}>{playlist.comment}</div>}
          <div className="hero-sub">
            <b>{playlist.owner}</b>
            <span className="dot">•</span><span className="muted">{songsWord(songs.length)}</span>
            <span className="dot">•</span><span className="muted">{fmtLong(playlist.duration)}</span>
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button className="play-fab" onClick={() => (isHere ? togglePlay() : playQueue(songs, 0, { type: 'playlist', name: playlist.name }))}>
          {isHere && playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className={`ghost-btn${shuffle ? ' on' : ''}`} onClick={toggleShuffle} title="Перемешать"><Shuffle size={26} /></button>
        <button className="ghost-btn" onClick={() => downloadMany(songs)} title="Скачать"><Download size={24} /></button>
        <button
          className={`ghost-btn${pinned ? ' pinned' : ''}`}
          onClick={() => togglePin('playlist', id, playlist.name)}
          title={pinned ? 'Открепить из медиатеки' : 'Закрепить вверху медиатеки'}
        >
          {pinned ? <PinFillIc size={24} /> : <PinIc size={24} />}
        </button>
        <button className="ghost-btn" onClick={openMenu}><DotsH size={24} /></button>
      </div>

      <div className="page">
        <TrackList
          tracks={songs}
          context={{ type: 'playlist', name: playlist.name }}
          onRemove={mine ? remove : undefined}
        />
      </div>
    </div>
  );
}
