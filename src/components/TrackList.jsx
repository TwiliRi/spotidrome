import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { linkProps } from '../lib/uiA11y';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import ArtistLinks, { useArtistMenuItems } from './ArtistLinks';
import { artistTokens } from '../lib/artists';
import { Cover } from './UI';
import VList from './VList';
import { DENSITY } from '../lib/uiLayout';
import { Play, Pause, Heart, HeartFill, DotsH, Clock, Download, Check, Trash, Plus, QueueIc, RadioIc, ThumbDown, ThumbDownFill, Close,
} from './Icons';
import { fmt, plural, songsWord } from '../lib/util';

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
  onRemoveMany = null,       // удалить пачку одним запросом (плейлист)
  removeLabel = 'Удалить из плейлиста',
  virtual,                      // null — решать по длине списка
  offset = 0,                   // смещение нумерации (для списков с заголовками дней)
  onReachEnd = null,            // доскроллили до конца — можно догрузить следующую страницу
}) {
  const nav = useNavigate();
  const artistItems = useArtistMenuItems();
  // Точечные подписки: список из сотни строк не должен перерисовываться на
  // каждую отметку времени проигрывания (store отдаёт time ~4 раза в секунду)
  const playQueue = useStore((s) => s.playQueue);
  const togglePlay = useStore((s) => s.togglePlay);
  const toggleStar = useStore((s) => s.toggleStar);
  const setStarMany = useStore((s) => s.setStarMany);
  const addToQueue = useStore((s) => s.addToQueue);
  const downloadMany = useStore((s) => s.downloadMany);
  const offline = useStore((s) => s.offline);
  const download = useStore((s) => s.download);
  const removeDownload = useStore((s) => s.removeDownload);
  const setUI = useStore((s) => s.setUI);
  const startRadio = useStore((s) => s.startRadio);
  const dislike = useStore((s) => s.dislike);
  const undislike = useStore((s) => s.undislike);
  const filterExcluded = useStore((s) => s.filterExcluded);
  // состав списка зависит и от заблокированных исполнителей: подписка нужна,
  // чтобы список пересобрался сразу после бана, а не при следующем рендере
  const bannedArtists = useStore((s) => s.settings.bannedArtists);
  const hideFlags = useStore((s) => (s.settings.hideBanned ? 1 : 0) + (s.settings.hideDisliked ? 2 : 0));
  const myPlaylists = useStore((s) => s.editablePlaylists());
  const dislikedIds = useStore((s) => s.dislikedIds);
  const playing = useStore((s) => s.playing);
  const cur = useStore((s) => (s.index >= 0 ? s.queue[s.index] : null));
  const starred = useStore((s) => s.starredIds.song);
  const ui = useStore((s) => s.settings.ui);

  const rowHeight = (DENSITY[ui.density] || DENSITY.normal).row;
  const isVirtual = virtual == null ? tracks.length >= VIRTUAL_FROM : !!virtual;

  /* Сторож для невиртуального списка: показался недалеко от края экрана —
     зовём onReachEnd. Список виртуальный — сторож не нужен: он скроллится
     внутри себя, и внешний элемент никогда не пересечётся с областью
     видимости. Там считаем отрисованные строки (см. VList ниже).
     Эффект пересоздаётся на каждой новой странице: IntersectionObserver
     срабатывает только на пересечении границы, а сторож после короткой
     страницы может остаться стоять на экране. */
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !onReachEnd || isVirtual) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReachEnd();
    }, { rootMargin: '700px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onReachEnd, isVirtual, tracks.length]);

  // исключённые треки и заблокированные исполнители не показываем
  const rows = useMemo(() => filterExcluded(tracks), [tracks, dislikedIds, bannedArtists, hideFlags, filterExcluded]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  /* --------------------------- мультивыбор ---------------------------
     Выделение живёт в TrackList и считается в номерах видимых строк: номера
     нужны, чтобы по Shift выделялся диапазон. Состав списка сменился —
     выделение снимаем: старые номера уже ведут не туда. Сравниваем по
     содержимому, а не по ссылке: страницы вроде «Поиска» пересоздают массив
     треков на каждый чих стора. */
  const [sel, setSel] = useState(() => new Set());
  const anchorRef = useRef(null);
  const boxRef = useRef(null);
  const sigRef = useRef(null);
  const sig = useMemo(() => rows.map((t) => t.id).join('|'), [rows]);

  useEffect(() => {
    if (sigRef.current === null) { sigRef.current = sig; return; }
    if (sigRef.current === sig) return;
    sigRef.current = sig;
    setSel(new Set());
  }, [sig]);

  const clearSel = useCallback(() => setSel((s) => (s.size ? new Set() : s)), []);

  /** Треки, попавшие в выделение, в порядке строк. */
  const selectedRows = useCallback((s = sel) =>
    [...s].sort((a, b) => a - b).map((i) => rowsRef.current[i]).filter(Boolean), [sel]);

  const canRemove = !!(onRemoveMany || onRemove);

  /* ------------------- действия над выделенной пачкой ------------------- */
  const removeSelected = useCallback(async (list) => {
    // номера строк отдаём вместе с треками: один и тот же трек может лежать
    // в плейлисте дважды, и удалять надо именно выделенную строку
    const idxs = [...sel].sort((a, b) => a - b);
    const items = list || idxs.map((i) => rowsRef.current[i]).filter(Boolean);
    if (!items.length) return;
    if (onRemoveMany) {
      await onRemoveMany(items, idxs);
    } else if (onRemove) {
      for (const i of idxs) await onRemove(rowsRef.current[i], i); // eslint-disable-line no-await-in-loop
    }
    clearSel();
  }, [sel, onRemove, onRemoveMany, clearSel]);

  const openMenu = (e, track, i) => {
    e.preventDefault();
    const isOff = !!offline[track.id];
    // правый клик по строке вне выделения — выделение переходит на неё
    const multi = sel.size > 1 && sel.has(i);
    const list = multi ? selectedRows() : [track];
    const ids = list.map((t) => t.id);
    const n = list.length;
    const allStarred = list.every((t) => starred.has(t.id));
    const title = n === 1 ? `${track.title} — ${track.artist}` : songsWord(n);

    if (multi) {
      setUI({
        contextMenu: {
          x: e.clientX, y: e.clientY, items: [
            { label: `Играть следующим (${n})`, icon: <Play size={14} />, onClick: () => addToQueue(list, true) },
            { label: `В очередь (${n})`, icon: <QueueIc size={14} />, onClick: () => addToQueue(list) },
            { sep: true },
            {
              label: allStarred ? `Убрать из любимых (${n})` : `В любимые (${n})`,
              icon: allStarred ? <HeartFill size={14} /> : <Heart size={14} />,
              onClick: () => setStarMany(list, !allStarred),
            },
            { label: `Скачать для офлайна (${n})`, icon: <Download size={14} />, onClick: () => downloadMany(list) },
            { sep: true },
            { label: 'Добавить в плейлист…', icon: <Plus size={14} />, onClick: () => setUI({ addToOpen: { ids, title } }) },
            // быстрый доступ к своим плейлистам, без открытия окна
            ...myPlaylists.slice(0, 6).map((pl) => ({
              label: pl.name, icon: <Plus size={12} />, onClick: () => useStore.getState().addTracksToPlaylist(pl.id, ids),
            })),
            canRemove && { sep: true },
            canRemove && { label: `${removeLabel} (${n})`, icon: <Trash size={14} />, danger: true, onClick: () => removeSelected(list) },
            { sep: true },
            { label: 'Снять выделение', onClick: clearSel },
          ],
        },
      });
      return;
    }

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
      onRemove && { label: removeLabel, icon: <Trash size={14} />, danger: true, onClick: () => onRemove(track, i) },
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

  const headStyle = !showAlbum ? { gridTemplateColumns: '24px 4fr 2fr 100px' } : undefined;

  /* ---------------------------- клики по строке ---------------------------- */
  const selectOnly = (i) => { anchorRef.current = i; setSel(new Set([i])); };
  const toggleAt = (i) => {
    anchorRef.current = i;
    setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };
  const selectRange = (i) => {
    const a = anchorRef.current == null ? i : anchorRef.current;
    const from = Math.min(a, i), to = Math.max(a, i);
    const n = new Set();
    for (let k = from; k <= to; k++) n.add(k);
    setSel(n);
  };
  const onRowClick = (e, i) => {
    // фокус на списке: иначе Ctrl+A и Esc уходят «мимо» этого списка
    boxRef.current?.focus?.({ preventScroll: true });
    if (e.shiftKey) selectRange(i);
    else if (e.metaKey || e.ctrlKey) toggleAt(i);
    else selectOnly(i);
  };

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    // открытое окно или меню «едят» клавиши сами — выделение тут ни при чём
    const busy = !!useStore.getState().addToOpen || !!useStore.getState().contextMenu;
    if (mod && (e.key === 'a' || e.key === 'A')) {
      if (busy) return;
      e.preventDefault();
      setSel(new Set(rows.map((_, i) => i)));
      return;
    }
    /* стрелки ходят по списку, Enter играет выбранное: без этого список
       треков был доступен только мышью */
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !busy && rows.length) {
      e.preventDefault();
      const from = sel.size ? Math.max(...sel) : -1;
      const one = sel.size === 1 ? [...sel][0] : from;
      const next = e.key === 'ArrowDown'
        ? Math.min(rows.length - 1, (one < 0 ? -1 : one) + 1)
        : Math.max(0, (one < 0 ? rows.length : one) - 1);
      selectOnly(next);
      listRef.current?.scrollToRow?.({ index: next, align: 'auto' });
      boxRef.current?.querySelectorAll('.track-row')[next]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && sel.size === 1 && !busy) {
      e.preventDefault();
      playQueue(rows, [...sel][0], context);
      return;
    }
    if (e.key === 'Escape' && sel.size && !busy) clearSel();
    // Del снимает выделенное там, где у списка есть «удалить» (плейлист, любимые)
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size && !busy && canRemove) {
      e.preventDefault();
      removeSelected();
    }
  };

  const renderRow = useCallback((t, i, extra = {}) => {
    const isCur = cur?.id === t.id;
    const isStar = starred.has(t.id);
    const isSel = sel.has(i);
    const off = offline[t.id];
    return (
      <div
        key={`${t.id}-${i}`}
        className={`track-row${isCur ? ' playing' : ''}${isSel ? ' sel' : ''}`}
        style={{ ...headStyle, ...(extra.style || {}) }}
        {...(extra.ariaAttributes || {})}
        onClick={(e) => onRowClick(e, i)}
        onDoubleClick={() => playQueue(rows, i, context)}
        onContextMenu={(e) => openMenu(e, t, i)}
      >
        <div className="idx">
          {isCur && playing ? (
            <span onClick={(e) => { e.stopPropagation(); togglePlay(); }} style={{ cursor: 'pointer' }}><EqBars playing={playing} /></span>
          ) : (
            <>
              <span className="num">{numbered ? i + 1 + offset : ''}</span>
              <span className="play-ic" onClick={(e) => { e.stopPropagation(); (isCur ? togglePlay() : playQueue(rows, i, context)); }} style={{ cursor: 'pointer' }}>
                {isCur ? <Pause size={14} /> : <Play size={14} />}
              </span>
              <span className="sel-check" onClick={(e) => { e.stopPropagation(); toggleAt(i); }} title="Убрать из выделения">
                <Check size={12} />
              </span>
            </>
          )}
        </div>

        <div className="cell-title">
          {showCover && <Cover id={t.coverArt || t.albumId} size={80} alt={t.album || t.title} />}
          <div style={{ minWidth: 0 }}>
            <div className="t-name" title={t.title || undefined}>{t.title}</div>
            <div className="t-artist" title={t.artist || undefined}>
              {off && <span className="dl-dot" style={{ display: 'inline-grid', width: 12, height: 12, marginRight: 6, verticalAlign: 'middle' }}><Check size={8} /></span>}
              <ArtistLinks as="span" item={t} />
            </div>
          </div>
        </div>

        {showAlbum && (
          <div
            className="ellipsis"
            title={t.album || undefined}
            {...linkProps(() => { if (t.albumId) nav(`/album/${t.albumId}`); }, !!t.albumId)}
            style={{ cursor: t.albumId ? 'pointer' : 'default' }}
          >
            {t.album}
          </div>
        )}

        <div className="ellipsis">
          {context?.type === 'playlist'
            ? (t.created ? new Date(t.created).toLocaleDateString('ru-RU') : '—')
            : (t.playCount != null ? t.playCount : '—')}
        </div>

        <div className="right">
          <button className={`ghost-btn star${isStar ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleStar(t, 'song'); }} title={isStar ? 'В любимых' : 'В любимые'}>
            {isStar ? <HeartFill size={16} /> : <Heart size={16} />}
          </button>
          <span>{fmt(t.duration)}</span>
          <button className="ghost-btn more-btn" onClick={(e) => { e.stopPropagation(); openMenu(e, t, i); }} title="Ещё"><DotsH size={16} /></button>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cur, starred, offline, playing, headStyle, context, numbered, offset, showAlbum, showCover, onRemove, onRemoveMany, myPlaylists, dislikedIds, sel]);

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

  const selCount = sel.size;
  const selTracks = selCount ? selectedRows() : [];
  const selAllStarred = selTracks.length ? selTracks.every((t) => starred.has(t.id)) : false;

  /* Панель над списком: то же, что в меню по правому клику, но всегда на виду —
     иначе про выделение просто забывают. */
  const selBar = selCount > 0 ? (
    <div className="sel-bar">
      <span className="sel-count"><b>{selCount}</b> {plural(selCount, 'трек', 'трека', 'треков')}</span>
      <button className="chip" onClick={() => addToQueue(selTracks, true)} title="Поставить пачку сразу после текущего трека">
        <Play size={12} /> Играть следующим
      </button>
      <button className="chip" onClick={() => addToQueue(selTracks)} title="Дописать пачку в конец очереди">
        <QueueIc size={12} /> В очередь
      </button>
      <button className="chip" onClick={() => setUI({ addToOpen: { ids: selTracks.map((t) => t.id), title: songsWord(selCount) } })}>
        <Plus size={12} /> В плейлист…
      </button>
      <button className="chip" onClick={() => setStarMany(selTracks, !selAllStarred)}>
        {selAllStarred ? <HeartFill size={12} /> : <Heart size={12} />} {selAllStarred ? 'Из любимых' : 'В любимые'}
      </button>
      {canRemove && (
        <button className="chip danger" onClick={() => removeSelected(selTracks)}>
          <Trash size={12} /> {removeLabel}
        </button>
      )}
      <span className="sel-hint">Shift — диапазон, Ctrl/Cmd — по одному, Ctrl+A — всё</span>
      <button className="icon-btn sel-clear" onClick={clearSel} title="Снять выделение (Esc)"><Close size={13} /></button>
    </div>
  ) : null;

  if (!rows.length) {
    return (
      <div className="tracks" ref={boxRef} tabIndex={0} onKeyDown={onKeyDown}>
        {head}
        <div className="muted" style={{ padding: '32px 16px' }}>Здесь пока пусто.</div>
      </div>
    );
  }

  if (!isVirtual) {
    return (
      <div className="tracks" ref={boxRef} tabIndex={0} onKeyDown={onKeyDown}>
        {head}
        {selBar}
        {rows.map((t, i) => renderRow(t, i))}
        {onReachEnd && <div ref={sentinelRef} className="paged-sentinel" aria-hidden="true" />}
      </div>
    );
  }

  return (
    <div className="tracks tracks-virtual" ref={boxRef} tabIndex={0} onKeyDown={onKeyDown}>
      {head}
      {selBar}
      <VList
        items={rows}
        rowHeight={rowHeight}
        rowKey={(i) => `${rows[i]?.id || i}-${i}`}
        renderItem={renderRow}
        listRef={listRef}
        className="track-rows"
        remeasureKey={`${ui.density}|${ui.scale}|${ui.showTitlebar ? 1 : 0}|${ui.titleH}|${rows.length}`}
        onRowsRendered={onReachEnd ? (visible, all) => {
          /* Виртуальный список скроллится внутри себя, поэтому сторож
             снаружи его не видит: смотрим, какие строки отрисованы.
             react-window зовёт колбэк с двумя парами индексов — видимые и
             с запасом (в первой версии библиотеки это был один объект).
             Запас в 10 строк: страница приезжает до того, как упёрлись
             в конец. Короткий список не считаем — иначе подгрузка
             дёргалась бы прямо на первой отрисовке. */
          if (rows.length < 10) return;
          const last = Math.max(
            visible?.stopIndex ?? visible?.visibleStopIndex ?? 0,
            all?.stopIndex ?? visible?.overscanStopIndex ?? 0,
          );
          if (last >= rows.length - 10) onReachEnd();
        } : undefined}
      />
    </div>
  );
}
