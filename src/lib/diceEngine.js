/**
 * Движок вращения кубика.
 *
 * Всё вращение считается на requestAnimationFrame с дельта-таймом (не зависит
 * от FPS устройства) — CSS-анимации тут не годятся: длительность фазы вращения
 * заранее неизвестна, она равна времени ответа сервера, а закончиться бросок
 * должен строго на верхней грани и с инерционным overshoot.
 *
 * Позы (режимы) повторяют стейт-машину стора:
 *   idle → spin → [balance] → settle → top → expand
 */

/* ---------- easing ---------- */
export const easeInOutSine = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
export const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - ((-2 * p + 2) ** 3) / 2);
export const easeOutCubic = (p) => 1 - (1 - p) ** 3;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const near360 = (v) => Math.round(v / 360) * 360;
/** ближайшее сверху кратное 360°, но не ближе, чем `min` градусов */
const up360 = (v, min) => Math.ceil((v + min) / 360) * 360;

/* Базовые угловые скорости вращения, °/с (несоизмеримые — кубик не «зацикливается») */
const V = { x: 196, y: 286, z: 118 };
/* Инерционный перелёт в конце, ° */
const OVERSHOOT = 5;
/* Доля времени торможения до точки перелёта */
const OS_SPLIT = 0.82;

export function createDiceEngine() {
  return {
    mode: 'idle',
    t: 0,           // общее время сцены, с
    mt: 0,          // время внутри текущего режима, с
    ax: -18, ay: 24, az: 0,
    lift: 4,
    from: null, target: null, dur: 0,
    done: false,
  };
}

/** Переключить режим; поза «откуда» берётся из текущих углов — переходы всегда плавные */
export function setDiceMode(st, mode, opts = {}) {
  if (st.mode === mode) return;
  const prevTarget = st.mode === 'settle' ? st.target : null;
  st.from = { ax: st.ax, ay: st.ay, az: st.az, lift: st.lift };
  st.mode = mode;
  st.mt = 0;
  st.done = false;

  if (mode === 'balance') {
    // наклон на ребро: кубик встаёт «на угол» и застывает, покачиваясь
    st.target = { ax: near360(st.ax) + 32, ay: near360(st.ay) + 14, az: near360(st.az) + 45 };
    st.dur = 0.78;
  } else if (mode === 'settle') {
    // финальные углы кратны 360° → кубик встаёт ровно, результат сверху
    st.target = { ax: up360(st.ax, 150), ay: up360(st.ay, 260), az: up360(st.az, 100) };
    st.dur = opts.recover ? 1.16 : 0.7;
  } else {
    // после остановки фиксируем ровную позу (кратные 360° углы) до конца сцены
    if (prevTarget) { st.ax = prevTarget.ax; st.ay = prevTarget.ay; st.az = prevTarget.az; }
    st.target = prevTarget;
    st.dur = 0;
  }
}

/**
 * Шаг симуляции.
 * @param {object} st  состояние движка
 * @param {number} dt  дельта-тайм, с
 * @returns {{ax:number, ay:number, az:number, lift:number}}
 */
export function stepDice(st, dt) {
  st.t += dt;
  st.mt += dt;
  const { from, target } = st;

  if (st.mode === 'idle') {
    // едва заметное «дыхание», чтобы сцена не была мёртвой
    st.ax = -18 + 2.6 * Math.sin(st.t * 1.15);
    st.az = 2.2 * Math.sin(st.t * 0.82 + 1);
    st.lift = 4 + 1.6 * Math.sin(st.t * 1.5);
  } else if (st.mode === 'spin') {
    const ramp = easeInOutSine(clamp01(st.mt / 0.38));   // мягкий разгон
    st.ax += V.x * ramp * dt;
    st.ay += V.y * ramp * dt;
    st.az += V.z * ramp * dt;
    st.lift = ramp * (15 + 7 * Math.sin(st.t * 2.3));    // «качение в невесомости»
  } else if (st.mode === 'balance') {
    const p = clamp01(st.mt / st.dur);
    const e = easeInOutCubic(p);
    const wob = st.mt - st.dur;
    // после выхода в позу — мелкое покачивание на ребре
    const wx = p < 1 ? 0 : 3.4 * Math.sin(wob * 2.1);
    const wz = p < 1 ? 0 : 5.2 * Math.sin(wob * 1.55 + 0.6);
    st.ax = from.ax + (target.ax - from.ax) * e + wx;
    st.ay = from.ay + (target.ay - from.ay) * e;
    st.az = from.az + (target.az - from.az) * e + wz;
    st.lift = from.lift + (2.5 - from.lift) * e + (p < 1 ? 0 : 1.1 * Math.sin(wob * 1.9));
  } else if (st.mode === 'settle') {
    const p = clamp01(st.mt / st.dur);
    const axis = (a) => {
      const d = target[a] - from[a];
      if (p < OS_SPLIT) {
        // основной заход: ease-out с небольшим перелётом за цель
        return from[a] + (d + OVERSHOOT) * easeOutCubic(p / OS_SPLIT);
      }
      // возврат из перелёта — короткий и мягкий
      const q = easeInOutCubic((p - OS_SPLIT) / (1 - OS_SPLIT));
      return target[a] + OVERSHOOT * (1 - q);
    };
    st.ax = axis('ax');
    st.ay = axis('ay');
    st.az = axis('az');
    const bounce = p > OS_SPLIT ? 3.2 * Math.sin(Math.PI * (p - OS_SPLIT) / (1 - OS_SPLIT)) : 0;
    st.lift = from.lift * (1 - easeOutCubic(p)) + bounce;
    if (p >= 1) {
      st.ax = target.ax; st.ay = target.ay; st.az = target.az; st.lift = 0;
      st.done = true;
    }
  } else {
    // top / expand — кубик стоит ровно, лишь микро-дыхание камеры-сцены
    st.lift += (0 - st.lift) * Math.min(1, dt * 8);
    if (target) { st.ax = target.ax; st.ay = target.ay; st.az = target.az; }
  }

  return st;
}
