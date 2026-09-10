import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import api from '../lib/api';
import VList from '../components/VList';
import ArtistLinks from '../components/ArtistLinks';
import { Cover } from '../components/UI';
import { Play, Pause, Shuffle, Clock, Close, SyncIc } from '../components/Icons';
import { fmt, fmtLong, plural, songsWord } from '../lib/util';
import { buildDayRows, tracksOf, statsFor, playedAgo, listenTime } from '../lib/playHistory';
import { DENSITY } from '../lib/uiLayout';

/* Записей достаточно, чтобы список стал длинным, — переходим в виртуальный
   режим; с десяток строк обычным потоком выглядят привычнее. */
const VIRTUAL_FROM = 40;
const DAY_H = 44;                       // строка-заголовок дня

const RANGES = [
  { d: 1, label: 'Сегодня' },
  { d: 7, label: '7 дней' },
  { d: 30, label: '30 дней' },
  { d: null, label: 'Всё' },
];

const playsWord = (n) => plural(n, 'прослушивание', 'прослушивания', 'прослушиваний');

/** Запись истории → объект, похожий на трек: его можно поставить в очередь. */
const toSong = (e) => ({
  id: e.id, title: e.title, artist: e.artist, album: e.album,
  albumId: e.albumId, artistId: e.artistId, coverArt: e.coverArt, duration: e.duration,
});

export default function Recent() {
  const nav = useNavigate();
  const history = useStore((s) => s.playHistory);
  const remember = useStore((s) => s.settings.rememberPlays !== false);
  const updateSettings = useStore((s) => s.updateSettings);
  const removePlay = useStore((s) => s.removePlay);
  const clearPlayHistory = useStore((s) => s.clearPlayHistory);
  const restorePlayHistory = useStore((s) => s.restorePlayHistory);
  const toast = useStore((s) => s.toast);
  const setUI = useStore((s) => s.setUI);
  const playQueue = useStore((s) => s.playQueue);
  const togglePlay = useStore((s) => s.togglePlay);
  const playing = useStore((s) => s.playing);
  const cur = useStore((s) => (s.index >= 0 ? s.queue[s.index] : null));
  const context = useStore((s) => s.context);
  const ui = useStore((s) => s.settings.ui);
  const username = useStore((s) => s.credentials?.username || 'вы');

  const [range, setRange] = useState(7);
  const [live, setLive] = useState([]);
  const listRef = useRef(null);
  const hero = '#3b5f8a';

  const rowH = (DENSITY[ui.density] || DENSITY.normal).row;
  const rows = useMemo(() => buildDayRows(history, { days: range, now: Date.now() }), [history, range]);
  const songs = useMemo(() => tracksOf(rows), [rows]);
  const stats = useMemo(() => statsFor(songs), [songs]);
  const isVirtual = rows.length > VIRTUAL_FROM;

  useEffect(() => { setUI({ heroColor: hero, pageTitle: 'Недавнее' }); }, [setUI]);

  /* «Сейчас играют»: обновляем, пока открыт экран, — данные живые */
  const loadLive = useCallback(() => { api.getNowPlaying().then((l) => setLive(l || [])).catch(() => setLive([])); }, []);
  useEffect(() => {
    loadLive();
    const t = setInterval(loadLive, 60000);
    return () => clearInterval(t);
  }, [loadLive]);

  /* Переключили трек — не ждём минуту: сервер узнаёт о переключении, когда
     клиент начал стрим, поэтому спрашиваем его почти сразу и ещё раз следом,
     а на экране строку держим по локальному плееру (см. liveRows). */
  useEffect(() => {
    if (!cur?.id) return undefined;
    const t1 = setTimeout(loadLive, 400);
    const t2 = setTimeout(loadLive, 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [cur?.id, playing, loadLive]);

  /* Что показать в «сейчас играет»: свой трек — сразу из плеера, остальные
     устройства — как ответил сервер. Свою строку с сервера выбрасываем, чтобы
     не мелькало старое название, пока сервер не догнал. */
  const liveRows = useMemo(() => {
    const mine = cur ? ({
      id: cur.id, title: cur.title, album: cur.album, coverArt: cur.coverArt || cur.albumId,
      username, playing, minutesAgo: 0, local: true,
    }) : null;
    const others = (live || []).filter((x) => !(mine && (x.id === mine.id || x.username === username)));
    return mine ? [mine, ...others] : others;
  }, [live, cur, playing, username]);

  const play = useCallback((list, from = 0, name = 'Недавнее') => {
    const arr = list.map(toSong);
    if (!arr.length) return;
    playQueue(arr, from, { type: 'recent', name });
  }, [playQueue]);

  useEffect(() => {
    if (!songs.length) return;
    setUI({ pagePlay: () => play(songs, 0) });
  }, [songs, play, setUI]);

  /* Играем отсюда — держим в поле зрения текущий трек */
  const curIdx = useMemo(() => rows.findIndex((r) => r.kind === 'track' && r.item.id === cur?.id), [rows, cur]);
  useEffect(() => {
    if (!isVirtual || curIdx < 0) return undefined;
    const raf = requestAnimationFrame(() => listRef.current?.scrollToRow?.({ index: curIdx, align: 'center' }));
    return () => cancelAnimationFrame(raf);
  }, [isVirtual, curIdx]);

  const clear = () => {
    const snapshot = history;
    clearPlayHistory();
    toast(`История очищена — ${playsWord(snapshot.length)} удалено`, 'info', {
      label: 'Вернуть', onClick: () => restorePlayHistory(snapshot),
    });
  };

  const menu = (e, item) => {
    e.preventDefault();
    setUI({
      contextMenu: {
        x: e.clientX, y: e.clientY,
        items: [
          { label: 'Играть с этого трека', icon: <Play size={14} />, onClick: () => play(songs, songs.indexOf(item)) },
          { label: 'Перейти к альбому', disabled: !item.albumId, onClick: () => item.albumId && nav(`/album/${item.albumId}`) },
          { sep: true },
          { label: 'Убрать из истории', icon: <Close size={14} />, danger: true, onClick: () => removePlay(item.at) },
        ],
      },
    });
  };

  const renderRow = useCallback((r, i, extra = {}) => {
    const style = { ...(extra.style || {}), height: r.kind === 'day' ? DAY_H : rowH };
    if (r.kind === 'day') {
      return (
        <div key={`d:${r.key}`} className="recent-day" style={style} {...(extra.ariaAttributes || {})}>
          <span className="rd-label">{r.label}</span>
          <span className="rd-meta">{songsWord(r.count)}{r.duration ? ` • ${listenTime(r.duration)}` : ''}</span>
          <button className="chip-btn" onClick={() => play(r.items, 0, r.label)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Play size={12} /> Играть день</span>
          </button>
        </div>
      );
    }
    const t = r.item;
    const isCur = cur?.id === t.id;
    return (
      <div
        key={`t:${t.id}:${i}`}
        className={`track-row recent-row${isCur ? ' playing' : ''}`}
        style={style}
        {...(extra.ariaAttributes || {})}
        onDoubleClick={() => play(songs, songs.indexOf(t))}
        onContextMenu={(e) => menu(e, t)}
      >
        <div className="idx">
          {isCur && playing ? (
            <span className="play-ic" onClick={togglePlay} style={{ cursor: 'pointer' }}><Pause size={14} /></span>
          ) : (
            <span className="play-ic" onClick={() => play(songs, songs.indexOf(t))} style={{ cursor: 'pointer' }}><Play size={14} /></span>
          )}
        </div>
        <div className="cell-title">
          <Cover id={t.coverArt || t.albumId} size={80} alt={t.album || t.title} />
          <div style={{ minWidth: 0 }}>
            <div className="t-name">{t.title}</div>
            <div className="t-artist"><ArtistLinks as="span" item={t} /></div>
          </div>
        </div>
        <div className="ellipsis" onClick={() => t.albumId && nav(`/album/${t.albumId}`)} style={{ cursor: t.albumId ? 'pointer' : 'default' }}>
          {t.album}
        </div>
        <div className="ellipsis muted" title={`${new Date(t.at).toLocaleString('ru-RU')}${t.context ? ` · ${t.context}` : ''}`}>
          {playedAgo(t.at)}{t.context ? ` · ${t.context}` : ''}
        </div>
        <div className="right">
          <span>{fmt(t.duration)}</span>
          <button className="ghost-btn" title="Убрать из истории" onClick={() => removePlay(t.at)}><Close size={14} /></button>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, songs, cur, playing, rowH, isVirtual]);

  const here = context?.type === 'recent';
  const totalAll = statsFor(history);

  return (
    <div>
      <div className="hero" style={{ '--hero': hero }}>
        <div className="hero-art" style={{ background: 'linear-gradient(135deg,#1f3b57,#8fd3f4)', display: 'grid', placeItems: 'center' }}>
          <Clock size={84} />
        </div>
        <div>
          <div className="hero-kind">История прослушиваний</div>
          <h1 className="hero-title">Недавнее</h1>
          <div className="hero-sub">
            <b>{username}</b>
            <span className="dot">•</span>
            <span className="muted">{playsWord(stats.count)}</span>
            <span className="dot">•</span>
            <span className="muted">{songsWord(stats.unique)}</span>
            {!!stats.duration && <><span className="dot">•</span><span className="muted">{fmtLong(stats.duration)}</span></>}
            {totalAll.count !== stats.count && (
              <><span className="dot">•</span><span className="muted">всего в истории {playsWord(totalAll.count)}</span></>
            )}
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button
          className="play-fab"
          disabled={!songs.length}
          title={here && playing ? 'Пауза' : songs.length ? 'Играть эту историю' : 'Играть нечего'}
          onClick={() => (here && playing ? togglePlay() : play(songs, 0))}
        >
          {here && playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className="ghost-btn" title="Перемешать и играть" disabled={songs.length < 2} onClick={() => play([...songs].sort(() => Math.random() - 0.5), 0)}>
          <Shuffle size={20} />
        </button>

        <div className="chips" role="group" aria-label="Промежуток">
          {RANGES.map((r) => (
            <button key={String(r.d)} className={`chip${range === r.d ? ' active' : ''}`} onClick={() => setRange(r.d)}>{r.label}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <button className="ghost-btn" title="Обновить «сейчас играют»" onClick={loadLive}><SyncIc size={18} /></button>
        {!!history.length && (
          <button className="pill-btn" onClick={clear}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Close size={13} /> Очистить</span>
          </button>
        )}
      </div>

      <div className="page">
        {!!liveRows.length && (
          <div className="live-row">
            <span className="live-cap"><i className="live-dot" />Сейчас играет</span>
            {liveRows.map((x, i) => (
              <div key={`${x.username}-${x.id}-${i}`} className={`live-chip${x.local ? ' mine' : ''}`} title={`${x.album} · ${x.username}`}>
                <Cover id={x.coverArt} size={32} alt={x.album} />
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontSize: 13 }}>{x.title}</div>
                  <div className="ellipsis muted" style={{ fontSize: 11 }}>
                    {x.username}{x.local ? ' · сейчас' : x.minutesAgo ? ` · ${x.minutesAgo} мин назад` : ''}{x.playing ? '' : ' · пауза'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {remember === false && (
          <div className="notice">
            <span>История прослушиваний выключена в настройках — новый треки не записываются.</span>
            <button className="pill-btn" onClick={() => updateSettings({ rememberPlays: true })}>Включить</button>
          </div>
        )}

        {rows.length ? (
          isVirtual ? (
            <div className="tracks tracks-virtual">
              <VList
                items={rows}
                rowHeight={(i) => (rows[i]?.kind === 'day' ? DAY_H : rowH)}
                renderItem={renderRow}
                rowKey={(i) => `${rows[i]?.kind}-${rows[i]?.key || rows[i]?.item?.id || i}`}
                listRef={listRef}
                className="recent-rows"
                remeasureKey={`${ui.density}|${ui.scale}|${range}|${rows.length}`}
              />
            </div>
          ) : (
            <div className="tracks">{rows.map((r, i) => renderRow(r, i))}</div>
          )
        ) : (
          <div className="center-empty">
            <Clock size={40} />
            <div>Здесь появится то, что вы слушали.</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 420 }}>
              Прослушивание засчитывается, когда трек играл около 20 секунд. История хранится на этом
              устройстве и не зависит от сервера.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
