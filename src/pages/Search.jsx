import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import useStore from '../state/store';
import TrackList from '../components/TrackList';
import { Card, Cover, Section, Skeletons } from '../components/UI';
import { Play, Pause, Clock, Close, Trash, Search as SearchIc } from '../components/Icons';
import { timeAgo, HISTORY_MAX } from '../lib/searchHistory';
import { songsWord } from '../lib/util';

/* Треков на страницу. Число не случайное: с 60 строк TrackList уходит в
   виртуальный режим. Если брать меньше, список сначала живет обычным, а на
   второй странице перестраивается в виртуальный — прокрутка при этом
   прыгает. Первая порция сразу больше порога — режим не меняется. */
const SONG_PAGE = 60;

const GENRE_COLORS = ['#e13300', '#8400e7', '#1e3264', '#e8115b', '#148a08', '#ff4632', '#509bf5', '#af2896', '#056952', '#d84000', '#7358ff', '#0d73ec'];

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const nav = useNavigate();
  const playQueue = useStore((s) => s.playQueue);
  const current = useStore((s) => s.current);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const setUI = useStore((s) => s.setUI);
  const searchHistory = useStore((s) => s.searchHistory);
  const pushSearchHistory = useStore((s) => s.pushSearchHistory);
  const removeSearchHistory = useStore((s) => s.removeSearchHistory);
  const clearSearchHistory = useStore((s) => s.clearSearchHistory);
  const [res, setRes] = useState(null);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(false);
  /* Поиск отдаёт треки порциями: первая приходит вместе с альбомами и
     исполнителями, остальные догружаем, когда доскроллили до конца списка. */
  const [songs, setSongs] = useState([]);
  const [songMore, setSongMore] = useState(false);
  const [songLoading, setSongLoading] = useState(false);


  useEffect(() => { setUI({ heroColor: '#121212', pageTitle: 'Поиск' }); }, [setUI]);
  useEffect(() => { api.getGenres().then(setGenres).catch(() => {}); }, []);

  useEffect(() => {
    if (!q.trim()) { setRes(null); setSongs([]); setSongMore(false); return; }
    let alive = true;
    setLoading(true);
    api.search(q, { songCount: SONG_PAGE })
      .then((r) => {
        if (!alive) return;
        setRes(r);
        setSongs(r.songs);
        setSongMore(r.songs.length >= SONG_PAGE);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { alive = false; };
  }, [q]); // eslint-disable-line

  const loadMoreSongs = useCallback(async () => {
    if (songLoading || !songMore || !q.trim()) return;
    setSongLoading(true);
    try {
      const r = await api.search(q, { songOffset: songs.length, songCount: SONG_PAGE });
      const seen = new Set(songs.map((x) => String(x.id)));
      const fresh = (r.songs || []).filter((x) => !seen.has(String(x.id)));
      if (fresh.length) setSongs((prev) => [...prev, ...fresh]);
      if ((r.songs || []).length < SONG_PAGE) setSongMore(false);
    } catch { setSongMore(false); }
    setSongLoading(false);
  }, [q, songs, songMore, songLoading]);

  const best = useMemo(() => {
    if (!res) return null;
    const s = q.toLowerCase();
    const exactArtist = res.artists.find((a) => a.name.toLowerCase() === s);
    const exactAlbum = res.albums.find((a) => a.name.toLowerCase() === s);
    if (exactArtist) return { kind: 'artist', item: exactArtist };
    if (exactAlbum) return { kind: 'album', item: exactAlbum };
    if (res.artists[0]) return { kind: 'artist', item: res.artists[0] };
    if (res.albums[0]) return { kind: 'album', item: res.albums[0] };
    if (songs[0]) return { kind: 'song', item: songs[0] };
    return null;
  }, [res, songs, q]);

  /* пустой ввод: недавние запросы + подборка по жанрам */
  if (!q.trim()) {
    return (
      <div className="page page-pad-top">
        {!!searchHistory.length && (
          <div className="hist-block">
            <div className="hist-head">
              <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Недавние поиски</h2>
              <button className="hist-clear" onClick={clearSearchHistory} title="Удалить все сохранённые запросы">
                <Trash size={12} /> Очистить
              </button>
            </div>
            <div className="hist-chips">
              {searchHistory.map((it) => (
                <span className="hist-chip" key={it.q}>
                  <button
                    onClick={() => { pushSearchHistory(it.q); nav(`/search?q=${encodeURIComponent(it.q)}`); }}
                    title={`Искать «${it.q}»`}
                  >
                    <Clock size={12} />
                    <span>{it.q}</span>
                    <em>{timeAgo(it.at)}</em>
                  </button>
                  <button className="hist-chip-x" title="Убрать из истории" onClick={() => removeSearchHistory(it.q)}>
                    <Close size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="hist-hint">
              Помним последние {HISTORY_MAX} запросов: крестик убирает по одному, автозапоминание
              отключается в настройках.
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 24, fontWeight: 800, margin: '8px 0 16px' }}>Поиск по жанрам</h2>
        <div className="grid wide">
          {genres.map((g, i) => (
            <button
              key={g.value}
              onClick={() => nav(`/genre/${encodeURIComponent(g.value)}`)}
              style={{
                background: GENRE_COLORS[i % GENRE_COLORS.length], borderRadius: 8, height: 160,
                position: 'relative', overflow: 'hidden', textAlign: 'left', padding: 16,
                fontSize: 20, fontWeight: 800, letterSpacing: '-.02em',
              }}
            >
              {g.value}
              <span style={{
                position: 'absolute', right: -14, bottom: -6, width: 82, height: 82, borderRadius: 6,
                background: 'rgba(0,0,0,.35)', transform: 'rotate(25deg)',
              }} />
              <span style={{ position: 'absolute', left: 16, bottom: 12, fontSize: 12, fontWeight: 600, opacity: .8 }}>
                {g.songCount} треков
              </span>
            </button>
          ))}
        </div>
        {!genres.length && (
          <div className="muted" style={{ marginTop: 24, display: 'flex', gap: 8, alignItems: 'center' }}>
            <SearchIc size={15} /> Начните вводить запрос выше — он появится здесь в истории.
          </div>
        )}
      </div>
    );
  }

  if (loading || !res) return <div className="page page-pad-top"><Skeletons n={8} /></div>;

  const nothing = !res.artists.length && !res.albums.length && !res.songs.length;
  if (nothing) {
    return (
      <div className="center-empty">
        <div style={{ fontSize: 22, fontWeight: 800 }}>Ничего не найдено по запросу «{q}»</div>
        <div>Проверьте, нет ли ошибок в написании.</div>
      </div>
    );
  }

  const playSong = (song) => playQueue(res.songs, res.songs.findIndex((s) => s.id === song.id), { type: 'search', name: `Поиск: ${q}` });

  return (
    <div className="page page-pad-top">
      <div style={{ display: 'grid', gridTemplateColumns: best ? '1fr 1.6fr' : '1fr', gap: 24, alignItems: 'start' }}>
        {best && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 16px' }}>Лучший результат</h2>
            <div
              className="card"
              style={{ background: 'var(--panel-2)', padding: 20 }}
              onClick={() => best.kind === 'song' ? playSong(best.item) : nav(`/${best.kind}/${best.item.id}`)}
            >
              <div className="art-wrap" style={{ width: 92 }}>
                <Cover
                  id={best.item.coverArt || best.item.albumId || best.item.id}
                  size={200}
                  alt={best.item.name || best.item.title}
                  className={`art${best.kind === 'artist' ? ' round' : ''}`}
                />
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-.03em', marginTop: 4 }}>
                {best.item.name || best.item.title}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {best.kind === 'artist' ? 'Исполнитель' : best.kind === 'album' ? `Альбом • ${best.item.artist}` : `Трек • ${best.item.artist}`}
              </div>
            </div>
          </div>
        )}

        {!!songs.length && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 16px' }}>Треки</h2>
            <TrackList tracks={songs.slice(0, 6)} context={{ type: 'search', name: `Поиск: ${q}` }} showHeader={false} showAlbum={false} numbered={false} />
          </div>
        )}
      </div>

      {!!res.albums.length && (
        <Section title="Альбомы"><div className="grid">{res.albums.slice(0, 8).map((a) => <Card key={a.id} item={a} />)}</div></Section>
      )}
      {!!res.artists.length && (
        <Section title="Исполнители"><div className="grid">{res.artists.slice(0, 8).map((a) => <Card key={a.id} item={a} kind="artist" />)}</div></Section>
      )}
      {songs.length > 6 && (
        <Section title="Все найденные треки">
          <TrackList tracks={songs} context={{ type: 'search', name: `Поиск: ${q}` }} onReachEnd={loadMoreSongs} />
          {songLoading && <div className="paged-more muted">Загружаю ещё…</div>}
          {!songMore && !songLoading && <div className="paged-end muted">{songsWord(songs.length)} — это все</div>}
        </Section>
      )}
    </div>
  );
}
