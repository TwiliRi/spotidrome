import React, { useEffect, useMemo } from 'react';
import useStore from '../state/store';
import TrackList from '../components/TrackList';
import { Play, Download, Trash } from '../components/Icons';
import { bytes, songsWord } from '../lib/util';

export default function Offline() {
  const offline = useStore((s) => s.offline);
  const offlineMeta = useStore((s) => s.offlineMeta);
  const playQueue = useStore((s) => s.playQueue);
  const setUI = useStore((s) => s.setUI);
  const clearDownloads = useStore((s) => s.clearDownloads);
  const hero = '#0f5c2e';
  useEffect(() => { setUI({ heroColor: hero, pageTitle: 'Офлайн' }); }, [setUI]);

  const tracks = useMemo(
    () => Object.keys(offline).map((id) => offlineMeta[id]).filter(Boolean),
    [offline, offlineMeta]
  );
  const total = Object.values(offline).reduce((s, x) => s + (x.size || 0), 0);
  const isDesktop = !!window.desktop;

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <div className="hero-art" style={{ background: 'linear-gradient(135deg,#1db954,#0a4d24)', display: 'grid', placeItems: 'center' }}>
          <Download size={80} />
        </div>
        <div>
          <div className="hero-kind">Загрузки</div>
          <h1 className="hero-title">Офлайн</h1>
          <div className="hero-sub">
            <span className="muted">{songsWord(tracks.length)}</span>
            <span className="dot">•</span><span className="muted">{bytes(total)}</span>
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button
          className="play-fab"
          title="Слушать офлайн-кэш"
          aria-label="Слушать офлайн-кэш"
          onClick={() => tracks.length && playQueue(tracks, 0, { type: 'offline', name: 'Офлайн' })}
        ><Play size={22} /></button>
        {!!tracks.length && (
          <button className="pill-btn" onClick={clearDownloads}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Trash size={13} /> Очистить кэш</span>
          </button>
        )}
      </div>

      <div className="page">
        {!isDesktop && (
          <div className="muted" style={{ marginBottom: 20 }}>
            Офлайн-загрузки доступны только в десктоп-версии (Electron): файлы сохраняются на диск и играют без сети.
          </div>
        )}
        {tracks.length ? (
          <TrackList tracks={tracks} context={{ type: 'offline', name: 'Офлайн' }} />
        ) : (
          <div className="center-empty">
            <Download size={36} />
            <div>Пока ничего не скачано. Нажмите ⬇ у трека, альбома или плейлиста.</div>
          </div>
        )}
      </div>
    </div>
  );
}
