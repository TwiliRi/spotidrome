import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import useStore from '../state/store';
import { Card, Skeletons } from '../components/UI';
import usePlaylistDnd from '../lib/usePlaylistDnd';
import usePagedList from '../lib/usePagedList';
import { albumsWord } from '../lib/util';

const TABS = [
  { id: 'albums', label: 'Альбомы' },
  { id: 'artists', label: 'Исполнители' },
  { id: 'playlists', label: 'Мои плейлисты' },
  { id: 'shared', label: 'Общие плейлисты' },
];

const PAGE = 36;                 // по странице: сетка успевает заполнить экран

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
  const orderPlaylists = useStore((s) => s.orderPlaylists);
  const playlistOrder = useStore((s) => s.settings.playlistOrder);
  // порядок, расставленный перетаскиванием в медиатеке, действует и здесь
  const ordered = useMemo(() => {
    const { mine, shared } = splitPlaylists(playlists);
    return { mine: orderPlaylists(mine), shared: orderPlaylists(shared) };
  }, [playlists, playlistOrder, splitPlaylists, orderPlaylists]);
  const { mine, shared } = ordered;
  const [artists, setArtists] = useState(null);
  // в сетке плейлисты переставляются мышью так же, как в медиатеке слева
  const dnd = usePlaylistDnd({ axis: 'x' });

  useEffect(() => { setUI({ heroColor: '#121212', pageTitle: 'Моя медиатека' }); loadPlaylists(); }, []); // eslint-disable-line

  /* Альбомы тянем страницами: одной порции в 100 штук на большую фонотеку
     не хватало, и «Недавние» показывали только начало. Сторож внизу сетки
     сам догружает следующую страницу, когда доходят до края. */
  const fetchAlbums = useCallback((offset, size) => api.albumList(sort, size, offset), [sort]);
  const albums = usePagedList({
    fetchPage: fetchAlbums,
    key: `albums:${sort}`,
    size: PAGE,
    enabled: tab === 'albums',
  });

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

      {tab === 'albums' && (
        <>
          {!!albums.items.length && (
            <div className="grid">{albums.items.map((a) => <Card key={a.id} item={a} onPlay={playAlbum} />)}</div>
          )}
          {albums.loading && <Skeletons n={albums.items.length ? 6 : 12} />}
          {/* сторож: до него доскроллили — подгружаем следующую страницу */}
          <div ref={albums.sentinelRef} className="paged-sentinel" aria-hidden="true" />
          {albums.error && !albums.items.length && (
            <div className="muted">
              Не получилось загрузить альбомы.{' '}
              <button className="pill-btn" onClick={albums.reload}>Повторить</button>
            </div>
          )}
          {!albums.loading && !albums.items.length && !albums.error && (
            <div className="muted">В этой фонотеке альбомов пока нет.</div>
          )}
          {albums.done && !!albums.items.length && (
            <div className="paged-end muted">{albumsWord(albums.items.length)} — это все</div>
          )}
        </>
      )}

      {tab === 'artists' && (artists ? (
        <div className="grid">{artists.map((a) => <Card key={a.id} item={a} kind="artist" />)}</div>
      ) : <Skeletons n={12} />)}

      {tab === 'playlists' && (mine.length ? (
        <div className={`grid${dnd.drag ? ' dnd-on' : ''}`}>
          {mine.map((p) => (
            <Card
              key={p.id}
              item={p}
              kind="playlist"
              drag={dnd.dndProps({ id: p.id, kind: 'playlist', group: 'playlists' })}
              dropClass={dnd.dndClass({ id: p.id, kind: 'playlist', group: 'playlists' })}
            />
          ))}
        </div>
      ) : (
        <div className="muted">Своих плейлистов пока нет — создайте первый через «+» в боковой панели.</div>
      ))}

      {tab === 'shared' && (shared.length ? (
        <>
          <div className="muted" style={{ margin: '-8px 0 16px', fontSize: 13 }}>
            Плейлисты других пользователей сервера — их можно слушать, но не редактировать.
          </div>
          <div className={`grid${dnd.drag ? ' dnd-on' : ''}`}>
            {shared.map((p) => (
              <Card
                key={p.id}
                item={p}
                kind="playlist"
                sub={`${p.owner} • ${p.songCount || 0} треков`}
                drag={dnd.dndProps({ id: p.id, kind: 'playlist', group: 'shared' })}
                dropClass={dnd.dndClass({ id: p.id, kind: 'playlist', group: 'shared' })}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="muted">Никто не поделился с вами плейлистами.</div>
      ))}
    </div>
  );
}
