import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import { useCoverSrc } from '../lib/covers';
import useStore from '../state/store';
import ArtistLinks, { useArtistMenuItems } from '../components/ArtistLinks';
import TrackList from '../components/TrackList';
import { Cover, Spinner, Card, Section } from '../components/UI';
import { Play, Pause, Heart, HeartFill, DotsH, Download, Plus } from '../components/Icons';
import { useDominantColor, fmtLong, songsWord } from '../lib/util';

export default function Album() {
  const { id } = useParams();
  const nav = useNavigate();
  const artistItems = useArtistMenuItems();
  const playQueue = useStore((s) => s.playQueue);
  const current = useStore((s) => s.current);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const toggleStar = useStore((s) => s.toggleStar);
  const starredIds = useStore((s) => s.starredIds);
  const setUI = useStore((s) => s.setUI);
  const addToQueue = useStore((s) => s.addToQueue);
  const downloadMany = useStore((s) => s.downloadMany);
  const toast = useStore((s) => s.toast);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState([]);

  const coverSrc = useCoverSrc(data ? (data.album.coverArt || data.album.id) : null, 400);
  const hero = useDominantColor(coverSrc, '#3a3a3a');

  useEffect(() => { setUI({ heroColor: hero }); }, [hero, setUI]);

  const load = () => api.getAlbum(id).then(async (d) => {
    if (!d?.album) throw new Error('Альбом не найден');
    return d;
  });

  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    load().then(async (d) => {
      if (!alive) return;
      setError('');
      setData(d);
      setUI({ pageTitle: d.album.name });
      if (d.album.artistId) {
        const a = await api.getArtist(d.album.artistId).catch(() => null);
        if (alive && a) setMore(a.albums.filter((x) => x.id !== id).slice(0, 8));
      }
    }).catch((e) => {
      const msg = e.message || 'Не удалось загрузить альбом';
      toast(msg, 'error');
      if (alive) setError(msg);
    });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line

  useEffect(() => {
    if (!data) return;
    setUI({ pagePlay: () => useStore.getState().playQueue(data.songs, 0, { type: 'album', name: data.album.name }) });
  }, [data, setUI]);

  if (error && !data) {
    return (
      <div className="page page-pad-top">
        <div className="center-empty">
          <div>{error}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="pill-btn" onClick={() => { setData(null); load().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)); }}>Повторить</button>
            <button className="btn-ghost" onClick={() => nav(-1)}>Назад</button>
          </div>
        </div>
      </div>
    );
  }
  if (!data) return <Spinner />;
  const { album, songs } = data;
  const isCurAlbum = current() && songs.some((s) => s.id === current().id);
  const isStar = starredIds.album.has(album.id);
  const total = songs.reduce((s, x) => s + (x.duration || 0), 0);

  const openMenu = (e) => {
    e.preventDefault();
    setUI({ contextMenu: { x: e.clientX, y: e.clientY, items: [
      { label: 'Добавить в очередь', onClick: () => addToQueue(songs) },
      { label: 'Играть следующим', onClick: () => addToQueue(songs, true) },
      {
        label: 'Добавить альбом в плейлист…',
        icon: <Plus size={14} />,
        onClick: () => setUI({ addToOpen: { ids: songs.map((x) => x.id), title: `${album.name} — ${songs.length} трек(ов)` } }),
      },
      { sep: true },
      { label: isStar ? 'Удалить из любимых' : 'В любимые альбомы', onClick: () => toggleStar(album, 'album') },
      { label: 'Скачать все треки', onClick: () => downloadMany(songs) },
      { sep: true },
      ...artistItems(album),
    ] } });
  };

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <Cover id={album.coverArt || album.id} size={600} alt={album.name} className="hero-art" />
        <div style={{ minWidth: 0 }}>
          <div className="hero-kind">Альбом</div>
          <h1 className="hero-title">{album.name}</h1>
          <div className="hero-sub">
            <ArtistLinks as="b" item={album} className="hero-artists" />
            {album.year && <><span className="dot">•</span><span className="muted">{album.year}</span></>}
            <span className="dot">•</span><span className="muted">{songsWord(songs.length)}</span>
            <span className="dot">•</span><span className="muted">{fmtLong(total)}</span>
            {album.genre && <><span className="dot">•</span><span className="muted">{album.genre}</span></>}
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button className="play-fab" onClick={() => (isCurAlbum ? togglePlay() : playQueue(songs, 0, { type: 'album', name: album.name }))}>
          {isCurAlbum && playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className={`ghost-btn${isStar ? ' on' : ''}`} onClick={() => toggleStar(album, 'album')} title="В любимые">
          {isStar ? <HeartFill size={30} /> : <Heart size={30} />}
        </button>
        <button className="ghost-btn" onClick={() => downloadMany(songs)} title="Скачать альбом"><Download size={24} /></button>
        <button className="ghost-btn" onClick={openMenu} title="Ещё"><DotsH size={24} /></button>
      </div>

      <div className="page">
        <TrackList tracks={songs} context={{ type: 'album', name: album.name }} showAlbum={false} showCover={false} />
        <div className="muted" style={{ marginTop: 24, fontSize: 12 }}>
          {album.year ? `© ${album.year} ` : ''}{album.artist}
        </div>

        {!!more.length && (
          <Section title={`Ещё от ${album.artist}`}>
            <div className="grid">{more.map((a) => <Card key={a.id} item={a} />)}</div>
          </Section>
        )}
      </div>
    </div>
  );
}
