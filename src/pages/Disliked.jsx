import React, { useEffect, useRef, useState } from 'react';
import { linkProps } from '../lib/uiA11y';
import { useLocation, useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import { Cover } from '../components/UI';
import { ThumbDownFill, Trash, Play, Check, Download, Ban } from '../components/Icons';
import { fmt, songsWord, plural } from '../lib/util';
import ArtistLinks from '../components/ArtistLinks';
import { buildPlaylistHtml, collectCovers, pageFileName, coversWord } from '../lib/pageExport';
import { saveTextFile } from '../lib/saveFile';

export default function Disliked() {
  const nav = useNavigate();
  const loc = useLocation();
  const dislikes = useStore((s) => s.dislikes);
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

  /* две вкладки: исключённые треки и заблокированные исполнители */
  const tab = new URLSearchParams(loc.search).get('tab') === 'artists' ? 'artists' : 'tracks';
  const onTracks = tab === 'tracks';

  const bannedArtists = (settings.bannedArtists || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const unbanArtist = useStore((s) => s.unbanArtist);
  const clearBannedArtists = useStore((s) => s.clearBannedArtists);
  const hideBanned = settings.hideBanned !== false;

  useEffect(() => {
    setUI({ heroColor: hero, pageTitle: onTracks ? 'Исключённые треки' : 'Заблокированные исполнители' });
  }, [setUI, onTracks]);

  const list = Object.values(dislikes).sort((a, b) => (b.at || 0) - (a.at || 0));
  const when = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

  /* Отдельная HTML-страница со списком: обложки вклеиваем в файл, чтобы
     страница открывалась и без доступа к серверу. */
  const [share, setShare] = useState({ busy: false, done: 0, total: 0 });
  const shareAlive = useRef(false);
  useEffect(() => () => { shareAlive.current = false; }, []);

  const shareHtml = async () => {
    if (share.busy || !list.length) return;
    shareAlive.current = true;
    setShare({ busy: true, done: 0, total: list.length });
    try {
      const covers = await collectCovers(list, {
        alive: () => shareAlive.current,
        onProgress: (p) => setShare((st) => (st.busy ? { ...st, done: p.done, total: p.total } : st)),
      });
      if (!shareAlive.current) { setShare({ busy: false, done: 0, total: 0 }); return; }
      const rows = list.map((t) => ({ ...t, cover: covers.get(String(t.id)) || null }));
      const html = buildPlaylistHtml(rows, {
        title: 'Исключённые треки',
        note: 'Треки, которые владелец фонотеки исключил из подборок, радио и очереди.',
      });
      const file = pageFileName('disliked');
      const saved = await saveTextFile(file, html, { ext: 'html', title: 'Сохранить страницу' });
      if (saved.canceled) { setShare({ busy: false, done: 0, total: 0 }); return; }
      toast(`Страница готова: ${saved.path || file}`, 'success');
      setShare({ busy: false, done: 0, total: 0, file: saved.path || file });
    } catch (e) {
      toast(`Не получилось собрать страницу: ${e?.message || e}`, 'error');
      setShare({ busy: false, done: 0, total: 0 });
    }
  };

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <div className="hero-art" style={{ background: 'linear-gradient(135deg,#7a1f2b,#2b2b2b)', display: 'grid', placeItems: 'center' }}>
          {onTracks ? <ThumbDownFill size={80} /> : <Ban size={72} />}
        </div>
        <div>
          <div className="hero-kind">Локальный список</div>
          <h1 className="hero-title">{onTracks ? 'Исключённые треки' : 'Заблокированные исполнители'}</h1>
          <div className="hero-sub">
            <b>{onTracks ? songsWord(list.length) : plural(bannedArtists.length, 'исполнитель', 'исполнителя', 'исполнителей')}</b>
            <span className="dot">•</span>
            <span className="muted">
              {onTracks ? 'не попадают в подборки, радио и очередь' : 'их треки не приходят сами и не звучат в очереди'}
            </span>
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <div className="seg" role="tablist" aria-label="Что исключено">
          <button
            className={`seg-btn${onTracks ? ' on' : ''}`}
            role="tab"
            aria-selected={onTracks}
            onClick={() => nav('/disliked')}
          >
            Треки{list.length ? ` · ${list.length}` : ''}
          </button>
          <button
            className={`seg-btn${!onTracks ? ' on' : ''}`}
            role="tab"
            aria-selected={!onTracks}
            onClick={() => nav('/disliked?tab=artists')}
          >
            Исполнители{bannedArtists.length ? ` · ${bannedArtists.length}` : ''}
          </button>
        </div>

        {onTracks ? (
          <>
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
                className="pill-btn"
                onClick={shareHtml}
                disabled={share.busy}
                title="Отдельная страница в стиле Spotify: можно просто скинуть человеку"
              >
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Download size={14} />
                  {share.busy
                    ? `Готовлю… ${share.done} из ${share.total} ${coversWord(share.total)}`
                    : 'HTML-страница'}
                </span>
              </button>
            )}
            {!!list.length && (
              <button
                className="pill-btn danger"
                onClick={() => { if (confirm(`Вернуть все ${list.length} трек(ов)?`)) clearDislikes(); }}
              >
                <Trash size={14} /> Очистить список
              </button>
            )}
          </>
        ) : (
          <>
            <label className="dis-switch">
              <input
                type="checkbox"
                checked={hideBanned}
                onChange={(e) => updateSettings({ hideBanned: e.target.checked })}
              />
              <span>Скрывать их треки в списках</span>
            </label>
            {!!bannedArtists.length && (
              <button
                className="pill-btn danger"
                onClick={() => { if (confirm(`Разблокировать всех (${bannedArtists.length})?`)) clearBannedArtists(); }}
              >
                <Trash size={14} /> Разблокировать всех
              </button>
            )}
          </>
        )}
      </div>

      <div className="page">
        {dislikesPath && onTracks && (
          <div className="dis-path">
            Файл со списком: <code>{dislikesPath}</code>
          </div>
        )}

        {!onTracks ? (
          !bannedArtists.length ? (
            <div className="center-empty">
              <Ban size={40} />
              <div>Заблокированных исполнителей нет</div>
              <div className="muted" style={{ fontSize: 13 }}>
                В меню трека (правый клик или «Ещё» в плеере) есть пункт «Заблокировать: …»,
                на странице исполнителя — кнопка «Заблокировать». Треки такого исполнителя
                перестанут приходить в AutoDJ, радио и случайный выбор
              </div>
            </div>
          ) : (
            <div className="tracks">
              {bannedArtists.map((a, i) => (
                <div className="track-row dis-row" key={`${a.id || ''}-${a.name}-${i}`} style={{ gridTemplateColumns: '48px 4fr 2fr 190px' }}>
                  <div className="idx">
                    <Ban size={14} />
                  </div>

                  <div className="cell-title">
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="t-name"
                        title={a.id ? 'Открыть страницу исполнителя' : ''}
                        {...linkProps(() => { if (a.id) nav(`/artist/${a.id}`); }, !!a.id)}
                        style={{ cursor: a.id ? 'pointer' : 'default' }}
                      >{a.name || '(без имени)'}</div>
                      <div className="t-artist muted" style={{ fontSize: 12 }}>
                        не звучит в AutoDJ, радио и случайном выборе
                      </div>
                    </div>
                  </div>

                  <div className="muted" style={{ fontSize: 13 }}>{when(a.at)}</div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <button
                      className="pill-btn"
                      onClick={() => { unbanArtist(a); toast(`Снова можно: ${a.name}`, 'success'); }}
                      title="Снять блокировку"
                    >
                      <Check size={13} /> Разблокировать
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !list.length ? (
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

                <div className="ellipsis" {...linkProps(() => { if (t.albumId) nav(`/album/${t.albumId}`); }, !!t.albumId)} style={{ cursor: t.albumId ? 'pointer' : 'default' }}>
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
          {onTracks ? (
            <>
              «HTML-страница» собирает отдельный файл со списком: тёмная страница в духе Spotify,
              обложки вклеены внутрь, поэтому она открывается у любого человека и без доступа к серверу.
              Сам список при этом хранится только у вас на компьютере и не отправляется на сервер Navidrome.
              Файл можно править руками, скопировать на другую машину или удалить —
              приложение перечитает его при следующем запуске.
            </>
          ) : (
            <>
              Блокировка действует на всё, что подбирается само: AutoDJ, радио, случайный трек
              и «далее» по очереди. Вручную включить такой трек можно всегда — бан запрещает
              подборки, а не доступ к фонотеке. Список хранится в настройках рядом с исключёнными
              треками и не уходит на сервер.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
