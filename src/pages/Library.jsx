import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import useStore from '../state/store';
import { Card, Skeletons } from '../components/UI';

const TABS = [
  { id: 'albums', label: 'Альбомы' },
  { id: 'artists', label: 'Исполнители' },
  { id: 'playlists', label: 'Мои плейлисты' },
  { id: 'shared', label: 'Общие плейлисты' },
];

const SORTS = [
  { id: 'newest', label: 'Недавние' },
  { id: 'alphabeticalByName', label: 'По алфавиту' },
  { id: 'frequent', label: 'Популярные' },
  { id: 'starred', label: 'Любимые' },
  { id: 'random', label: 'Случайные' },
];

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'albums';
  const [sort, setSort] = useState('newest');
  const playlists = useStore((s) => s.playlists);
  const loadPlaylists = useStore((s) => s.loadPlaylists);
  const playQueue = useStore((s) => s.playQueue);
  const setUI = useStore((s) => s.setUI);
  const splitPlaylists = useStore((s) => s.splitPlaylists);
  const { mine, shared } = splitPlaylists(playlists);
  const [albums, setAlbums] = useState(null);
  const [artists, setArtists] = useState(null);

  useEffect(() => { setUI({ heroColor: '#121212', pageTitle: 'Моя медиатека' }); loadPlaylists(); }, []); // eslint-disable-line

  useEffect(() => {
    if (tab !== 'albums') return;
    setAlbums(null);
    api.albumList(sort, 100).then(setAlbums).catch(() => setAlbums([]));
  }, [tab, sort]);

  useEffect(() => {
    if (tab !== 'artists' || artists) return;
    api.getArtists().then(setArtists).catch(() => setArtists([]));
  }, [tab]); // eslint-disable-line

  const playAlbum = async (album) => {
    const { songs } = await api.getAlbum(album.id);
    playQueue(songs, 0, { type: 'album', name: album.name });
  };

  return (
    <div className="page page-pad-top">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 20px', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {TABS.map((t) => (
            <button key={t.id} className={`chip${tab === t.id ? ' active' : ''}`} style={{ padding: '8px 16px', fontSize: 14 }}
              onClick={() => setParams({ tab: t.id })}>{t.label}</button>
          ))}
        </div>
        {tab === 'albums' && (
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>

      {tab === 'albums' && (albums ? (
        <div className="grid">{albums.map((a) => <Card key={a.id} item={a} onPlay={playAlbum} />)}</div>
      ) : <Skeletons n={12} />)}

      {tab === 'artists' && (artists ? (
        <div className="grid">{artists.map((a) => <Card key={a.id} item={a} kind="artist" />)}</div>
      ) : <Skeletons n={12} />)}

      {tab === 'playlists' && (mine.length ? (
        <div className="grid">{mine.map((p) => <Card key={p.id} item={p} kind="playlist" />)}</div>
      ) : (
        <div className="muted">Своих плейлистов пока нет — создайте первый через «+» в боковой панели.</div>
      ))}

      {tab === 'shared' && (shared.length ? (
        <>
          <div className="muted" style={{ margin: '-8px 0 16px', fontSize: 13 }}>
            Плейлисты других пользователей сервера — их можно слушать, но не редактировать.
          </div>
          <div className="grid">
            {shared.map((p) => (
              <Card key={p.id} item={p} kind="playlist" sub={`${p.owner} • ${p.songCount || 0} треков`} />
            ))}
          </div>
        </>
      ) : (
        <div className="muted">Никто не поделился с вами плейлистами.</div>
      ))}
    </div>
  );
}
