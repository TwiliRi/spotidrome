import React, { useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import useStore from '../state/store';
import TrackList from '../components/TrackList';
import { Spinner } from '../components/UI';
import usePagedList from '../lib/usePagedList';
import { Play } from '../components/Icons';
import { songsWord } from '../lib/util';

/* Треков на страницу: 60 — порог, с которого TrackList включает виртуальный
   список. Берём сразу столько, чтобы режим не переключался на второй
   странице (переключение сбрасывает прокрутку наверх). */
const PAGE = 60;

/** адрес может прийти «сырым» (из поиска, из ссылки с %); падать из-за этого нельзя */
const safeDecode = (v) => { try { return decodeURIComponent(String(v || '').replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { return String(v || ''); } };

export default function Genre() {
  const { name } = useParams();
  const genre = safeDecode(name);
  const playQueue = useStore((s) => s.playQueue);
  const setUI = useStore((s) => s.setUI);
  const hero = '#1e3264';

  useEffect(() => { setUI({ heroColor: hero, pageTitle: genre }); }, [genre, setUI]);

  /* В жанре могут быть сотни треков — тянем страницами, а не одной порцией. */
  const fetchSongs = useCallback((offset, size) => api.getSongsByGenre(genre, size, offset), [genre]);
  const { items: songs, loading, done, loadMore, reload, error } = usePagedList({
    fetchPage: fetchSongs, key: `genre:${genre}`, size: PAGE,
  });

  if (!songs.length && loading) return <Spinner />;

  return (
    <div>
      <div className="hero" style={{ '--hero': hero, minHeight: 220, alignItems: 'flex-end' }}>
        <div>
          <div className="hero-kind">Жанр</div>
          <h1 className="hero-title sm">{genre}</h1>
          <div className="hero-sub"><span className="muted">{songsWord(songs.length)}</span></div>
        </div>
      </div>
      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button className="play-fab" onClick={() => playQueue(songs, 0, { type: 'genre', name: genre })}><Play size={22} /></button>
      </div>
      <div className="page">
        <TrackList tracks={songs} context={{ type: 'genre', name: genre }} onReachEnd={loadMore} />
        {loading && !!songs.length && <div className="paged-more muted">Загружаю ещё…</div>}
        {error && (
          <div className="paged-more muted">
            Не получилось догрузить. <button className="pill-btn" onClick={reload}>Повторить</button>
          </div>
        )}
        {done && !!songs.length && <div className="paged-end muted">{songsWord(songs.length)} — это все</div>}
      </div>
    </div>
  );
}
