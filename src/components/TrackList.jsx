import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import ArtistLinks, { useArtistMenuItems } from './ArtistLinks';
import { artistTokens } from '../lib/artists';
import { Cover } from './UI';
import VList from './VList';
import { DENSITY } from '../lib/uiLayout';
import { Play, Pause, Heart, HeartFill, DotsH, Clock, Download, Check, Trash, Plus, QueueIc, RadioIc, ThumbDown, ThumbDownFill,
} from './Icons';
import { fmt } from '../lib/util';

/** С этого числа строк список уходит в виртуальный режим. */
export const VIRTUAL_FROM = 60;

function EqBars({ playing }) {
  return (
    <div className={`eq-bars${playing ? '' : ' paused'}`}>
      <i /><i /><i /><i />
    </div>
  );
}

export default function TrackList({
  tracks = [],
  context = null,
  showAlbum = true,
  showCover = true,
  showHeader = true,
  numbered = true,
  onRemove = null,
  virtual,                      // null — решать по длине списка
  offset = 0,                   // смещение нумерации (для списков с заголовками дней)
}) {
  const nav = useNavigate();
  const artistItems = useArtistMenuItems();
  // Точечные подписки: список из сотни строк не должен перерисовываться на
  // каждую отметку времени проигрывания (store отдаёт time ~4 раза в секунду)
  const playQueue = useStore((s) => s.playQueue);
  const togglePlay = useStore((s) => s.togglePlay);
  const toggleStar = useStore((s) => s.toggleStar);
  const addToQueue = useStore((s) => s.addToQueue);
  const offline = useStore((s) => s.offline);
  const download = useStore((s) => s.download);
  const removeDownload = useStore((s) => s.removeDownload);
  const setUI = useStore((s) => s.setUI);
  const startRadio = useStore((s) => s.startRadio);
  const dislike = useStore((s) => s.dislike);
  const undislike = useStore((s) => s.undislike);
  const filterDisliked = useStore((s) => s.filterDisliked);
  const myPlaylists = useStore((s) => s.editablePlaylists());
  const dislikedIds = useStore((s) => s.dislikedIds);
  const playing = useStore((s) => s.playing);
  const cur = useStore((s) => (s.index >= 0 ? s.queue[s.index] : null));
  const starred = useStore((s) => s.starredIds.song);
  const ui = useStore((s) => s.settings.ui);

  const rowHeight = (DENSITY[ui.density] || DENSITY.normal).row;
  const isVirtual = virtual == null ? tracks.length >= VIRTUAL_FROM : !!virtual;

  const openMenu = (e, track, i) => {
    e.preventDefault();
    const isOff = !!offline[track.id];
    const items = [
      { label: 'Играть следующим', icon: <Play size={14} />, onClick: () => addToQueue(track, true) },
      { label: 'Добавить в очередь', icon: <QueueIc size={14} />, onClick: () => addToQueue(track, false) },
      { sep: true },
      { label: 'Радио по треку', icon: <RadioIc size={14} />, onClick: () => startRadio(track, 'similar') },
      ...artistTokens(track).filter((t) => t.type === 'artist').slice(0, 3).map((a) => ({
        label: `Радио: ${a.name}`, icon: <RadioIc size={14} />, onClick: () => startRadio(track, 'artist', a.name),
      })),
      { sep: true },
      { label: starred.has(track.id) ? 'Удалить из любимых' : 'В любимые треки', icon: starred.has(track.id) ? <HeartFill size={14} /> : <Heart size={14} />, onClick: () => toggleStar(track, 'song') },
      dislikedIds.has(track.id)
        ? { label: 'Вернуть трек (снять дизлайк)', icon: <ThumbDownFill size={14} />, onClick: () => undislike(track.id) }
        : { label: 'Больше не играть', icon: <ThumbDown size={14} />, onClick: () => dislike(track) },
      isOff
        ? { label: 'Удалить из офлайна', icon: <Trash size={14} />, onClick: () => removeDownload(track.id) }
        : { label: 'Скачать для офлайна', icon: <Download size={14} />, onClick: () => download(track) },
      { sep: true },
      track.albumId && { label: 'Перейти к альбому', onClick: () => nav(`/album/${track.albumId}`) },
      ...artistItems(track),
      onRemove && { sep: true },
      onRemove && { label: 'Удалить из плейлиста', icon: <Trash size={14} />, danger: true, onClick: () => onRemove(track, i) },
      { sep: true },
      {
        label: 'Добавить в плейлист…',
        icon: <Plus size={14} />,
        onClick: () => setUI({ addToOpen: { ids: [track.id], title: `${track.title} — ${track.artist}` } }),
      },
      // быстрый доступ к своим плейлистам, без открытия окна
      ...myPlaylists.slice(0, 6).map((pl) => ({
        label: pl.name,
        icon: <Plus size={12} />,
        onClick: () => useStore.getState().addTracksToPlaylist(pl.id, [track.id]),
      })),
    ];
    setUI({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  };

  // исключённые треки не показываем (настройка «Скрывать исключённые»)
  const rows = useMemo(() => filterDisliked(tracks), [tracks, dislikedIds, filterDisliked]);

  const headStyle = !showAlbum ? { gridTemplateColumns: '24px 4fr 2fr 100px' } : undefined;

  const renderRow = useCallback((t, i, extra = {}) => {
    const isCur = cur?.id === t.id;
    const isStar = starred.has(t.id);
    const off = offline[t.id];
    return (
      <div
        key={`${t.id}-${i}`}
        className={`track-row${isCur ? ' playing' : ''}`}
        style={{ ...headStyle, ...(extra.style || {}) }}
        {...(extra.ariaAttributes || {})}
        onDoubleClick={() => playQueue(rows, i, context)}
        onContextMenu={(e) => openMenu(e, t, i)}
      >
        <div className="idx">
          {isCur && playing ? (
            <span onClick={togglePlay} style={{ cursor: 'pointer' }}><EqBars playing={playing} /></span>
          ) : (
            <>
              <span className="num">{numbered ? i + 1 + offset : ''}</span>
              <span className="play-ic" onClick={() => (isCur ? togglePlay() : playQueue(rows, i, context))} style={{ cursor: 'pointer' }}>
                {isCur ? <Pause size={14} /> : <Play size={14} />}
              </span>
            </>
          )}
        </div>

        <div className="cell-title">
          {showCover && <Cover id={t.coverArt || t.albumId} size={80} alt={t.album || t.title} />}
          <div style={{ minWidth: 0 }}>
            <div className="t-name">{t.title}</div>
            <div className="t-artist">
              {off && <span className="dl-dot" style={{ display: 'inline-grid', width: 12, height: 12, marginRight: 6, verticalAlign: 'middle' }}><Check size={8} /></span>}
              <ArtistLinks as="span" item={t} />
            </div>
          </div>
        </div>

        {showAlbum && (
          <div className="ellipsis" onClick={() => t.albumId && nav(`/album/${t.albumId}`)} style={{ cursor: t.albumId ? 'pointer' : 'default' }}>
            {t.album}
          </div>
        )}

        <div className="ellipsis">
          {context?.type === 'playlist'
            ? (t.created ? new Date(t.created).toLocaleDateString('ru-RU') : '—')
            : (t.playCount != null ? t.playCount : '—')}
        </div>

        <div className="right">
          <button className={`ghost-btn star${isStar ? ' on' : ''}`} onClick={() => toggleStar(t, 'song')} title={isStar ? 'В любимых' : 'В любимые'}>
            {isStar ? <HeartFill size={16} /> : <Heart size={16} />}
          </button>
          <span>{fmt(t.duration)}</span>
          <button className="ghost-btn more-btn" onClick={(e) => openMenu(e, t, i)} title="Ещё"><DotsH size={16} /></button>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cur, starred, offline, playing, headStyle, context, numbered, offset, showAlbum, showCover, onRemove, myPlaylists, dislikedIds]);

  /* При заходе в огромный список сразу показываем играющий трек, а не начало. */
  const listRef = useRef(null);
  const centered = useRef(false);
  useEffect(() => {
    if (!isVirtual || centered.current || !cur) return undefined;
    const i = rows.findIndex((t) => t.id === cur.id);
    if (i < 0) return undefined;
    centered.current = true;
    const raf = requestAnimationFrame(() => listRef.current?.scrollToRow?.({ index: i, align: 'center' }));
    return () => cancelAnimationFrame(raf);
  }, [isVirtual, cur, rows]);

  const head = showHeader ? (
    <div className="track-head" style={headStyle}>
      <div style={{ textAlign: 'right' }}>#</div>
      <div>Название</div>
      {showAlbum && <div>Альбом</div>}
      <div>{context?.type === 'playlist' ? 'Добавлено' : 'Прослушиваний'}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 44 }}><Clock size={16} /></div>
    </div>
  ) : null;

  if (!rows.length) {
    return (
      <div className="tracks">
        {head}
        <div className="muted" style={{ padding: '32px 16px' }}>Здесь пока пусто.</div>
      </div>
    );
  }

  if (!isVirtual) {
    return (
      <div className="tracks">
        {head}
        {rows.map((t, i) => renderRow(t, i))}
      </div>
    );
  }

  return (
    <div className="tracks tracks-virtual">
      {head}
      <VList
        items={rows}
        rowHeight={rowHeight}
        rowKey={(i) => `${rows[i]?.id || i}-${i}`}
        renderItem={renderRow}
        listRef={listRef}
        className="track-rows"
        remeasureKey={`${ui.density}|${ui.scale}|${ui.showTitlebar ? 1 : 0}|${ui.titleH}|${rows.length}`}
      />
    </div>
  );
}
