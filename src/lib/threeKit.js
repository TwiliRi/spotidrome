/**
 * Общее для трёхмерных сцен случайного трека («Космос», «Чёрная дыра»).
 *
 * Здесь всё, что не зависит от конкретной сцены: отложенная загрузка three.js,
 * проверка WebGL, кривые и процедурные текстуры на canvas. Сами сцены лежат
 * рядом и импортируют этот файл — three.js при этом остаётся в отдельном чанке
 * и не раздувает основной бандл.
 */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (p) => 1 - (1 - p) ** 3;
export const easeOutQuint = (p) => 1 - (1 - p) ** 5;
export const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - ((-2 * p + 2) ** 3) / 2);
export const easeOutBack = (p) => { const c = 1.70158; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; };
/** сглаживание, не зависящее от FPS */
export const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

/** детерминированный генератор: обложки в сцене одинаковы от броска к броску */
export const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let threePromise = null;
export const loadThree = () => { threePromise = threePromise || import('three'); return threePromise; };

/**
 * Прогрев: three.js лежит отдельным чанком (~190 КБ в gzip), и на первом броске
 * он приезжал бы с задержкой. Качаем его заранее, когда интерфейс свободен.
 */
export function prewarmThree() {
  if (typeof window === 'undefined') return;
  const go = () => { loadThree().catch(() => {}); };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 5000 });
  else setTimeout(go, 2200);
}

/** WebGL вообще доступен? Если нет — компонент вернётся к плоской анимации. */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Абстрактная «обложка»: градиент, геометрия и зерно. Никакой сети. */
export function makeArtTexture(THREE, px, seed) {
  const rnd = mulberry(seed);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const o = c.getContext('2d');

  const h1 = Math.floor(rnd() * 360);
  const h2 = (h1 + 30 + rnd() * 150) % 360;
  const g = o.createLinearGradient(0, 0, px * (0.4 + rnd() * 0.6), px);
  g.addColorStop(0, `hsl(${h1} ${54 + rnd() * 26 | 0}% ${34 + rnd() * 22 | 0}%)`);
  g.addColorStop(1, `hsl(${h2} ${48 + rnd() * 30 | 0}% ${9 + rnd() * 12 | 0}%)`);
  o.fillStyle = g;
  o.fillRect(0, 0, px, px);

  // крупные фигуры — как на обложках сборников
  const shapes = 2 + (rnd() * 3 | 0);
  for (let i = 0; i < shapes; i++) {
    o.beginPath();
    const kind = rnd();
    const cx = rnd() * px, cy = rnd() * px, r = px * (0.14 + rnd() * 0.42);
    if (kind < 0.5) {
      o.arc(cx, cy, r, 0, TAU);
    } else if (kind < 0.8) {
      o.moveTo(cx, cy);
      o.arc(cx, cy, r, rnd() * TAU, rnd() * TAU + 1.2 + rnd() * 2);
      o.closePath();
    } else {
      o.rect(cx - r, cy - r * (0.3 + rnd() * 0.9), r * 2, r * (0.3 + rnd() * 0.9));
    }
    o.fillStyle = `hsla(${(h1 + rnd() * 120) % 360} 80% ${30 + rnd() * 45 | 0}% / ${0.1 + rnd() * 0.22})`;
    o.fill();
  }

  // мягкий блик и виньетка
  const shine = o.createRadialGradient(px * 0.28, px * 0.2, 0, px * 0.28, px * 0.2, px * 0.85);
  shine.addColorStop(0, 'rgba(255,255,255,.16)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  o.fillStyle = shine;
  o.fillRect(0, 0, px, px);
  const vig = o.createRadialGradient(px / 2, px / 2, px * 0.25, px / 2, px / 2, px * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.5)');
  o.fillStyle = vig;
  o.fillRect(0, 0, px, px);

  // зерно — чтобы плоскости не выглядели «пластиком»
  const img = o.getImageData(0, 0, px, px);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  o.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Радиальный градиент: свечение, мягкая точка для звёзд, кольцо фотонов. */
export function makeGlowTexture(THREE, px, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const o = c.getContext('2d');
  const g = o.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  o.fillStyle = g;
  o.fillRect(0, 0, px, px);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Тонкое кольцо вокруг горизонта: «фотонная сфера» чёрной дыры. */
export function makeRingTexture(THREE, px, hue = 36) {
  return makeGlowTexture(THREE, px, [
    [0, 'rgba(0,0,0,0)'],
    [0.62, 'rgba(0,0,0,0)'],
    [0.70, `hsla(${hue} 100% 78% / .95)`],
    [0.755, `hsla(${hue - 14} 100% 62% / .38)`],
    [0.86, `hsla(${hue - 20} 95% 55% / .10)`],
    [1, 'rgba(0,0,0,0)'],
  ]);
}

/** Мягкая точка для частиц пыли. */
export function makeStarTexture(THREE, px = 64) {
  return makeGlowTexture(THREE, px, [
    [0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)'],
  ]);
}
