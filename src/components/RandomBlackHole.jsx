import React, { useEffect, useLayoutEffect, useRef } from 'react';
import useStore from '../state/store';
import { useCoverSrc } from '../lib/covers';
import { useDominantColor } from '../lib/util';
import { createBlackHoleScene } from '../lib/blackHoleScene';
import { hasWebGL, prewarmThree } from '../lib/threeKit';
import { loadRollArt } from '../lib/rollArt';

/**
 * Анимация случайного трека «Чёрная дыра»: сначала дыра выплёвывает обложки,
 * потом засасывает их обратно, и из горизонта поднимается выпавший трек.
 *
 * Сцена — three.js на WebGL (src/lib/blackHoleScene.js), фазы приходят из стора.
 * В финале обложку подхватывает обычный <img> и по WAAPI перелетает точно
 * в обложку полноэкранного плеера. Если WebGL недоступен, бросок продолжается
 * плоской сценой «пластинка» — пользователь просто видит другую анимацию.
 */
export default function RandomBlackHole() {
  const roll = useStore((s) => s.dice);
  const skip = useStore((s) => s.skipDice);

  const active = roll?.kind === 'blackhole';
  const phase = active ? roll.phase : null;
  const track = active ? roll.track : null;

  const coverSrc = useCoverSrc(track ? (track.coverArt || track.albumId) : null, 600);
  const accent = useDominantColor(coverSrc, '#1db954');

  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const flyRef = useRef(null);
  const targetRef = useRef(null);      // геометрия обложки плеера, снятая заранее
  const pendingArt = useRef([]);       // обложки, приехавшие до готовности сцены

  // сцена грузится асинхронно (three.js — отдельный чанк), поэтому текущие
  // фазу, цвет и обложку держим в ref: приложим их, как только сцена будет готова
  const phaseRef = useRef(phase);
  const accentRef = useRef(accent);
  const coverRef = useRef(null);
  phaseRef.current = phase;
  accentRef.current = accent;
  // обложки треков, из которых идёт выбор (их присылает стор)
  const poolRef = useRef(roll?.pool || null);
  poolRef.current = roll?.pool || null;

  /* Режим выбран — заранее тянем чанк с three.js, чтобы первый бросок не спотыкался */
  useEffect(() => {
    if (useStore.getState().settings.rollAnim !== 'blackhole') return undefined;
    const t = setTimeout(prewarmThree, 1200);
    return () => clearTimeout(t);
  }, [roll?.kind]);

  /* ---------- сцена и цикл отрисовки ---------- */
  useEffect(() => {
    if (!active || !canvasRef.current) return undefined;
    // WebGL выключен или не поддержан — играем проверенной плоской сценой
    if (!hasWebGL()) { useStore.getState().setDiceKind('vinyl'); return undefined; }

    let raf = 0;
    let dead = false;
    let last = performance.now();
    const canvas = canvasRef.current;

    const tick = (now) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const dt = Math.min(0.05, (now - last) / 1000);   // дельта-тайм: не зависим от FPS
      last = now;
      try {
        scene.render(dt);
      } catch {
        // картинку не принял WebGL или потерялся контекст — доиграем плоской сценой
        useStore.getState().setDiceKind('vinyl');
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    createBlackHoleScene(canvas, { accent: accentRef.current }).then((scene) => {
      if (dead) { scene?.dispose(); return; }
      if (!scene) { useStore.getState().setDiceKind('vinyl'); return; }
      sceneRef.current = scene;
      pendingArt.current.forEach((img) => scene.addArt(img));   // успели приехать раньше сцены
      pendingArt.current = [];
      // настоящие обложки фонотеки: сначала что уже закэшировано
      loadRollArt({
        pool: poolRef.current || [],
        limit: 18,
        onImage: (img) => sceneRef.current?.addArt(img),
        alive: () => !!sceneRef.current,
      }).catch(() => {});
      if (import.meta.env.DEV) window.__blackhole = scene;   // доступ из DevTools
      scene.setAccent(accentRef.current);
      if (coverRef.current) scene.setCover(coverRef.current);
      if (phaseRef.current) scene.setPhase(phaseRef.current);
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }).catch(() => { if (!dead) useStore.getState().setDiceKind('vinyl'); });

    const onResize = () => sceneRef.current?.resize();
    window.addEventListener('resize', onResize);
    const onLost = (e) => { e.preventDefault?.(); useStore.getState().setDiceKind('vinyl'); };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      const scene = sceneRef.current;
      scene?.dispose();
      sceneRef.current = null;
      if (import.meta.env.DEV && scene && window.__blackhole === scene) window.__blackhole = null;
    };
  }, [active]);

  useEffect(() => { if (phase) sceneRef.current?.setPhase(phase); }, [phase]);
  useEffect(() => { sceneRef.current?.setAccent(accent); }, [accent]);

  /* Настоящие обложки треков, из которых идёт выбор. Приезжают на spun/balance,
     поэтому подменяем ими заготовки прямо в полёте — ждать никого не нужно. */
  useEffect(() => {
    if (!active || !roll?.pool?.length) return undefined;
    let alive = true;
    loadRollArt({
      pool: roll.pool,
      limit: 24,
      onImage: (img) => {
        if (!alive || !img) return;
        if (sceneRef.current) sceneRef.current.addArt(img);
        else pendingArt.current.push(img);
      },
      alive: () => alive,
    }).catch(() => {});
    return () => { alive = false; };
  }, [active, roll?.pool]);

  /* обложка попадает в сцену отдельной картинкой */
  useEffect(() => {
    if (!active || !coverSrc) return undefined;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      coverRef.current = img;
      sceneRef.current?.setCover(img);
    };
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

  /* плеер монтируется скрытым уже на развороте обложки — к перелёту он готов */
  useLayoutEffect(() => {
    const cl = document.body.classList;
    if (phase === 'top') {
      cl.add('roll-prep', 'roll-handoff');
      const t = setTimeout(() => {
        const el = document.querySelector('.np2-cover');
        if (el) targetRef.current = el.getBoundingClientRect();
      }, 300);
      return () => clearTimeout(t);
    }
    if (!active) cl.remove('roll-prep', 'roll-handoff');
    return undefined;
  }, [phase, active]);

  useEffect(() => () => document.body.classList.remove('roll-prep', 'roll-handoff'), []);

  /* ---------- перелёт: обложка из горизонта → обложка плеера ---------- */
  useLayoutEffect(() => {
    if (phase !== 'expand') return undefined;
    const el = flyRef.current;
    const scene = sceneRef.current;
    if (!el || !scene) return undefined;

    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      const from = scene.coverRect();
      const to = targetRef.current || document.querySelector('.np2-cover')?.getBoundingClientRect();
      if (!from || !to || !from.w) { document.body.classList.remove('roll-prep', 'roll-handoff'); return; }

      const scale = to.width / from.w;
      const dx = (to.left + to.width / 2) - (from.x + from.w / 2);
      const dy = (to.top + to.height / 2) - (from.y + from.h / 2);

      const anim = el.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)', borderRadius: '4%' },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${(1 + scale) / 2})`, borderRadius: '8%', offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: '14px' },
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

  const named = track && (phase === 'settle' || phase === 'top' || phase === 'expand');
  const caption = phase === 'idle' ? 'Горизонт событий…'
    : phase === 'balance' ? 'Ищем что-нибудь стоящее…'
      : phase === 'settle' ? 'Затягивает…'
        : 'Выбрасывает обложки…';

  return (
    <div
      className={`bh-overlay ph-${phase}`}
      style={{ '--accent': accent }}
      onClick={skip}
      role="status"
      aria-live="polite"
      aria-label={track ? `Выпал трек ${track.title}` : 'Выбираем случайный трек'}
    >
      <div className="bh-veil" />
      <canvas ref={canvasRef} className="bh-canvas" />
      <div className="bh-vignette" />
      <div className="bh-flash" />
      <div className="bh-grain" />

      {phase === 'expand' && coverSrc && (
        <img ref={flyRef} className="bh-fly" src={coverSrc} alt="" draggable={false} />
      )}

      <div className="bh-caption">
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
