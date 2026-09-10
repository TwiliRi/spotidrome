import React, { useEffect, useLayoutEffect, useRef } from 'react';
import useStore from '../state/store';
import { useCoverSrc } from '../lib/covers';
import { useDominantColor } from '../lib/util';
import { createVinylScene } from '../lib/vinylScene';

/**
 * Анимация случайного трека «ставим пластинку».
 *
 * Сцена рисуется на canvas (src/lib/vinylScene.js), фазы приходят из стора.
 * В финале этикетка превращается в обложку, её подхватывает обычный <img>
 * и по WAAPI перелетает точно в обложку полноэкранного плеера.
 */
export default function RandomVinyl() {
  const roll = useStore((s) => s.dice);
  const skip = useStore((s) => s.skipDice);

  const active = roll?.kind === 'vinyl';
  const phase = active ? roll.phase : null;
  const track = active ? roll.track : null;

  const coverSrc = useCoverSrc(track ? (track.coverArt || track.albumId) : null, 600);
  const accent = useDominantColor(coverSrc, '#1db954');

  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const flyRef = useRef(null);
  const targetRef = useRef(null);      // геометрия обложки плеера, снятая заранее

  /* ---------- сцена и цикл отрисовки ---------- */
  useEffect(() => {
    if (!active || !canvasRef.current) return undefined;
    const scene = createVinylScene(canvasRef.current, { accent });
    sceneRef.current = scene;

    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);   // дельта-тайм: не зависим от FPS
      last = now;
      scene.render(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      sceneRef.current = null;
    };
  }, [active]);

  useEffect(() => { if (phase) sceneRef.current?.setPhase(phase); }, [phase]);
  useEffect(() => { sceneRef.current?.setAccent(accent); }, [accent]);

  /* обложка попадает в сцену отдельной картинкой */
  useEffect(() => {
    if (!active || !coverSrc) return undefined;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => sceneRef.current?.setCover(img);
    img.src = coverSrc;
    return () => { img.onload = null; };
  }, [active, coverSrc]);

  /* Esc — пропустить */
  useEffect(() => {
    if (!active) return undefined;
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); skip(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [active, skip]);

  /* плеер монтируется скрытым уже на наезде камеры — к перелёту он готов */
  useLayoutEffect(() => {
    const cl = document.body.classList;
    if (phase === 'top') {
      cl.add('roll-prep', 'roll-handoff');
      const t = setTimeout(() => {
        const el = document.querySelector('.np2-cover');
        if (el) targetRef.current = el.getBoundingClientRect();
      }, 260);
      return () => clearTimeout(t);
    }
    if (!active) cl.remove('roll-prep', 'roll-handoff');
    return undefined;
  }, [phase, active]);

  useEffect(() => () => document.body.classList.remove('roll-prep', 'roll-handoff'), []);

  /* ---------- перелёт: круглая этикетка → квадратная обложка плеера ---------- */
  useLayoutEffect(() => {
    if (phase !== 'expand') return undefined;
    const el = flyRef.current;
    const scene = sceneRef.current;
    if (!el || !scene) return undefined;

    const from = scene.labelRect();
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.width = `${from.w}px`;
    el.style.height = `${from.h}px`;

    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      const to = targetRef.current || document.querySelector('.np2-cover')?.getBoundingClientRect();
      if (!to || !from.w) { document.body.classList.remove('roll-prep', 'roll-handoff'); return; }

      const scale = to.width / from.w;
      const dx = (to.left + to.width / 2) - (from.x + from.w / 2);
      const dy = (to.top + to.height / 2) - (from.y + from.h / 2);

      const anim = el.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)', borderRadius: '50%' },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${(1 + scale) / 2})`, borderRadius: '22%', offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: '4%' },
        ],
        { duration: 660, easing: 'cubic-bezier(.22,1,.28,1)', fill: 'forwards' },
      );

      // плеер проявляем следующим кадром после старта — перелёт идёт уже поверх него
      raf2 = requestAnimationFrame(() => document.body.classList.remove('roll-prep'));

      anim.onfinish = () => {
        document.body.classList.remove('roll-handoff');
        el.style.transition = 'opacity .2s linear';
        el.style.opacity = '0';
      };
    });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      document.body.classList.remove('roll-prep', 'roll-handoff');
    };
  }, [phase]);

  if (!active) return null;

  const caption = phase === 'balance' ? 'Ищем дорожку…' : 'Ставим пластинку…';
  const named = track && (phase === 'settle' || phase === 'top' || phase === 'expand');

  return (
    <div
      className={`rv-overlay ph-${phase}`}
      style={{ '--accent': accent }}
      onClick={skip}
      role="status"
      aria-live="polite"
      aria-label={track ? `Выпал трек ${track.title}` : 'Выбираем случайный трек'}
    >
      <div className="rv-veil" />
      <canvas ref={canvasRef} className="rv-canvas" />

      {phase === 'expand' && coverSrc && (
        <img ref={flyRef} className="rv-fly" src={coverSrc} alt="" draggable={false} />
      )}

      <div className="rv-caption">
        {named ? (
          <>
            <span className="k">Выпал трек</span>
            <b>{track.title}</b>
            <i>{track.artist}</i>
          </>
        ) : (
          <span className="k rolling">{caption}</span>
        )}
      </div>
    </div>
  );
}
