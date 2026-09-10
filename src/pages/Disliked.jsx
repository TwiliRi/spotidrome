import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import { Cover } from '../components/UI';
import { ThumbDownFill, Trash, Play, Check } from '../components/Icons';
import { fmt, songsWord } from '../lib/util';
import ArtistLinks from '../components/ArtistLinks';

export default function Disliked() {
  const nav = useNavigate();
  const dislikes = useStore((s) => s.dislikes);
  const dislikedIds = useStore((s) => s.dislikedIds);
  const undislike = useStore((s) => s.undislike);
  const clearDislikes = useStore((s) => s.clearDislikes);
  const setUI = useStore((s) => s.setUI);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const dislikesPath = useStore((s) => s.dislikesPath);
  const openDislikesFolder = useStore((s) => s.openDislikesFolder);
  const playQueue = useStore((s) => s.playQueue);
  const toast = useStore((s) => s.toast);
  const hero = '#6b2230';

  useEffect(() => { setUI({ heroColor: hero, pageTitle: 'Исключённые треки' }); }, [setUI]);

  const list = Object.values(dislikes).sort((a, b) => (b.at || 0) - (a.at || 0));
  const when = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <div className="hero-art" style={{ background: 'linear-gradient(135deg,#7a1f2b,#2b2b2b)', display: 'grid', placeItems: 'center' }}>
          <ThumbDownFill size={80} />
        </div>
        <div>
          <div className="hero-kind">Локальный список</div>
          <h1 className="hero-title">Исключённые треки</h1>
          <div className="hero-sub">
            <b>{songsWord(list.length)}</b>
            <span className="dot">•</span>
            <span className="muted">не попадают в подборки, радио и очередь</span>
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <label className="dis-switch">
          <input
            type="checkbox"
            checked={!!settings.hideDisliked}
            onChange={(e) => updateSettings({ hideDisliked: e.target.checked })}
          />
          <span>Скрывать их в списках</span>
        </label>
        <button className="pill-btn" onClick={openDislikesFolder} title={dislikesPath || 'localStorage браузера'}>
          Открыть папку
        </button>
        {!!list.length && (
          <button
            className="pill-btn danger"
            onClick={() => { if (confirm(`Вернуть все ${list.length} трек(ов)?`)) clearDislikes(); }}
          >
            <Trash size={14} /> Очистить список
          </button>
        )}
      </div>

      <div className="page">
        {dislikesPath && (
          <div className="dis-path">
            Файл со списком: <code>{dislikesPath}</code>
          </div>
        )}

        {!list.length ? (
          <div className="center-empty">
            <ThumbDownFill size={40} />
            <div>Пока никого не исключили</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Нажмите «палец вниз» в плеере (или клавишу <b>X</b>) — трек пропадёт из списков и подборок
            </div>
          </div>
        ) : (
          <div className="tracks">
            {list.map((t) => (
              <div className="track-row dis-row" key={t.id} style={{ gridTemplateColumns: '48px 4fr 2fr 170px 190px' }}>
                <div className="idx">
                  <span className="play-ic" style={{ cursor: 'pointer' }} title="Послушать один раз" onClick={() => playQueue([t], 0, { type: 'queue', name: 'Исключённый трек' })}>
                    <Play size={14} />
                  </span>
                </div>

                <div className="cell-title">
                  <Cover id={t.coverArt || t.albumId} size={80} alt={t.album || t.title} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t-name">{t.title || '(без названия)'}</div>
                    <div className="t-artist"><ArtistLinks as="span" item={t} /></div>
                  </div>
                </div>

                <div className="ellipsis" onClick={() => t.albumId && nav(`/album/${t.albumId}`)} style={{ cursor: t.albumId ? 'pointer' : 'default' }}>
                  {t.album}
                </div>

                <div className="muted" style={{ fontSize: 13 }}>{when(t.at)}</div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
                  <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{t.duration ? fmt(t.duration) : ''}</span>
                  <button
                    className="pill-btn"
                    onClick={() => { undislike(t.id); toast(`Вернули: ${t.title}`, 'success'); }}
                    title="Снять дизлайк"
                  >
                    <Check size={13} /> Вернуть
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="muted" style={{ fontSize: 12, marginTop: 20, lineHeight: 1.6 }}>
          Список хранится только у вас на компьютере и не отправляется на сервер Navidrome.
          Файл можно править руками, скопировать на другую машину или удалить —
          приложение перечитает его при следующем запуске.
        </div>
      </div>
    </div>
  );
}
