import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import useStore from '../state/store';
import TrackList from '../components/TrackList';
import { Spinner } from '../components/UI';
import { Play, Pause, HeartFill, Shuffle } from '../components/Icons';
import { fmtLong, songsWord } from '../lib/util';

export default function Liked() {
  const playQueue = useStore((s) => s.playQueue);
  const current = useStore((s) => s.current);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const setUI = useStore((s) => s.setUI);
  const credentials = useStore((s) => s.credentials);
  const shuffle = useStore((s) => s.shuffle);
  const toggleShuffle = useStore((s) => s.toggleShuffle);
  const setStarMany = useStore((s) => s.setStarMany);
  const [songs, setSongs] = useState(null);
  const hero = '#5038a0';
  useEffect(() => { setUI({ heroColor: hero, pageTitle: 'Любимые треки' }); }, [setUI]);

  useEffect(() => {
    api.getStarred().then((s) => setSongs(s.songs)).catch(() => setSongs([]));
  }, []);

  useEffect(() => {
    if (!songs?.length) return;
    setUI({ pagePlay: () => useStore.getState().playQueue(songs, 0, { type: 'liked', name: 'Любимые треки' }) });
  }, [songs, setUI]);

  /** Пачкой снимаем сердечки: выделенные строки уходят из списка сразу. */
  const removeMany = async (list) => {
    const ids = new Set(list.map((t) => t.id));
    const done = await setStarMany(list, false);
    if (done) setSongs((prev) => (prev || []).filter((s) => !ids.has(s.id)));
  };

  if (!songs) return <Spinner />;
  const isHere = current() && songs.some((s) => s.id === current().id);
  const total = songs.reduce((s, x) => s + (x.duration || 0), 0);

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <div className="hero-art" style={{ background: 'linear-gradient(135deg,#450af5,#c4efd9)', display: 'grid', placeItems: 'center' }}>
          <HeartFill size={88} />
        </div>
        <div>
          <div className="hero-kind">Плейлист</div>
          <h1 className="hero-title">Любимые треки</h1>
          <div className="hero-sub">
            <b>{credentials?.username}</b>
            <span className="dot">•</span><span className="muted">{songsWord(songs.length)}</span>
            {!!total && <><span className="dot">•</span><span className="muted">{fmtLong(total)}</span></>}
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button className="play-fab" onClick={() => (isHere ? togglePlay() : playQueue(songs, 0, { type: 'liked', name: 'Любимые треки' }))}>
          {isHere && playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className={`ghost-btn${shuffle ? ' on' : ''}`} onClick={toggleShuffle}><Shuffle size={26} /></button>
      </div>

      <div className="page">
        {songs.length ? (
          <TrackList
            tracks={songs}
            context={{ type: 'liked', name: 'Любимые треки' }}
            onRemoveMany={removeMany}
            removeLabel="Убрать из любимых"
          />
        ) : (
          <div className="center-empty">
            <HeartFill size={40} />
            <div>Треки, отмеченные сердечком, появятся здесь</div>
          </div>
        )}
      </div>
    </div>
  );
}
