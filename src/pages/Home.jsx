import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import useStore from '../state/store';
import { Card, Cover, Section, Skeletons } from '../components/UI';
import { Play } from '../components/Icons';
import { greeting } from '../lib/util';

export default function Home() {
  const nav = useNavigate();
  const playQueue = useStore((s) => s.playQueue);
  const playlists = useStore((s) => s.playlists);
  const [data, setData] = useState({ recent: [], newest: [], frequent: [], random: [], artists: [], starred: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [recent, newest, frequent, random, artists, starred] = await Promise.all([
        api.albumList('recent', 12).catch(() => []),
        api.albumList('newest', 12).catch(() => []),
        api.albumList('frequent', 12).catch(() => []),
        api.albumList('random', 12).catch(() => []),
        api.getArtists().then((a) => a.slice(0, 12)).catch(() => []),
        api.getStarred().then((s) => s.albums.slice(0, 12)).catch(() => []),
      ]);
      if (!alive) return;
      setData({ recent, newest, frequent, random, artists, starred });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const playAlbum = async (album) => {
    const { songs } = await api.getAlbum(album.id);
    playQueue(songs, 0, { type: 'album', name: album.name });
  };

  const quick = Array.from(
    new Map(
      [...(data.recent.length ? data.recent : data.newest), ...data.starred].map((a) => [a.id, a])
    ).values()
  ).slice(0, 6);

  return (
    <div className="page page-pad-top">
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.03em', margin: '8px 0 20px' }}>{greeting()}</h1>

      {loading ? <Skeletons n={6} /> : (
        <>
          <div className="tiles">
            {quick.map((a) => (
              <div className="tile" key={a.id} onClick={() => nav(`/album/${a.id}`)} role="button">
                <Cover id={a.coverArt || a.id} size={120} alt={a.name} />
                <div className="t">{a.name}</div>
                <button className="mini-play" onClick={(e) => { e.stopPropagation(); playAlbum(a); }}><Play size={16} /></button>
              </div>
            ))}
          </div>

          {!!data.newest.length && (
            <Section title="Недавно добавленное" more="Показать все" onMore={() => nav('/library?tab=albums')}>
              <div className="grid">{data.newest.slice(0, 8).map((a) => <Card key={a.id} item={a} onPlay={playAlbum} />)}</div>
            </Section>
          )}

          {!!data.frequent.length && (
            <Section title="Вы часто слушаете">
              <div className="grid">{data.frequent.slice(0, 8).map((a) => <Card key={a.id} item={a} onPlay={playAlbum} />)}</div>
            </Section>
          )}

          {!!playlists.length && (
            <Section title="Ваши плейлисты" more="Все" onMore={() => nav('/library?tab=playlists')}>
              <div className="grid">{playlists.slice(0, 8).map((p) => <Card key={p.id} item={p} kind="playlist" />)}</div>
            </Section>
          )}

          {!!data.artists.length && (
            <Section title="Исполнители в медиатеке" more="Все" onMore={() => nav('/library?tab=artists')}>
              <div className="grid">{data.artists.slice(0, 8).map((a) => <Card key={a.id} item={a} kind="artist" />)}</div>
            </Section>
          )}

          {!!data.random.length && (
            <Section title="Загляните снова">
              <div className="grid">{data.random.slice(0, 8).map((a) => <Card key={a.id} item={a} onPlay={playAlbum} />)}</div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
