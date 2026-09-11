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
  makeArtTexture, makeGlowTexture, makeRingTexture, makeStarTexture,
} from './threeKit';
import { createPostFX } from './threePost';

const HORIZON = 1.0;        // радиус горизонта
const DISK_IN = 1.3;        // внутренний край аккреционного диска
const DISK_OUT = 5.8;
const COVERS = 34;
const STARS = 900;
const R_SPAWN = 1.16;       // откуда вылетает обложка
const R_MAX = 10.5;         // где растворяется
const FADE_EDGE = 2.6;      // ширина зоны растворения у внешнего края
const VR_OUT = 3.6;         // скорость выброса
const VR_IN = 4.2;          // скорость всасывания
const HERO = 1.95;          // размер обложки-героя в мире
const ARTS = 8;

/** Аккреционный диск: набор дуг, ярких у внутреннего края. Без единой картинки. */
function makeDiskTexture(THREE, px, seed, hue) {
  const rnd = mulberry(seed);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const o = c.getContext('2d');
  const half = px / 2;

  o.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 1100; i++) {
    const t = rnd() ** 0.62;                            // 0 — внутренний край, 1 — внешний
    const r = half * (0.18 + 0.82 * t);
    const a0 = rnd() * TAU;
    const span = 0.04 + rnd() * 0.55;
    const hot = 1 - t;                                  // у горизонта горячее и ярче
    o.strokeStyle = `hsla(${hue + (rnd() * 46 - 23)} ${22 + hot * 62}% ${44 + hot * 42}% / ${0.04 + hot * 0.34 * rnd()})`;
    o.lineWidth = px * (0.003 + rnd() * 0.016) * (0.45 + t);
    o.beginPath();
    o.arc(half, half, r, a0, a0 + span);
    o.stroke();
  }

  /* Маска: внутри — дыра под горизонт, снаружи — мягкий выход в пустоту.
     Кольцо геометрии начинается с DISK_IN, поэтому всё, что нарисовано ближе
     0.23 радиуса текстуры, всё равно не видно — там и держим чёрное. */
  o.globalCompositeOperation = 'destination-in';
  const g = o.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.2, 'rgba(0,0,0,0)');
  g.addColorStop(0.27, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,.92)');
  g.addColorStop(0.86, 'rgba(0,0,0,.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = g;
  o.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

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
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
  camera.position.set(0, 1.45, 9.6);

  /* Постобработка: линзирование, свечение, тональная компрессия.
     Обложку-героя рисуем отдельным проходом поверх — она не должна
     искажаться линзой: иначе DOM-элемент подхватит её не там, где видно. */
  const post = createPostFX(THREE, renderer, { strength: 0.9, bloom: 1.0, threshold: 0.38, ring: 0.55 });
  const heroScene = new THREE.Scene();
  const dbSize = new THREE.Vector2();

  const accentColor = new THREE.Color(accent);
  const hotColor = new THREE.Color('#ffb066');           // раскалённый внутренний край
  const white = new THREE.Color(0xffffff);

  /* ---------- горизонт: просто чёрная сфера ----------
     Она пишет глубину, поэтому диск и обложки за дырой честно пропадают —
     силуэт получается сам, без единой строчки шейдера. */
  const holeGeo = new THREE.SphereGeometry(HORIZON, 48, 32);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const hole = new THREE.Mesh(holeGeo, holeMat);
  scene.add(hole);

  /* ---------- всё, что всегда смотрит на камеру ---------- */
  const billboard = new THREE.Group();
  scene.add(billboard);

  const haloMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(THREE, 256, [
      [0, 'rgba(255,240,214,.55)'], [0.22, 'rgba(255,196,120,.30)'],
      [0.5, 'rgba(255,150,90,.10)'], [1, 'rgba(255,120,60,0)'],
    ]),
    transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), haloMat);
  halo.position.z = -0.35;
  billboard.add(halo);

  // тонкая «фотонная сфера» — то самое кольцо вокруг чёрного круга
  const photonMat = new THREE.MeshBasicMaterial({
    map: makeRingTexture(THREE, 256, 34),
    transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const photon = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 3.1), photonMat);
  billboard.add(photon);

  // дуга: свет диска, пригнутый гравитацией над горизонтом
  const arcMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(1.44, 0.045, 6, 120, Math.PI * 1.15), arcMat);
  arc.rotation.z = Math.PI * 0.42;
  billboard.add(arc);

  /* ---------- аккреционный диск ---------- */
  const diskMat = new THREE.MeshBasicMaterial({
    map: makeDiskTexture(THREE, 512, 20250911, 26),
    color: hotColor, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const disk = new THREE.Mesh(new THREE.RingGeometry(DISK_IN, DISK_OUT, 160, 1), diskMat);
  disk.rotation.x = -Math.PI / 2;
  scene.add(disk);

  const disk2Mat = new THREE.MeshBasicMaterial({
    map: makeDiskTexture(THREE, 512, 7717, 212),
    color: new THREE.Color('#6ea8ff'), transparent: true, opacity: 0.2,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const disk2 = new THREE.Mesh(new THREE.RingGeometry(DISK_IN * 1.25, DISK_OUT * 1.55, 128, 1), disk2Mat);
  disk2.rotation.x = -Math.PI / 2;
  disk2.rotation.y = 0.2;
  scene.add(disk2);

  /* ---------- звёзды: увлечение пространства вращением дыры ---------- */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(STARS * 3);
  const srnd = mulberry(31337);
  for (let i = 0; i < STARS; i++) {
    const a = srnd() * TAU;
    const b = Math.acos(srnd() * 2 - 1);
    const r = 16 + srnd() * 42;
    starPos[i * 3] = Math.sin(b) * Math.cos(a) * r;
    starPos[i * 3 + 1] = Math.cos(b) * r * 0.7;
    starPos[i * 3 + 2] = Math.sin(b) * Math.sin(a) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.4, map: makeStarTexture(THREE), transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

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
    w: 1, h: 1, frames: 0, swallowed: 0, calls: 0, tris: 0,
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

    const bob = Math.sin(S.t * 0.5) * 0.06;
    camera.position.set(
      Math.sin(S.orbit) * S.dist,
      1.45 + bob + S.feed * 0.25,
      Math.cos(S.orbit) * S.dist,
    );
    camera.lookAt(0, 0, 0);
    camera.rotation.z += Math.sin(S.t * 0.43) * 0.012;      // еле заметный крен
    camera.fov = S.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();                              // обложкам нужна актуальная матрица
    billboard.quaternion.copy(camera.quaternion);

    /* ---------- дыра и диск ---------- */
    disk.rotation.z -= dt * (0.55 + S.feed * 0.9);
    disk2.rotation.z += dt * (0.3 + S.feed * 0.5);
    diskMat.opacity = 0.62 + S.feed * 0.3;
    diskMat.color.copy(hotColor).lerp(S.accentColor, S.feed * 0.45);
    disk2Mat.opacity = 0.24 + S.feed * 0.24;

    const pulse = 1 + Math.sin(S.t * 1.7) * 0.02;
    photon.scale.setScalar((1 + S.feed * 0.1) * pulse);
    photonMat.opacity = 0.75 + S.feed * 0.25;
    halo.scale.setScalar((1 + S.feed * 0.3) * (1 + Math.sin(S.t * 0.9) * 0.02));
    haloMat.opacity = 0.18 + S.feed * 0.24;
    arc.rotation.z += dt * (0.35 + S.feed * 0.8);
    arcMat.opacity = 0.3 + S.feed * 0.4;

    // пространство вокруг увлечено вращением: при всасывании звёзды плывут быстрее
    stars.rotation.y += dt * (0.015 + Math.abs(S.flow) * 0.05 + S.feed * 0.12);
    starMat.opacity = 0.85 * (1 - S.feed * 0.25);

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
    [halo, photon, arc].forEach((m) => { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); });
    [disk, disk2].forEach((m) => { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); });
    starGeo.dispose();
    starMat.map?.dispose();
    starMat.dispose();
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
      art: realTextures.length,          // настоящих обложек в пуле
      pool: artPool.length,
    };
  }

  resize();
  setAccent(accent);
  return { render, resize, setPhase, setCover, setAccent, addArt, coverRect, dispose, stats };
}
