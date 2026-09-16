import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from './Icons';
import { linkProps } from '../lib/uiA11y';
import api from '../lib/api';
import { useCoverSrc, remoteCover, invalidateCover } from '../lib/covers';
import { songsWord } from '../lib/util';

/* -------- Slider --------
 * onChange — «живое» значение: зовётся сразу при нажатии и во время перетаскивания
 *            (громкость меняется прямо под пальцем);
 * onCommit — только при отпускании (так ведёт себя перемотка, чтобы не дёргать поток);
 * bubble   — функция value → подпись во всплывающей подсказке;
 * wheelStep— шаг колёсика мыши (доля от max).
 */
export function Slider({ value, max = 1, onChange, onCommit, className = '', bubble, wheelStep = 0, step = 0, label }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const [temp, setTemp] = useState(null);
  const raf = useRef(0);
  const live = useRef(null);

  const val = drag && temp != null ? temp : value;
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;

  const posToVal = useCallback((clientX) => {
    const r = ref.current.getBoundingClientRect();
    const raw = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max;
    return step > 0 ? Math.round(raw / step) * step : raw;
  }, [max, step]);

  // онChange во время движения — не чаще кадра
  const pushLive = useCallback((v) => {
    if (!onChange) return;
    live.current = v;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (live.current != null) onChange(live.current);
    });
  }, [onChange]);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const start = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const v = posToVal(e.clientX);
    setDrag(true); setTemp(v);
    pushLive(v);
  };

  const move = (e) => {
    if (!drag) return;
    const v = posToVal(e.clientX);
    setTemp(v);
    pushLive(v);
  };

  const end = (e) => {
    if (!drag) return;
    const v = posToVal(e.clientX);
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    live.current = null;
    setDrag(false); setTemp(null);
    (onCommit || onChange)?.(v);
  };

  const onWheel = wheelStep
    ? (e) => {
      const dir = e.deltaY > 0 ? -1 : 1;
      const v = Math.max(0, Math.min(max, value + dir * wheelStep * max));
      onChange?.(v);
      if (onCommit && onCommit !== onChange) onCommit(v);
    }
    : undefined;

  // React вешает wheel пассивным слушателем, поэтому preventDefault здесь не
  // работает: вешаем свой, не пассивный, чтобы страница под ползунком не прыгала
  useEffect(() => {
    const el = ref.current;
    if (!el || !wheelStep) return undefined;
    const stop = (e) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, [wheelStep]);

  /* стрелки и Home/End: ползунок должен двигаться и без мыши */
  const onKeyDown = (e) => {
    const big = max / 20;                        // шаг «стрелка» — 5% шкалы
    const small = step || max / 100;
    const to = { ArrowRight: big, ArrowUp: big, ArrowLeft: -big, ArrowDown: -big }[e.key];
    let next = null;
    if (to != null) next = val + to;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = max;
    else if (e.key === 'PageUp') next = val + big * 4;
    else if (e.key === 'PageDown') next = val - big * 4;
    if (next == null) return;
    e.preventDefault();
    const v = Math.max(0, Math.min(max, step > 0 ? Math.round(next / small) * small : next));
    onChange?.(v);
    (onCommit && onCommit !== onChange) ? onCommit(v) : onChange?.(v);
  };

  const tip = bubble ? bubble(val) : null;

  return (
    <div
      className={`slider ${className}${drag ? ' dragging' : ''}`}
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(val * 100) / 100}
      aria-valuetext={tip || undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      style={{ touchAction: 'none' }}
    >
      <div className="track" />
      <div className="fill" style={{ width: `${pct}%`, background: drag ? 'var(--green)' : undefined }} />
      <div className="knob" style={{ left: `${pct}%`, opacity: drag ? 1 : undefined }} />
      {tip != null && <div className="bubble" style={{ left: `${pct}%` }}>{tip}</div>}
    </div>
  );
}

/* -------- Cover --------
   Лишние пропсы (onClick, title, …) уходят прямо в <img> — иначе их молча «съедает». */
export function Cover({ id, size = 300, alt = '', className = '', round = false, style, ...rest }) {
  const [err, setErr] = useState(false);
  const [direct, setDirect] = useState(null);   // запасной прямой URL, если кэш отдал битое
  const cached = useCoverSrc(id, size);

  useEffect(() => { setErr(false); setDirect(null); }, [id, size]);

  const src = err || !id ? placeholder(alt) : (direct || cached || placeholder(alt));

  const onError = () => {
    const url = id ? remoteCover(id, size) : null;
    if (url && src !== url) { invalidateCover(id, size); setDirect(url); }   // пробуем сервер напрямую
    else setErr(true);
  };

  return (
    <img
      className={className + (round ? ' round' : '')}
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      style={style}
      onError={onError}
      {...rest}
    />
  );
}

export function placeholder(label = '') {
  const initials = (label || '♪').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '♪';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#282828"/><text x="50%" y="56%" text-anchor="middle" font-family="Inter,Arial" font-size="96" font-weight="800" fill="#5a5a5a">${initials}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* -------- Switch --------
   Раньше тумблером был <div> с onClick — мышкой щёлкалось, а с клавиатуры
   попасть было нельзя. Теперь это настоящая кнопка с ролью переключателя. */
export function Switch({ on, onClick, label, sm = false, className = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      title={label}
      className={`switch${sm ? ' sm' : ''}${on ? ' on' : ''} ${className}`.trim()}
      onClick={onClick}
    >
      <i />
    </button>
  );
}

/* -------- Card -------- */
export function Card({ item, kind = 'album', onPlay, onContextMenu, sub: subOverride, drag, dropClass = '' }) {
  const nav = useNavigate();
  const to = kind === 'artist' ? `/artist/${item.id}` : kind === 'playlist' ? `/playlist/${item.id}` : `/album/${item.id}`;
  const sub = kind === 'artist' ? 'Исполнитель'
    : kind === 'playlist' ? (item.comment || songsWord(item.songCount || 0))
    : [item.year, item.artist].filter(Boolean).join(' • ');   // у альбома: год • исполнитель
  return (
    <div
      className={`card${dropClass ? ` ${dropClass}` : ''}`}
      onClick={() => nav(to)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(to); } }}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      title={item.name || item.title}
      data-id={item.id}
      {...(drag || {})}
    >
      <div className="art-wrap">
        <Cover id={item.coverArt || item.id} size={400} alt={item.name || item.title} className={`art${kind === 'artist' ? ' round' : ''}`} />
        {onPlay && (
          <button className="hover-play" onClick={(e) => { e.stopPropagation(); onPlay(item); }} title="Слушать">
            <Play size={18} />
          </button>
        )}
      </div>
      <div className="title">{item.name || item.title}</div>
      <div className="sub">{subOverride || sub}</div>
    </div>
  );
}

/* -------- Section -------- */
export function Section({ title, onTitleClick, more, onMore, children }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 {...linkProps(onTitleClick, !!onTitleClick)} style={{ cursor: onTitleClick ? 'pointer' : 'default' }}>{title}</h2>
        {more && <button className="more" onClick={onMore}>{more}</button>}
      </div>
      {children}
    </section>
  );
}

export function Skeletons({ n = 8 }) {
  return (
    <div className="grid">
      {Array.from({ length: n }).map((_, i) => (
        <div className="card" key={i}>
          <div className="skeleton" style={{ width: '100%', aspectRatio: 1, marginBottom: 14 }} />
          <div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 12, width: '45%' }} />
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return <div className="center-empty"><div className="spinner" /></div>;
}
