/**
 * Сцена «случайная пластинка» — canvas-2D движок для анимации случайного трека.
 *
 * Чистый JS без React: компонент только создаёт сцену, гоняет rAF и сообщает
 * фазу. Всё рисование, физика вертушки и кинематика тонарма — здесь.
 *
 * Фазы (совпадают с машиной состояний в сторе):
 *   idle    — пластинка падает на диск вертушки
 *   spin    — раскрутка и вращение, пока грузится трек (длительность любая)
 *   balance — «ищем дорожку»: тонарм завис над краем (долгая загрузка)
 *   settle  — тонарм опускается, игла касается дорожки
 *   top     — наезд камеры на этикетку, кроссфейд этикетки в обложку
 *   expand  — обложку подхватывает DOM-элемент и уносит в плеер
 */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (p) => 1 - (1 - p) ** 3;
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - ((-2 * p + 2) ** 3) / 2);
/** сглаживание, не зависящее от FPS */
const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
/** кратчайший путь к углу */
const shortAngle = (from, to) => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/* ------------------------------ текстуры ------------------------------ */

function makeRecordTexture(px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const o = c.getContext('2d');
  const r = px / 2;

  o.save();
  o.beginPath(); o.arc(r, r, r, 0, TAU); o.clip();

  const base = o.createRadialGradient(r * 0.62, r * 0.5, r * 0.05, r, r, r);
  base.addColorStop(0, '#24242b');
  base.addColorStop(0.42, '#141419');
  base.addColorStop(1, '#08080b');
  o.fillStyle = base;
  o.fillRect(0, 0, px, px);

  // дорожки
  const rings = Math.round(px / 3.4);
  for (let i = 0; i < rings; i++) {
    const f = i / rings;
    o.beginPath();
    o.arc(r, r, r * (0.34 + 0.645 * f), 0, TAU);
    o.strokeStyle = `rgba(255,255,255,${0.013 + Math.random() * 0.021})`;
    o.lineWidth = 0.55 + Math.random() * 0.5;
    o.stroke();
  }
  // разделители «песен»
  [0.24, 0.42, 0.58, 0.74, 0.88].forEach((f) => {
    const rad = r * (0.34 + 0.645 * f);
    o.beginPath(); o.arc(r, r, rad, 0, TAU);
    o.strokeStyle = 'rgba(255,255,255,.10)'; o.lineWidth = 2.2; o.stroke();
    o.beginPath(); o.arc(r, r, rad + 2.2, 0, TAU);
    o.strokeStyle = 'rgba(0,0,0,.5)'; o.lineWidth = 2; o.stroke();
  });
  // микроцарапины
  for (let i = 0; i < 22; i++) {
    const a0 = Math.random() * TAU;
    o.beginPath();
    o.arc(r, r, r * (0.36 + Math.random() * 0.58), a0, a0 + 0.05 + Math.random() * 0.45);
    o.strokeStyle = `rgba(255,255,255,${0.025 + Math.random() * 0.045})`;
    o.lineWidth = 0.7; o.stroke();
  }
  // фаска по краю
  o.beginPath(); o.arc(r, r, r - 1, 0, TAU);
  o.strokeStyle = 'rgba(255,255,255,.15)'; o.lineWidth = 2; o.stroke();
  o.restore();
  return c;
}

function makeLabelTexture(px, accent) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const o = c.getContext('2d');
  const r = px / 2;
  const g = o.createRadialGradient(r * 0.68, r * 0.6, r * 0.08, r, r, r);
  g.addColorStop(0, '#f3f1ec');
  g.addColorStop(0.5, '#dcd7cb');
  g.addColorStop(1, '#b6ae9d');
  o.beginPath(); o.arc(r, r, r, 0, TAU); o.fillStyle = g; o.fill();

  o.strokeStyle = 'rgba(40,38,32,.22)'; o.lineWidth = 1.4;
  [0.86, 0.79].forEach((f) => { o.beginPath(); o.arc(r, r, r * f, 0, TAU); o.stroke(); });

  o.fillStyle = accent;
  o.globalAlpha = 0.9;
  o.beginPath(); o.arc(r, r, r * 0.5, 0, TAU); o.fill();
  o.globalAlpha = 1;

  o.textAlign = 'center'; o.textBaseline = 'middle';
  o.fillStyle = 'rgba(20,20,20,.72)';
  o.font = `700 ${Math.round(r * 0.17)}px "Segoe UI", system-ui, sans-serif`;
  o.fillText('СЛУЧАЙНЫЙ', r, r - r * 0.12);
  o.fillText('ТРЕК', r, r + r * 0.1);

  o.globalCompositeOperation = 'destination-out';
  o.beginPath(); o.arc(r, r, r * 0.08, 0, TAU); o.fill();
  return c;
}

/* ------------------------------- сцена -------------------------------- */

export function createVinylScene(canvas, { accent = '#1db954' } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });

  const S = {
    W: 0, H: 0, DPR: 1, cx: 0, cy: 0, R: 200,
    phase: 'idle',
    t: 0, pt: 0,                 // общее время и время внутри фазы
    accent,
    cover: null,                 // HTMLImageElement обложки
    coverMix: 0,                 // 0 — этикетка, 1 — обложка
    spin: 0, angle: 0,           // об/с и текущий угол
    drop: 0,                     // 0..1 — падение пластинки на диск
    armT: 0,                     // 0 — парковка, 1 — на дорожке
    armTrack: 0,                 // положение вдоль дорожки
    zoom: 0,                     // наезд камеры на этикетку
    hideLabel: false,            // на фазе expand этикетку рисует DOM
    rings: [],                   // ударные волны от иглы
    dust: [],
    needleHit: 0,
  };

  let recordTex = null;
  let labelTex = null;

  function seedDust(n) {
    S.dust.length = 0;
    for (let i = 0; i < n; i++) {
      S.dust.push({
        x: Math.random(), y: Math.random(),
        z: 0.35 + Math.random() * 0.9,
        p: Math.random() * TAU,
        s: 0.3 + Math.random() * 0.8,
      });
    }
  }

  function resize() {
    S.DPR = Math.min(2, window.devicePixelRatio || 1);
    S.W = canvas.clientWidth || window.innerWidth;
    S.H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(S.W * S.DPR);
    canvas.height = Math.round(S.H * S.DPR);
    ctx.setTransform(S.DPR, 0, 0, S.DPR, 0, 0);

    S.cx = S.W * 0.5;
    S.cy = S.H * 0.45;
    S.R = clamp(Math.min(S.W * 0.24, S.H * 0.32), 120, 320);

    const px = clamp(Math.round(S.R * 2 * S.DPR), 360, 1200);
    recordTex = makeRecordTexture(px);
    labelTex = makeLabelTexture(clamp(Math.round(px * 0.36), 150, 460), S.accent);
    seedDust(Math.round(clamp(S.W / 16, 30, 90)));
  }

  function setAccent(a) {
    if (a === S.accent) return;
    S.accent = a;
    if (recordTex) {
      labelTex = makeLabelTexture(labelTex ? labelTex.width : 300, a);
    }
  }

  function setCover(img) { S.cover = img; }

  function setPhase(phase) {
    if (S.phase === phase) return;
    S.phase = phase;
    S.pt = 0;
    if (phase === 'settle') S.needleHit = 1;      // касание иглы
    if (phase === 'expand') S.hideLabel = true;
  }

  /** Экранный прямоугольник этикетки — стартовая геометрия для перелёта в плеер */
  function labelRect() {
    const k = 1 + S.zoom * (labelTargetScale() - 1);
    const lr = S.R * 0.36 * k;
    const cx = lerp(S.cx, S.cx, 1);
    const cy = lerp(S.cy, S.cy, 1);
    return { x: cx - lr, y: cy - lr, w: lr * 2, h: lr * 2 };
  }

  /** во сколько раз увеличиваем сцену, чтобы этикетка стала крупной «обложкой» */
  function labelTargetScale() {
    const want = Math.min(S.W, S.H) * 0.2;        // желаемый радиус этикетки
    return clamp(want / (S.R * 0.36), 1, 2.2);
  }

  /* ------------------------------ физика ------------------------------ */
  function update(dt) {
    S.t += dt; S.pt += dt;
    const ph = S.phase;

    // падение пластинки на диск
    S.drop = approach(S.drop, 1, 6.5, dt);

    // вертушка: разгон, пока играем, и останов на наезде камеры
    const wantSpin = ph === 'idle' ? 0.22 : ph === 'top' || ph === 'expand' ? 0 : 0.62;
    S.spin = approach(S.spin, wantSpin, ph === 'top' || ph === 'expand' ? 5.5 : 1.7, dt);
    const wow = 1 + Math.sin(S.t * 0.8) * 0.004 + Math.sin(S.t * 4.7) * 0.0015;
    S.angle += S.spin * wow * TAU * dt;

    // на наезде доворачиваем этикетку в «ровное» положение
    if (ph === 'top' || ph === 'expand') {
      S.angle += shortAngle(S.angle % TAU, 0) * (1 - Math.exp(-6 * dt));
    }

    // тонарм
    const wantArm = ph === 'settle' || ph === 'top' || ph === 'expand' ? 1
      : ph === 'balance' ? 0.72 : 0;
    S.armT = approach(S.armT, wantArm, ph === 'settle' ? 3.2 : 2.2, dt);
    if (ph === 'balance') S.armT += Math.sin(S.t * 2.4) * 0.012;     // «ищет дорожку»
    if (ph === 'settle' || ph === 'top') S.armTrack = clamp(S.armTrack + dt * 0.07, 0, 1);

    // наезд камеры и проявление обложки
    const wantZoom = ph === 'top' || ph === 'expand' ? 1 : 0;
    S.zoom = approach(S.zoom, wantZoom, 2.4, dt);
    const still = S.spin < 0.09;                   // не мешаем кроссфейду крутиться
    const wantMix = (ph === 'top' || ph === 'expand') && S.cover && (still || S.pt > 0.6) ? 1 : 0;
    S.coverMix = approach(S.coverMix, wantMix, 3.6, dt);

    // ударные волны
    if (S.needleHit > 0) {
      S.needleHit = 0;
      S.rings.push({ r: 0.96, life: 0, w: 2.6 }, { r: 0.96, life: -0.12, w: 1.4 });
    }
    if ((ph === 'spin' || ph === 'balance') && Math.random() < dt * 1.6) {
      S.rings.push({ r: 0.35 + Math.random() * 0.5, life: 0, w: 0.9 });
    }
    for (let i = S.rings.length - 1; i >= 0; i--) {
      S.rings[i].life += dt / 1.15;
      if (S.rings[i].life >= 1) S.rings.splice(i, 1);
    }
  }

  /* ----------------------------- отрисовка ---------------------------- */
  function drawShadow() {
    const { cx, cy, R } = S;
    const k = easeOutCubic(clamp(S.drop, 0, 1));
    ctx.save();
    ctx.translate(cx, cy + R * 0.1);
    ctx.scale(1, 0.22);
    const g = ctx.createRadialGradient(0, 0, R * 0.15, 0, 0, R * (1.9 - k * 0.4));
    g.addColorStop(0, `rgba(0,0,0,${0.34 + k * 0.4})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.9, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawPlatter() {
    const { cx, cy, R } = S;
    const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, '#2a2a31');
    g.addColorStop(0.45, '#18181e');
    g.addColorStop(1, '#0c0c10');
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.085, 0, TAU);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1.2; ctx.stroke();

    // стробоскопические точки по ободу
    ctx.save();
    ctx.translate(cx, cy);
    const dots = 44;
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * TAU;
      const fl = 0.5 + 0.5 * Math.cos(S.angle * dots - i * 0.6);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 1.052, Math.sin(a) * R * 1.052, 1.3, 0, TAU);
      ctx.fillStyle = `rgba(255,255,255,${0.06 + fl * 0.22})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRecord() {
    const { cx, cy, R } = S;
    const drop = easeOutCubic(clamp(S.drop, 0, 1));
    const lift = (1 - drop) * R * 0.85;              // падение сверху
    const tilt = (1 - drop) * 0.16;

    ctx.save();
    ctx.translate(cx, cy - lift);
    ctx.scale(1, 1 - tilt * 0.35);
    ctx.rotate(S.angle);
    ctx.drawImage(recordTex, -R, -R, R * 2, R * 2);
    ctx.rotate(-S.angle);

    // анизотропный блик винила
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(-0.5 + Math.sin(S.t * 0.25) * 0.1);
    for (const dir of [1, -1]) {
      const gg = ctx.createLinearGradient(0, -R * dir, 0, R * dir);
      gg.addColorStop(0, 'rgba(255,244,225,0)');
      gg.addColorStop(0.36, 'rgba(255,244,225,.045)');
      gg.addColorStop(0.5, 'rgba(255,248,235,.14)');
      gg.addColorStop(0.64, 'rgba(255,244,225,.045)');
      gg.addColorStop(1, 'rgba(255,244,225,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(-R, -R, R * 2, R * 2);
    }
    ctx.rotate(0.5 - Math.sin(S.t * 0.25) * 0.1);

    // цветной отсвет обложки
    const warm = ctx.createRadialGradient(-R * 0.4, -R * 0.45, 0, -R * 0.4, -R * 0.45, R * 1.3);
    warm.addColorStop(0, hexA(S.accent, 0.16));
    warm.addColorStop(1, hexA(S.accent, 0));
    ctx.fillStyle = warm;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    // волны от иглы
    for (const p of S.rings) {
      const k = clamp(p.life, 0, 1);
      if (p.life < 0) continue;
      const rad = R * lerp(p.r, 0.2, easeOutCubic(k));
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU);
      ctx.strokeStyle = hexA(S.accent, (1 - k) ** 2 * 0.5);
      ctx.lineWidth = p.w * (1 - k * 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // этикетка / обложка
    if (!S.hideLabel) drawLabel(R * 0.36);

    // шпиндель
    ctx.globalAlpha = clamp(1 - S.coverMix * 1.4, 0, 1);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.022, 0, TAU);
    const sp = ctx.createLinearGradient(-4, -4, 4, 6);
    sp.addColorStop(0, '#f2efe8'); sp.addColorStop(1, '#6b665c');
    ctx.fillStyle = sp; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawLabel(lr) {
    ctx.save();
    ctx.rotate(S.angle);
    // бумажная этикетка
    ctx.globalAlpha = 1 - S.coverMix;
    ctx.drawImage(labelTex, -lr, -lr, lr * 2, lr * 2);
    ctx.globalAlpha = 1;

    // обложка кроссфейдом
    if (S.cover && S.coverMix > 0.001) {
      ctx.save();
      ctx.globalAlpha = S.coverMix;
      ctx.beginPath(); ctx.arc(0, 0, lr, 0, TAU); ctx.clip();
      ctx.drawImage(S.cover, -lr, -lr, lr * 2, lr * 2);
      ctx.restore();
    }
    ctx.restore();

    // блик и кромка этикетки — не крутятся вместе с ней
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, lr, 0, TAU); ctx.clip();
    const gl = ctx.createLinearGradient(-lr, -lr, lr * 0.4, lr);
    gl.addColorStop(0, 'rgba(255,255,255,.22)');
    gl.addColorStop(0.45, 'rgba(255,255,255,.04)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
    ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, lr, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.stroke();
  }

  /** тонарм: честная кинематика поворотного тонарма (теорема косинусов) */
  function drawArm() {
    const { cx, cy, R } = S;
    const bx = cx + R * 1.12, by = cy - R * 0.78;
    const L = R * 1.08;
    const D = Math.hypot(cx - bx, cy - by);
    const gamma = Math.atan2(cy - by, cx - bx);
    const angleFor = (rs) => {
      const c = clamp((D * D + L * L - rs * rs) / (2 * D * L), -1, 1);
      return gamma - Math.acos(c);
    };
    const playA = angleFor(R * lerp(0.94, 0.55, S.armTrack));
    const restA = angleFor(R * 1.26) + 0.42;   // парковка сбоку от диска
    const ang = lerp(restA, playA, easeInOutCubic(clamp(S.armT, 0, 1)));
    const down = clamp(S.armT, 0, 1);

    ctx.save();
    ctx.translate(bx, by);

    // тень тонарма на пластинке
    ctx.save();
    ctx.rotate(ang);
    ctx.translate(R * 0.03 * down, R * 0.05 * (1.6 - down));
    ctx.strokeStyle = `rgba(0,0,0,${0.16 + down * 0.2})`;
    ctx.lineWidth = R * 0.04; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.stroke();
    ctx.restore();

    ctx.rotate(ang);
    // противовес
    const cw = ctx.createLinearGradient(0, -R * 0.05, 0, R * 0.05);
    cw.addColorStop(0, '#dedbd3'); cw.addColorStop(0.5, '#8d8981'); cw.addColorStop(1, '#46443f');
    ctx.fillStyle = cw;
    roundRect(ctx, -R * 0.28, -R * 0.048, R * 0.22, R * 0.096, R * 0.048);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();

    // трубка
    const tg = ctx.createLinearGradient(0, -R * 0.02, 0, R * 0.02);
    tg.addColorStop(0, '#f1eee8'); tg.addColorStop(0.45, '#b5b1a8'); tg.addColorStop(1, '#5c5953');
    ctx.strokeStyle = tg; ctx.lineWidth = R * 0.022; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-R * 0.05, 0); ctx.lineTo(L * 0.87, 0); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(L * 0.87, 0);
    ctx.quadraticCurveTo(L * 0.95, -R * 0.028, L, 0);
    ctx.stroke();

    // головка звукоснимателя
    ctx.save();
    ctx.translate(L, 0);
    ctx.rotate(0.32);
    ctx.fillStyle = '#191b1e';
    roundRect(ctx, -R * 0.05, -R * 0.03, R * 0.105, R * 0.06, R * 0.012);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = S.accent;
    roundRect(ctx, -R * 0.028, -R * 0.013, R * 0.046, R * 0.026, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,240,240,.8)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(R * 0.046, R * 0.026);
    ctx.lineTo(R * 0.056, R * 0.026 + R * 0.022 * (1 - down * 0.55));
    ctx.stroke();
    // искра касания
    if (S.phase === 'settle' && S.pt < 0.5) {
      const k = 1 - S.pt / 0.5;
      const g = ctx.createRadialGradient(R * 0.056, R * 0.05, 0, R * 0.056, R * 0.05, R * 0.12 * k);
      g.addColorStop(0, hexA(S.accent, 0.55 * k));
      g.addColorStop(1, hexA(S.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(R * 0.056, R * 0.05, R * 0.12, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.rotate(-ang);

    // ось тонарма
    const pg = ctx.createRadialGradient(-3, -4, 1, 0, 0, R * 0.08);
    pg.addColorStop(0, '#e9e5dc'); pg.addColorStop(0.6, '#8b8880'); pg.addColorStop(1, '#3a3833');
    ctx.beginPath(); ctx.arc(0, 0, R * 0.08, 0, TAU); ctx.fillStyle = pg; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.028, 0, TAU);
    ctx.fillStyle = 'rgba(18,18,22,.9)'; ctx.fill();
    ctx.restore();
  }

  function drawDust(dt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of S.dust) {
      d.y -= dt * 0.014 * d.z * d.s;
      d.x += Math.sin(S.t * 0.3 * d.s + d.p) * 0.0003;
      if (d.y < -0.05) { d.y = 1.05; d.x = Math.random(); }
      const x = d.x * S.W, y = d.y * S.H;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(S.t * 2 * d.s + d.p));
      const r = d.z * 1.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, `rgba(255,246,230,${0.3 * tw * d.z})`);
      g.addColorStop(1, 'rgba(255,246,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawGlow() {
    const { cx, cy, R } = S;
    const pulse = 0.5 + 0.5 * Math.sin(S.t * 1.4);
    const k = S.phase === 'top' || S.phase === 'expand' ? 1 : 0.55;
    const g = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * (2.1 + pulse * 0.15));
    g.addColorStop(0, hexA(S.accent, 0.16 * k));
    g.addColorStop(0.45, hexA(S.accent, 0.06 * k));
    g.addColorStop(1, hexA(S.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S.W, S.H);
  }

  function render(dt) {
    update(dt);
    ctx.clearRect(0, 0, S.W, S.H);

    drawGlow();
    drawDust(dt);

    // камера: наезд на этикетку
    const scale = 1 + easeInOutCubic(S.zoom) * (labelTargetScale() - 1);
    ctx.save();
    ctx.translate(S.cx, S.cy);
    ctx.scale(scale, scale);
    ctx.translate(-S.cx, -S.cy);

    drawShadow();
    drawPlatter();
    drawRecord();
    ctx.globalAlpha = 1 - S.zoom * 0.9;          // тонарм тает на наезде
    drawArm();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  resize();
  return {
    render, resize, setPhase, setCover, setAccent, labelRect,
    get state() { return S; },
  };
}

/* --------------------------- мелкие помощники -------------------------- */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Любой формат цвета (#rgb, #rrggbb, rgb(), rgba()) + альфа → rgba() */
function hexA(color, a) {
  const c = color || '#1db954';
  if (c[0] === '#') {
    const h = c.slice(1);
    const n = h.length === 3
      ? h.split('').map((ch) => parseInt(ch + ch, 16))
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (n.every((v) => Number.isFinite(v))) return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
  }
  const m = c.match(/-?\d+(\.\d+)?/g);
  if (m && m.length >= 3) return `rgba(${+m[0]},${+m[1]},${+m[2]},${a})`;
  return `rgba(29,185,84,${a})`;
}
