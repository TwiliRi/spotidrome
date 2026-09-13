import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useStore from '../state/store';
import { useCoverSrc } from '../lib/covers';
import { useDominantColor } from '../lib/util';
import { createDiceEngine, setDiceMode, stepDice } from '../lib/diceEngine';
import { flyToPlayer } from '../lib/rollHandoff';

/* Раскладка точек на гранях (позиции в сетке 3×3) */
const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Face({ n, className }) {
  const cells = PIPS[n] || PIPS[1];
  return (
    <div className={`dice-face ${className}`}>
      <div className="dice-pips">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={cells.includes(i) ? 'on' : ''} />
        ))}
      </div>
      <div className="dice-gloss" />
    </div>
  );
}

export default function DiceRoll() {
  const rollState = useStore((s) => s.dice);
  const dice = rollState?.kind === 'dice' ? rollState : null;
  const skipDice = useStore((s) => s.skipDice);
  const track = dice?.track || null;
  const coverSrc = useCoverSrc(track ? (track.coverArt || track.albumId) : null, 600);
  const accent = useDominantColor(coverSrc, '#1db954');
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const flyRef = useRef(null);
  const targetRef = useRef(null);   // геометрия обложки плеера, снятая заранее
  const cubeRef = useRef(null);
  const floorRef = useRef(null);
  const engRef = useRef(null);
  const phase = dice?.phase || null;

  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  /*
   * Вращение считается вручную на rAF с дельта-таймом: длительность фазы
   * заранее неизвестна (она равна времени ответа сервера), а закончиться
   * бросок обязан ровно на верхней грани и с инерционным перелётом.
   */
  useEffect(() => {
    if (!dice) { engRef.current = null; return undefined; }
    if (!engRef.current) engRef.current = createDiceEngine();
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const st = engRef.current;
      if (!st) return;
      const dt = Math.min(0.05, (now - last) / 1000);   // защита от фризов вкладки
      last = now;
      stepDice(st, dt);
      const cube = cubeRef.current;
      if (cube) {
        cube.style.transform =
          `translate3d(0, ${-st.lift}px, 0) rotateX(${st.ax}deg) rotateY(${st.ay}deg) rotateZ(${st.az}deg)`;
      }
      const floor = floorRef.current;
      if (floor) {
        // тень живёт вместе с кубиком: ниже кубик — плотнее и компактнее пятно
        const k = Math.min(1, st.lift / 24);
        floor.style.opacity = String(0.92 - k * 0.42);
        floor.style.setProperty('--floor-scale', String(1 + k * 0.14));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [!dice]);

  useEffect(() => {
    if (!phase || !engRef.current) return;
    setDiceMode(engRef.current, phase, { recover: !!dice?.recover });
  }, [phase, dice?.recover]);

  // Esc — пропустить анимацию
  useEffect(() => {
    if (!dice) return undefined;
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); skipDice(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [dice, skipDice]);

  /*
   * Плеер монтируется скрытым уже на облёте камеры: к моменту перелёта обложки
   * вся тяжёлая работа (вёрстка, текст песни, цвет) позади, и анимация идёт
   * чисто на композиторе.
   */
  useLayoutEffect(() => {
    const cl = document.body.classList;
    if (dice?.phase === 'top') {
      cl.add('dice-prep', 'dice-handoff');
      const t = setTimeout(() => {
        const el = document.querySelector('.np2-cover');
        if (el) targetRef.current = el.getBoundingClientRect();
      }, 260);
      return () => clearTimeout(t);
    }
    if (!dice) cl.remove('dice-prep', 'dice-handoff');
    return undefined;
  }, [dice?.phase, dice]);

  useEffect(() => () => document.body.classList.remove('dice-prep', 'dice-handoff'), []);

  /* Shared-element: обложка с верхней грани долетает в обложку плеера */
  useLayoutEffect(() => {
    if (dice?.phase !== 'expand') return undefined;
    const el = flyRef.current;
    if (!el) return undefined;

    // стартуем оттуда, где картинка уже стоит (верхняя грань кубика), но
    // фиксируем это место явно: дальше ею управляет WAAPI-анимация
    const from = el.getBoundingClientRect();
    const to = targetRef.current || document.querySelector('.np2-cover')?.getBoundingClientRect();
    const anim = flyToPlayer(el, from, to, { fromRadius: '16%', midRadius: null, toRadius: '14px', duration: 640 });

    if (!anim) {   // лететь некуда — просто отдаём плеер, без висящей картинки
      el.style.display = 'none';
      document.body.classList.remove('dice-prep', 'dice-handoff');
      return undefined;
    }

    const raf = requestAnimationFrame(() => document.body.classList.remove('dice-prep'));

    anim.onfinish = () => {
      document.body.classList.remove('dice-handoff');
      el.style.transition = 'opacity .2s linear';
      el.style.opacity = '0';
    };

    return () => {
      cancelAnimationFrame(raf);
      document.body.classList.remove('dice-prep', 'dice-handoff');
    };
  }, [dice?.phase]);

  const style = useMemo(() => {
    // FLIP: стартовая точка — центр кнопки в шапке
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    const size = Math.min(Math.max(Math.min(vp.w, vp.h) * 0.24, 156), 280);
    return {
      '--ox': `${(dice?.origin?.x ?? cx) - cx}px`,
      '--oy': `${(dice?.origin?.y ?? 40) - cy}px`,
      '--dice-size': `${size}px`,
      '--accent': accent,
    };
  }, [vp, dice?.origin, accent]);

  if (!dice) return null;
  const { face } = dice;
  const other = (k) => (((face + k - 1) % 6) + 1);

  return (
    <div
      className={`dice-overlay ph-${phase}`}
      style={style}
      onClick={skipDice}
      role="status"
      aria-live="polite"
      aria-label={track ? `Выпал трек ${track.title}` : 'Бросаем кубик'}
    >
      <div className="dice-veil" />
      <div className="dice-vignette" />
      <div className="dice-glow" />
      <div className="dice-ring" />
      <div className="dice-ring two" />

      {/* сцена = «камера»: на финале плавно уходит на вид сверху */}
      <div className="dice-scene">
        <div className="dice-floor" ref={floorRef} />
        <div className="dice-cube" ref={cubeRef}>
         <div className="dice-body">
          {/* верхняя грань — результат броска: сначала точки, затем обложка */}
          <div className="dice-face top">
            <div className="dice-pips">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className={(PIPS[face] || PIPS[1]).includes(i) ? 'on' : ''} />
              ))}
            </div>
            <div className="dice-cover">
              {coverSrc && <img src={coverSrc} alt="" draggable={false} />}
              <div className="dice-cover-ring" />
            </div>
            <div className="dice-gloss" />
          </div>

          <Face n={7 - face} className="bottom" />
          <Face n={other(1)} className="front" />
          <Face n={7 - other(1)} className="back" />
          <Face n={other(2)} className="right" />
          <Face n={7 - other(2)} className="left" />

          {/* внутренние плиты закрывают просветы на скруглённых рёбрах */}
          <div className="dice-core x" />
          <div className="dice-core y" />
          <div className="dice-core z" />
         </div>
        </div>
      </div>

      {/* обложка, перелетающая в плеер */}
      {phase === 'expand' && coverSrc && (
        <img ref={flyRef} className="dice-fly" src={coverSrc} alt="" draggable={false} />
      )}

      <div className="dice-caption">
        {track && (phase === 'settle' || phase === 'top' || phase === 'expand') ? (
          <>
            <span className="k">Выпал трек</span>
            <b>{track.title}</b>
            <i>{track.artist}</i>
          </>
        ) : (
          <span className="k rolling">
            {phase === 'balance' ? 'Ищем что-нибудь стоящее…' : 'Бросаем кубик…'}
          </span>
        )}
      </div>
    </div>
  );
}
