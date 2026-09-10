import React, { useEffect, useRef, useState } from 'react';
import useStore from '../state/store';
import { Cover, Slider } from './UI';
import { useCoverSrc } from '../lib/covers';
import { useDominantColor, fmt } from '../lib/util';
import { volumeLabel } from '../lib/audio';
import {
  Play, Pause, Next, Prev, Shuffle, Repeat, RepeatOne, Heart, HeartFill,
  ThumbDown, ThumbDownFill, VolHigh, VolLow, VolMute, MaxIc, PinIc, PinFillIc, Close, QueueIc,
} from './Icons';

const desktop = typeof window !== 'undefined' ? window.desktop : null;

/* Название длиннее строки — пускаем бегущей строкой (только при переполнении) */
function Marquee({ text, className = '' }) {
  const box = useRef(null);
  const inner = useRef(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const b = box.current, i = inner.current;
    if (!b || !i) return;
    const over = i.scrollWidth - b.clientWidth;
    setRun(over > 4 ? over + 24 : 0);
  }, [text]);

  return (
    <div className={`mini-marquee ${className}`.trim()} ref={box} title={text}>
      <span
        ref={inner}
        className={run ? 'go' : ''}
        style={run ? { '--shift': `-${run}px`, animationDuration: `${Math.max(7, run / 22)}s` } : undefined}
      >
        {text}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function MiniPlayer({ layout = 'mini' }) {
  const {
    current, playing, togglePlay, next, prev, time, duration, seek, buffering,
    shuffle, toggleShuffle, repeat, cycleRepeat, settings, setVolume, toggleMute,
    toggleStar, starredIds, toggleDislike, dislikedIds, setUI, context, exitMini,
  } = useStore();

  const track = current();
  const nano = layout === 'nano';
  const coverSrc = useCoverSrc(track ? (track.coverArt || track.albumId) : null, nano ? 120 : 400);
  const accent = useDominantColor(coverSrc, '#2f6f4f');

  const [onTop, setOnTop] = useState(true);
  useEffect(() => {
    if (!desktop?.isAlwaysOnTop) return;
    desktop.isAlwaysOnTop().then(setOnTop).catch(() => {});
    return desktop.onWindowState?.((s) => { if (s.alwaysOnTop != null) setOnTop(!!s.alwaysOnTop); });
  }, []);

  const vol = settings.muted ? 0 : settings.volume;
  const VolIcon = vol === 0 ? VolMute : vol < 0.5 ? VolLow : VolHigh;
  const isStar = track && starredIds.song.has(track.id);
  const isBanned = track && dislikedIds.has(track.id);
  const artists = track ? (track.artist || track.albumArtist || '') : '';
  const total = duration || track?.duration || 0;

  const pin = () => desktop?.setAlwaysOnTop?.(!onTop).then(setOnTop).catch(() => {});
  // двойной клик по «пустому» месту окна разворачивает приложение обратно
  const dbl = (e) => { if (!e.target.closest('.no-drag')) exitMini(); };

  const winBtns = (
    <div className="mini-win no-drag">
      {desktop && (
        <button className="mini-ic" onClick={pin} title={onTop ? 'Поверх других окон: включено' : 'Поверх других окон'}>
          {onTop ? <PinFillIc size={13} /> : <PinIc size={13} />}
        </button>
      )}
      <button className="mini-ic" onClick={exitMini} title="Вернуть обычное окно (M или двойной клик)">
        <MaxIc size={13} />
      </button>
      {desktop && (
        <button className="mini-ic danger" onClick={() => desktop.closeWindow?.()} title="Закрыть">
          <Close size={13} />
        </button>
      )}
    </div>
  );

  /* ------------------------------ «полоска» ------------------------------ */
  if (nano) {
    return (
      <div className="mini nano drag" style={{ '--accent': accent }} onDoubleClick={dbl}>
        <div className="nano-body">
          <Cover id={track?.coverArt || track?.albumId} size={120} alt={track?.album || ''} className="nano-cover" />
          <div className="nano-meta">
            <Marquee text={track ? track.title : 'Ничего не играет'} className="t" />
            <Marquee text={artists} className="a" />
          </div>
          <div className="nano-ctl no-drag">
            <button
              className={`mini-ic wide-only${isStar ? ' on' : ''}`}
              onClick={() => track && toggleStar(track, 'song')}
              title="В любимые (L)"
            >
              {isStar ? <HeartFill size={13} /> : <Heart size={13} />}
            </button>
            <button
              className={`mini-ic wide-only${isBanned ? ' on danger' : ''}`}
              onClick={() => track && toggleDislike(track)}
              title={isBanned ? 'Вернуть трек' : 'Больше не играть (X)'}
            >
              {isBanned ? <ThumbDownFill size={13} /> : <ThumbDown size={13} />}
            </button>
            <button className="mini-ic" onClick={prev} title="Предыдущий"><Prev size={14} /></button>
            <button className="mini-play sm" onClick={togglePlay} title={playing ? 'Пауза' : 'Играть'}>
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button className="mini-ic" onClick={() => next(true)} title="Следующий"><Next size={14} /></button>
            <span className="nano-time wide-only">{fmt(time)}</span>
          </div>
          {winBtns}
        </div>
        <div className="nano-bar no-drag">
          <Slider value={time} max={total} onCommit={seek} className="thin" />
        </div>
      </div>
    );
  }

  /* ------------------------------ «карточка» ----------------------------- */
  return (
    <div className="mini card drag" style={{ '--accent': accent }} onDoubleClick={dbl}>
      <div className="mini-top">
        <div className="mini-src">{context?.name || 'Spotidrome'}</div>
        {winBtns}
      </div>

      <div className="mini-art">
        <Cover id={track?.coverArt || track?.albumId} size={400} alt={track?.album || ''} />
      </div>

      <div className="mini-meta">
        <Marquee text={track ? track.title : 'Ничего не играет'} className="t" />
        <Marquee text={artists} className="a" />
      </div>

      <div className="mini-prog no-drag">
        <Slider value={time} max={total} onCommit={seek} />
        <div className="mini-times">
          <span>{fmt(time)}</span>
          <span>{buffering ? '…' : fmt(total)}</span>
        </div>
      </div>

      <div className="mini-ctl no-drag">
        <button className={`mini-ic${shuffle ? ' on' : ''}`} onClick={toggleShuffle} title="Перемешать"><Shuffle size={15} /></button>
        <button className="mini-ic big" onClick={prev} title="Предыдущий"><Prev size={19} /></button>
        <button className="mini-play" onClick={togglePlay} title={playing ? 'Пауза' : 'Играть'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="mini-ic big" onClick={() => next(true)} title="Следующий"><Next size={19} /></button>
        <button className={`mini-ic${repeat !== 'off' ? ' on' : ''}`} onClick={cycleRepeat} title="Повтор">
          {repeat === 'one' ? <RepeatOne size={15} /> : <Repeat size={15} />}
        </button>
      </div>

      <div className="mini-bot no-drag">
        <button
          className={`mini-ic${isStar ? ' on' : ''}`}
          onClick={() => track && toggleStar(track, 'song')}
          title="В любимые (L)"
        >
          {isStar ? <HeartFill size={14} /> : <Heart size={14} />}
        </button>
        <button
          className={`mini-ic${isBanned ? ' on danger' : ''}`}
          onClick={() => track && toggleDislike(track)}
          title={isBanned ? 'Вернуть трек' : 'Больше не играть (X)'}
        >
          {isBanned ? <ThumbDownFill size={14} /> : <ThumbDown size={14} />}
        </button>
        <button className="mini-ic" onClick={toggleMute} title="Звук (M)"><VolIcon size={14} /></button>
        <Slider className="vol" value={vol} max={1} onChange={setVolume} bubble={volumeLabel} wheelStep={0.04} />
        <button
          className="mini-ic"
          onClick={() => { exitMini(); setUI({ queueOpen: true }); }}
          title="Очередь — в обычном окне"
        >
          <QueueIc size={14} />
        </button>
      </div>
    </div>
  );
}
