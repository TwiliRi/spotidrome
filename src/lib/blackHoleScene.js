/**
 * Сцена «Чёрная дыра» — трёхмерная анимация случайного трека на three.js.
 *
 *   idle    — дыра «дышит»: диск вращается, горизонт чёрный, обложек пока нет
 *   spin    — выброс: обложки вылетают из горизонта и раскручиваются по спирали,
 *             чем дальше, тем медленнее (как при разлёте от гравитации)
 *   balance — загрузка затянулась: поток замедляется до дрейфа, дыра не гаснет
 *   settle  — разворот: тот же поток плавно меняет знак. Обложки тормозят,
 *             разворачиваются и падают внутрь, разгоняясь и вытягиваясь в нити
 *   top     — когда всё съедено, из горизонта поднимается обложка выпавшего трека
 *   expand  — обложку подхватывает DOM-элемент и уносит в плеер
 *
 * Ключевое: выброс и всасывание — не два разных эффекта, а один параметр
 * `flow` от +1 до −1. Он меняется плавно, поэтому обложки не «переключаются»,
 * а именно разворачиваются: сначала гасят скорость, потом летят назад.
 *
 * Фазы совпадают с машиной состояний в сторе (см. rollDice). Сцена не знает про
 * React: компонент только создаёт её, гоняет rAF и сообщает фазу.
 */

import {
  TAU, clamp, lerp, approach, easeOutCubic, easeOutBack, mulberry, loadThree,
  makeArtTexture, makeGlowTexture,
} from './threeKit';
import { createPostFX } from './threePost';
import { createHoleDome, MAX_STEPS } from './holeShader';

const MAX_STEPS_HINT = MAX_STEPS;   // потолок шагов интегрирования

const HORIZON = 1.0;        // радиус тени на экране: ровно 3√3/2 радиуса Шварцшильда
const RS = HORIZON / 2.5981;  // радиус Шварцшильда в мировых единицах
const DISK_IN = 3.0 * RS;     // ISCO — последняя устойчивая круговая орбита
const DISK_OUT = 15.0 * RS;   // внешний край аккреционного диска
const COVERS = 34;
const R_SPAWN = 1.16;       // откуда вылетает обложка
const R_MAX = 10.5;         // где растворяется
const FADE_EDGE = 2.6;      // ширина зоны растворения у внешнего края
const VR_OUT = 3.6;         // скорость выброса
const VR_IN = 4.2;          // скорость всасывания
const HERO = 1.95;          // размер обложки-героя в мире
const ARTS = 8;

/* Рисованного диска больше нет: аккреционный диск, его температуру,
   релятивистский набор и линзирование считает шейдер (src/lib/holeShader.js) —
   там это честная геодезика фотона, а не дуги на canvas. */

export async function createBlackHoleScene(canvas, { accent = '#1db954' } = {}) {
  const THREE = await loadThree();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
  } catch {
    return null;                       // WebGL нет — компонент покажет запасную сцену
  }
  if (!renderer.getContext()) return null;

  // сцена вся из аддитивных слоёв — на 2× dpr заливка дороже, чем польза
  const dpr = Math.min(window.devicePixelRatio || 1, 1.9);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
  camera.position.set(0, 1.45, 9.6);

  /* Постобработка: линзирование, свечение, тональная компрессия.
     Обложку-героя рисуем отдельным проходом поверх — она не должна
     искажаться линзой: иначе DOM-элемент подхватит её не там, где видно. */
  /* Линзирование и кольцо Эйнштейна теперь считает сама дыра, поэтому здесь
     остаются свечение, лёгкая аберрация и тональная компрессия; изгиб экрана
     оставлен совсем небольшим — он добавляет «гравитации» обложкам. */
  const post = createPostFX(THREE, renderer, { strength: 0.16, bloom: 1.2, threshold: 0.5, ring: 0 });
  const heroScene = new THREE.Scene();
  const dbSize = new THREE.Vector2();

  /* Качество подстраивается по факту: шаг интегрирования урезается первым,
     разрешение — только если и это не помогло. Слабая машина получит дыру
     чуть грубее, но без просадок; сильная — все 160 шагов и полный dpr. */
  const P = { acc: 0, n: 0, steps: 112, scale: 1, base: dpr, last: 0, locked: false };
  /** Ручная установка качества: для слабых машин и для прогонов на CPU,
      где считает SwiftShader и каждый кадр идёт секунды. */
  function setQuality({ steps, scale } = {}) {
    if (steps) { P.steps = Math.max(32, Math.min(MAX_STEPS_HINT, Math.round(steps))); P.locked = true; }
    if (scale) { P.scale = Math.max(0.4, Math.min(1, scale)); P.locked = true; applyScale(); }
  }
  function applyScale() {
    renderer.setPixelRatio(P.base * P.scale);
    renderer.setSize(S.w || 1, S.h || 1, false);
    renderer.getDrawingBufferSize(dbSize);
    post.setSize(dbSize.x, dbSize.y);
  }

  const accentColor = new THREE.Color(accent);
  const hotColor = new THREE.Color('#ffb066');           // раскалённый внутренний край
  const white = new THREE.Color(0xffffff);

  /* ---------- горизонт: просто чёрная сфера ----------
     Она пишет глубину, поэтому диск и обложки за дырой честно пропадают —
     силуэт получается сам, без единой строчки шейдера. */
  const holeGeo = new THREE.SphereGeometry(HORIZON, 48, 32);
  /* Только глубина, без цвета: чёрное внутри тени рисует шейдер, а сфера
     нужна, чтобы спрятать обложки, оказавшиеся за дырой. */
  const holeMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const hole = new THREE.Mesh(holeGeo, holeMat);
  scene.add(hole);

  /* ---------- сама чёрная дыра: шейдер на весь кадр ----------
     Он рисуется первым (renderOrder −1000) и не пишет глубину, поэтому
     всё остальное — обложки, вспышки — живёт поверх него как обычно. */
  const dome = createHoleDome(THREE, {
    rs: RS,
    diskIn: DISK_IN / RS,      // шейдер считает в радиусах Шварцшильда
    diskOut: DISK_OUT / RS,
    esc: 22,
    temp: 9200,
    bright: 0.62,
    diskAlpha: 0.88,
    ring: 0.5,
    halo: 0.24,
    stars: 1.7,
    steps: 112,
  });
  scene.add(dome.mesh);

  /* ---------- обложки ---------- */
  const artTextures = Array.from({ length: ARTS }, (_, i) => makeArtTexture(THREE, 256, 5000 + i * 733));
  const coverGeo = new THREE.PlaneGeometry(1, 1);
  const covers = [];
  for (let i = 0; i < COVERS; i++) {
    const rnd = mulberry(i * 6151 + 29);
    const mat = new THREE.MeshBasicMaterial({
      map: artTextures[i % ARTS], transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(coverGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    covers.push({
      mesh, mat, rnd,
      state: 'idle',                 // idle → wait → live → gone
      wait: Infinity,
      r: R_SPAWN, a: rnd() * TAU,
      y0: (rnd() - 0.5) * 0.7,
      size: 0.7 + rnd() * 0.4,
      face: rnd() * TAU, spin: (rnd() - 0.5) * 0.9,
      k: 0.8 + rnd() * 0.5,          // разброс скоростей: облако, а не строй
    });
  }

  /* ---------- обложка выпавшего трека ---------- */
  const heroMat = new THREE.MeshBasicMaterial({
    map: artTextures[3], transparent: true, opacity: 0, toneMapped: false,
  });
  const hero = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heroMat);
  hero.visible = false;
  heroScene.add(hero);

  const heroGlowMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(THREE, 256, [
      [0, 'rgba(255,255,255,.55)'], [0.3, 'rgba(255,255,255,.22)'], [1, 'rgba(255,255,255,0)'],
    ]),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  heroGlowMat.color.copy(accentColor);
  const heroGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heroGlowMat);
  heroGlow.visible = false;
  heroScene.add(heroGlow);

  /* ---------- пул обложек: рисованные заготовки + настоящие из фонотеки ---------- */
  const artPool = [...artTextures];
  const realTextures = [];
  const MAX_POOL = 44;

  /** Добавить настоящую обложку: дальше она участвует в розыгрыше при выбросе. */
  function addArt(img) {
    if (!img || realTextures.length >= MAX_POOL) return;
    let tex;
    try {
      tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
    } catch { return; }                       // картинку WebGL не принял — не беда
    realTextures.push(tex);
    artPool.push(tex);
    while (artPool.length > MAX_POOL) artPool.shift();   // заготовки уступают место
  }

  const pickArt = () => artPool[(Math.random() * artPool.length) | 0] || artTextures[0];

  /* ---------- вспышки там, где обложку выбросило или проглотило ---------- */
  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const flashes = Array.from({ length: 8 }, () => {
    const mat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(THREE, 128, [
        [0, 'rgba(255,246,230,.95)'], [0.25, 'rgba(255,208,146,.5)'],
        [0.6, 'rgba(255,170,96,.14)'], [1, 'rgba(255,150,80,0)'],
      ]),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(flashGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat, life: 0, ttl: 0.42, size: 1 };
  });

  function popFlash(x, y, z, size, color) {
    const f = flashes.find((it) => it.life <= 0) || flashes[0];
    f.life = f.ttl;
    f.size = size;
    f.mesh.position.set(x, y, z);
    f.mesh.quaternion.copy(camera.quaternion);
    f.mesh.visible = true;
    if (color) f.mat.color.copy(color);
  }

  function updateFlashes(dt) {
    for (const f of flashes) {
      if (f.life <= 0) { if (f.mesh.visible) f.mesh.visible = false; continue; }
      f.life -= dt;
      const p = clamp(f.life / f.ttl, 0, 1);
      f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.scale.setScalar(f.size * (1.9 - 0.9 * p));
      f.mat.opacity = easeOutCubic(p) * 0.85;
      if (f.life <= 0) f.mesh.visible = false;
    }
  }

  /* ---------- состояние ---------- */
  const S = {
    phase: 'idle', t: 0, pt: 0,
    flow: 0.1, feed: 0,
    dist: 9.6, fov: 58, orbit: 0,
    bt: 0,                   // время в «балансе»: по нему дыра дышит
    final: false,            // засасывание уже окончательное — обратно не выплюнет
    heroT: 0, coverTex: null, accentColor,
    w: 1, h: 1, frames: 0, swallowed: 0, calls: 0, tris: 0, ms: 0,
  };

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    S.w = w; S.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(dbSize);
    post.setSize(dbSize.x, dbSize.y);
  }

  function setAccent(a) {
    try { S.accentColor = new THREE.Color(a || '#1db954'); } catch { S.accentColor = new THREE.Color('#1db954'); }
    heroGlowMat.color.copy(S.accentColor);
  }

  function setCover(img) {
    if (!img) return;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    S.coverTex?.dispose?.();
    S.coverTex = tex;
    heroMat.map = tex;
    heroMat.needsUpdate = true;
  }

  function setPhase(phase) {
    S.phase = phase;
    S.pt = 0;
    /* Выброс начинается не залпом, а потоком: обложки стартуют по очереди.
       Если сцена появилась уже на балансе (чанк three.js ехал дольше ordinary),
       запускаем поток и там — иначе дыра так и простоит пустой. */
    const started = covers.some((c) => c.state !== 'idle');
    if (phase === 'spin' || (phase === 'balance' && !started)) {
      covers.forEach((c, i) => {
        c.state = 'wait';
        c.wait = i * 0.05 + c.rnd() * 0.12;
      });
      S.swallowed = 0;
    }
    if (phase === 'balance') S.bt = 0;
    if (phase === 'settle') S.final = true;
    if (phase === 'top') {
      S.heroT = 0;
      hero.visible = true;
      heroGlow.visible = true;
    }
  }

  function updateCovers(dt) {
    const feed = S.feed;
    for (let i = 0; i < covers.length; i++) {
      const c = covers[i];

      if (c.state === 'gone' || c.state === 'idle') { c.mesh.visible = false; continue; }

      if (c.state === 'wait') {
        c.wait -= dt;
        c.mesh.visible = false;
        if (c.wait > 0) continue;
        // новая обложка рождается у самого горизонта, в новой точке диска
        c.state = 'live';
        c.r = R_SPAWN;
        c.a = (c.a + 2.2 + c.rnd() * 2.2) % TAU;
        c.mat.map = pickArt();                     // настоящая обложка из фонотеки
        popFlash(Math.cos(c.a) * R_SPAWN, 0, Math.sin(c.a) * R_SPAWN, 0.75, null);
      }

      // угловая скорость по Кеплеру: внутренние обложки несутся быстрее внешних
      c.a += (1.35 / Math.max(c.r, 0.75) ** 1.5) * dt * (1 + feed * 0.8);

      /* Радиальная скорость. Выброс гасится к краю (стартует резко, потом
         затухает), всасывание наоборот разгоняется к горизонту. Знак потока
         один и тот же — поэтому при смене фазы обложки просто разворачиваются. */
      const vr = S.flow >= 0
        ? S.flow * VR_OUT * (0.35 + 1.5 / Math.max(c.r, 0.9)) * c.k
        : S.flow * VR_IN * (0.55 + 0.42 * c.r) * c.k;
      c.r += vr * dt;

      if (c.r <= HORIZON * 0.92) {
        /* У горизонта обложка либо пропадает совсем (окончательное всасывание
           в settle), либо, пока трек ещё ищется, дыра её «переваривает» и
           выплёвывает заново — тогда поток живёт и в обе стороны. */
        if (S.final && S.flow < 0) {
          c.state = 'gone';                     // проглочена навсегда
          S.swallowed += 1;
          popFlash(Math.cos(c.a) * HORIZON, 0, Math.sin(c.a) * HORIZON, 1.25, S.accentColor);
        } else {
          c.state = 'wait';
          c.wait = 0.05 + c.rnd() * 0.3;
        }
        c.mesh.visible = false;
        continue;
      }
      if (c.r >= R_MAX) {                       // улетела за край — рождаем заново
        c.state = 'wait';
        c.wait = 0.05 + c.rnd() * 0.35;
        c.mesh.visible = false;
        continue;
      }

      const m = c.mesh;
      // диск утончается к дыре: обложка прижимается к плоскости
      const y = c.y0 * clamp(c.r / 3.2, 0, 1);
      m.position.set(Math.cos(c.a) * c.r, y, Math.sin(c.a) * c.r);
      m.visible = true;

      /* Ориентация: всегда лицом к камере (обложку должно быть видно), но
         повёрнута так, чтобы растяжение шло вдоль её пути на экране —
         у самого горизонта обложку вытягивает в нить. */
      tmpA.set(-Math.sin(c.a), 0, Math.cos(c.a));               // касательная
      tmpB.copy(m.position).project(camera);
      tmpC.copy(m.position).addScaledVector(tmpA, 0.4).project(camera);
      const ang = Math.atan2(-(tmpC.y - tmpB.y) * S.h, (tmpC.x - tmpB.x) * S.w);
      m.quaternion.copy(camera.quaternion);
      c.face += c.spin * dt;
      m.rotateZ(c.face + ang);

      const stretch = 1 + feed * 1.6 * clamp((HORIZON * 4.4 - c.r) / (HORIZON * 3.6), 0, 1);
      m.scale.set(c.size * stretch, c.size / Math.sqrt(stretch), 1);

      // проявляется из-за горизонта и гаснет, растворяясь у внешнего края
      const born = clamp((c.r - HORIZON) / 0.55, 0, 1);
      const edge = 1 - clamp((c.r - (R_MAX - FADE_EDGE)) / FADE_EDGE, 0, 1);
      const dive = clamp((c.r - HORIZON * 0.9) / 0.5, 0, 1);
      // рядом с раскалённым диском обложка «нагревается»: светлеет и желтеет
      const heat = clamp((3.4 - c.r) / 2.4, 0, 1);
      c.mat.opacity = born * edge * dive * (0.78 + feed * 0.22) * (1 + heat * 0.15);
      c.mat.color.copy(white).lerp(hotColor, heat * 0.35).lerp(S.accentColor, feed * 0.5);
    }
  }

  function updateHero(dt) {
    S.heroT += dt;
    const rise = easeOutBack(clamp(S.heroT / 0.8, 0, 1));
    const grow = easeOutCubic(clamp(S.heroT / 0.5, 0, 1));

    // поднимается из горизонта точно в сторону камеры
    tmpA.copy(camera.position).normalize();
    hero.position.copy(tmpA).multiplyScalar(HORIZON * 0.2 + rise * 2.35);
    hero.quaternion.copy(camera.quaternion);
    hero.rotateY(lerp(-1.0, 0, easeOutBack(clamp(S.heroT / 0.62, 0, 1))));
    hero.rotateX(lerp(0.22, 0, easeOutCubic(clamp(S.heroT / 0.7, 0, 1))));

    const aspect = S.w / S.h;
    const distToCam = Math.max(0.6, camera.position.length() - hero.position.length());
    const visibleH = 2 * distToCam * Math.tan((camera.fov * Math.PI) / 360);
    const size = Math.min(HERO, visibleH * aspect * 0.62);
    const breathe = 1 + Math.sin(S.t * 1.6) * 0.007;
    hero.scale.setScalar(size * grow * breathe);
    heroMat.opacity = grow;

    heroGlow.position.copy(hero.position).multiplyScalar(0.97);   // чуть позади обложки
    heroGlow.quaternion.copy(camera.quaternion);
    heroGlow.scale.setScalar(size * 2.8 * (0.86 + grow * 0.14));
    heroGlowMat.opacity = grow * (0.4 + Math.sin(S.t * 2.1) * 0.12);
  }

  function render(dt) {
    S.t += dt;
    S.pt += dt;
    S.frames += 1;

    /* Реальная длительность кадра: dt сверху обрезан, а нам нужно знать,
       успевает ли машина. Решение принимаем по 20 кадрам, чтобы не дёргаться. */
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (P.last) {
      P.acc += nowMs - P.last;
      P.n += 1;
      if (!P.locked && P.n >= 6) {
        const avg = P.acc / P.n;
        P.acc = 0;
        P.n = 0;
        if (avg > 70) {
          /* Совсем плохо (меньше 16 кадров в секунду): режем сразу и сильно,
             иначе машина утонет раньше, чем качество подберётся. */
          P.steps = Math.max(64, P.steps - 32);
          if (P.steps <= 64 && P.scale > 0.68) { P.scale = Math.max(0.68, P.scale - 0.16); applyScale(); }
        } else if (avg > 30 && (P.steps > 64 || P.scale > 0.72)) {
          if (P.steps > 64) P.steps -= 16;
          else { P.scale = Math.max(0.72, P.scale - 0.1); applyScale(); }
        } else if (avg < 16 && (P.steps < 160 || P.scale < 1)) {
          if (P.scale < 1) { P.scale = Math.min(1, P.scale + 0.12); applyScale(); }
          else P.steps = Math.min(160, P.steps + 12);
        }
      }
    }
    P.last = nowMs;

    /* ---------- куда дует поток и где стоит камера ---------- */
    let tf = 0.1, td = 9.6, tfov = 58, torbit = 0.05;
    if (S.phase === 'idle') { tf = 0.1; td = 9.6; tfov = 58; torbit = 0.05; }
    else if (S.phase === 'spin') { tf = 1; td = 11.4; tfov = 70; torbit = 0.14; }
    else if (S.phase === 'balance') {
      /* Пока трек ищется, дыра дышит: поток плавно ходит от выброса к
         всасыванию и обратно. Косинус начинается с максимума, поэтому
         перехода из разгона не видно — обложки просто перестают разлетаться
         и начинают притягиваться. */
      S.bt += dt;
      tf = 0.78 * Math.cos(S.bt * 1.35);        // полный вдох-выдох ≈ 4,6 с
      td = 10.5; tfov = 64; torbit = 0.08;
    }
    else if (S.phase === 'settle') { tf = -1; td = 8.6; tfov = 56; torbit = 0.2; }
    else if (S.phase === 'top' || S.phase === 'expand') { tf = -0.4; td = 7.4; tfov = 52; torbit = 0.06; }

    // в settle разворот идёт резче — это и есть перелом момента
    S.flow = approach(S.flow, tf, S.phase === 'settle' ? 3.4 : 2.2, dt);
    S.feed = clamp(-S.flow, 0, 1);
    S.dist = approach(S.dist, td, 2.0, dt);
    S.fov = approach(S.fov, tfov, 2.2, dt);
    S.orbit += torbit * dt;

    /* Наклон к плоскости диска дышит: композиция не стоит на месте — то диск
       видно почти с ребра, то он слегка раскрывается. Плюс неспешный крен. */
    const tilt = 0.082 + 0.085 * Math.sin(S.t * 0.21) + S.feed * 0.045;
    const bob = Math.sin(S.t * 0.5) * 0.05;
    camera.position.set(
      Math.sin(S.orbit) * S.dist * Math.cos(tilt),
      S.dist * Math.sin(tilt) + bob,
      Math.cos(S.orbit) * S.dist * Math.cos(tilt),
    );
    camera.lookAt(0, 0, 0);
    camera.rotation.z += Math.sin(S.t * 0.43) * 0.034 + Math.sin(S.t * 0.17) * 0.022;
    camera.fov = S.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();                              // обложкам нужна актуальная матрица

    /* ---------- дыра: шейдеру — всё, что знает сцена ---------- */
    const u = dome.uniforms;
    const heroT = clamp(S.heroT / 0.8, 0, 1);
    u.uTime.value = S.t;
    u.uSpin.value = 4.2 + S.feed * 2.6;              // при всасывании диск крутится злее
    u.uFeed.value = S.feed;
    u.uHeroT.value = heroT;
    u.uAccent.value.copy(S.accentColor);
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    u.uTanHalf.value = Math.tan((camera.fov * Math.PI) / 360);
    u.uAspect.value = camera.aspect;
    u.uTemp.value = 9200 + S.feed * 1900;            // и горячее
    u.uBright.value = 0.62 * (1 + S.feed * 0.5 + heroT * 0.35);
    u.uJet.value = 0.55 * (1 + S.feed * 0.8 + heroT * 1.1);
    u.uRing.value = 0.5 * (1 + S.feed * 0.45);
    u.uHalo.value = 0.24 * (1 + S.feed * 0.6);
    u.uSteps.value = P.steps;

    updateCovers(dt);
    updateFlashes(dt);
    if (hero.visible) updateHero(dt);

    /* Радиус тени горизонта в долях высоты кадра: по нему линза знает,
       насколько сильно гнуть свет, а кольцо Эйнштейна — где ему гореть. */
    const dist = Math.max(0.5, camera.position.length());
    const holeR = HORIZON / (2 * dist * Math.tan((S.fov * Math.PI) / 360));
    const boost = 1 + S.feed * 0.55 + clamp(S.heroT / 0.8, 0, 1) * 0.4;
    const info = post.render(scene, camera, holeR, boost);
    S.calls = info.calls;
    S.tris = info.triangles;

    // обложка выпавшего трека — поверх постобработки, резкой и без искажений
    if (hero.visible) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(heroScene, camera);
      renderer.autoClear = true;
    }
  }

  /** Экранный прямоугольник обложки — отсюда её подхватит DOM-элемент. */
  function coverRect() {
    if (!hero.visible || !S.w) return null;
    hero.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(([cx, cy]) => {
      v.set(cx, cy, 0).applyMatrix4(hero.matrixWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * S.w;
      const y = (-v.y * 0.5 + 0.5) * S.h;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    if (!isFinite(minX) || maxX <= minX) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function dispose() {
    holeGeo.dispose();
    holeMat.dispose();
    dome.dispose();
    coverGeo.dispose();
    covers.forEach((c) => c.mat.dispose());
    artTextures.forEach((t) => t.dispose());
    hero.geometry.dispose();
    S.coverTex?.dispose();
    heroMat.dispose();
    heroGlow.geometry.dispose();
    heroGlowMat.map?.dispose();
    heroGlowMat.dispose();
    flashGeo.dispose();
    flashes.forEach((f) => { f.mat.map?.dispose(); f.mat.dispose(); });
    realTextures.forEach((t) => t.dispose());
    post.dispose();
    renderer.dispose();
  }

  /** Числа для отладки и тестов: сцена действительно рисует, а не пустует. */
  function stats() {
    let live = 0;
    covers.forEach((c) => { if (c.state === 'live') live += 1; });
    return {
      frames: S.frames,
      calls: S.calls,
      triangles: S.tris,
      programs: renderer.info.programs?.length || 0,
      phase: S.phase,
      flow: Number(S.flow.toFixed(2)),
      feed: Number(S.feed.toFixed(2)),
      dist: Number(S.dist.toFixed(1)),
      fov: Number(S.fov.toFixed(1)),
      live,
      swallowed: S.swallowed,
      hero: Number(S.heroT.toFixed(2)),
      steps: P.steps,                    // шагов интегрирования на кадр
      scale: P.scale,                    // во сколько раз урезано разрешение
      art: realTextures.length,          // настоящих обложек в пуле
      pool: artPool.length,
    };
  }

  resize();
  setAccent(accent);
  return { render, resize, setQuality, setPhase, setCover, setAccent, addArt, coverRect, dispose, stats };
}
