import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import { useCoverSrc } from '../lib/covers';
import useStore from '../state/store';
import TrackList from '../components/TrackList';
import { Cover, Spinner, Card, Section } from '../components/UI';
import { Play, Pause, Heart, HeartFill, DotsH } from '../components/Icons';
import { useDominantColor, albumsWord, stripHtml } from '../lib/util';
import { rememberArtist } from '../lib/artists';

export default function Artist() {
  const { id } = useParams();
  const nav = useNavigate();
  const playQueue = useStore((s) => s.playQueue);
  const current = useStore((s) => s.current);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const toggleStar = useStore((s) => s.toggleStar);
  const starredIds = useStore((s) => s.starredIds);
  const setUI = useStore((s) => s.setUI);
  const addToQueue = useStore((s) => s.addToQueue);
  const startRadio = useStore((s) => s.startRadio);
  const [data, setData] = useState(null);
  const [top, setTop] = useState([]);
  const [info, setInfo] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const coverSrc = useCoverSrc(data ? (data.artist.coverArt || data.artist.id) : null, 400);
  const hero = useDominantColor(coverSrc, '#3f3f3f');
  useEffect(() => { setUI({ heroColor: hero }); }, [hero, setUI]);

  useEffect(() => {
    let alive = true;
    setData(null); setTop([]); setInfo(null);
    api.getArtist(id).then(async (d) => {
      if (!alive) return;
      setData(d);
      rememberArtist(d.artist.name, d.artist.id);   // подсказка для разбора подписей
      setUI({ pageTitle: d.artist.name });
      const [t, i] = await Promise.all([
        api.getTopSongs(d.artist.name, 10).catch(() => []),
        api.getArtistInfo(id).catch(() => null),
      ]);
      if (!alive) return;
      setTop(t);
      setInfo(i);
      if (!t.length && d.albums.length) {
        const first = await api.getAlbum(d.albums[0].id).catch(() => null);
        if (alive && first) setTop(first.songs.slice(0, 5));
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [id]); // eslint-disable-line

  useEffect(() => {
    if (!data || !top.length) return;
    setUI({ pagePlay: () => useStore.getState().playQueue(top, 0, { type: 'artist', name: data.artist.name }) });
  }, [data, top, setUI]);

  if (!data) return <Spinner />;
  const { artist, albums } = data;
  const isStar = starredIds.artist.has(artist.id);
  const curIsHere = current()?.artistId === artist.id;

  const playAll = async () => {
    if (top.length) return playQueue(top, 0, { type: 'artist', name: artist.name });
    if (albums.length) {
      const { songs } = await api.getAlbum(albums[0].id);
      playQueue(songs, 0, { type: 'artist', name: artist.name });
    }
  };

  // сервер отдаёт биографию HTML'ом из Last.fm — показываем только текст: теги режем,
  // ссылки оставляем словами (вставлять чужую разметку в DOM небезопасно)
  const bio = info?.biography ? stripHtml(info.biography) : '';
  const sorted = [...albums].sort((a, b) => (b.year || 0) - (a.year || 0));
  const similar = (info?.similarArtist ? (Array.isArray(info.similarArtist) ? info.similarArtist : [info.similarArtist]) : [])
    .filter((a) => a.id);

  return (
    <div>
      <div className="hero" style={{ '--hero': hero, minHeight: 340 }}>
        <Cover id={artist.coverArt || artist.id} size={600} alt={artist.name} className="hero-art round" />
        <div style={{ minWidth: 0 }}>
          <div className="hero-kind">Исполнитель</div>
          <h1 className="hero-title">{artist.name}</h1>
          <div className="hero-sub">
            <span className="muted">{albumsWord(albums.length)}</span>
            {artist.genre && <><span className="dot">•</span><span className="muted">{artist.genre}</span></>}
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button className="play-fab" onClick={() => (curIsHere && playing ? togglePlay() : playAll())}>
          {curIsHere && playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className={`ghost-btn${isStar ? ' on' : ''}`} onClick={() => toggleStar(artist, 'artist')}>
          {isStar ? <HeartFill size={30} /> : <Heart size={30} />}
        </button>
        <button className="pill-btn" onClick={() => addToQueue(top)}>В очередь</button>
        <button
          className="pill-btn"
          title="Играть радио на основе этого исполнителя"
          onClick={() => top.length && startRadio(top[0], 'artist', artist?.name || '')}
        >
          Радио
        </button>
      </div>

      <div className="page">
        {!!top.length && (
          <Section title="Популярные треки">
            <TrackList
              tracks={showAll ? top : top.slice(0, 5)}
              context={{ type: 'artist', name: artist.name }}
              showAlbum={false}
              showHeader={false}
            />
            {top.length > 5 && (
              <button className="more" style={{ marginTop: 8, fontWeight: 700, color: 'var(--text-sub)' }} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Свернуть' : 'Показать больше'}
              </button>
            )}
          </Section>
        )}

        {!!sorted.length && (
          <Section title="Дискография">
            <div className="grid">{sorted.map((a) => <Card key={a.id} item={a} />)}</div>
          </Section>
        )}

        {!!similar.length && (
          <Section title="Похожие исполнители">
            <div className="grid">{similar.slice(0, 8).map((a) => <Card key={a.id} item={a} kind="artist" />)}</div>
          </Section>
        )}

        {bio && (
          <Section title="Об исполнителе">
            <p className="muted" style={{ maxWidth: 760, lineHeight: 1.8, whiteSpace: 'pre-line' }}>{bio}</p>
          </Section>
        )}
      </div>
    </div>
  );
}
