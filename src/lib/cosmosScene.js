/**
 * Сцена «Космос» — трёхмерная анимация случайного трека на three.js.
 *
 *   idle    — камера дрейфует в туннеле, обложки проявляются из тумана
 *   spin    — разгон: туннель несётся навстречу, обложки вытягиваются в полосы
 *   balance — загрузка затянулась: полёт замедляется, обложки покачиваются
 *   settle  — в конце туннеля загорается портал с выпавшим треком, камера
 *             тормозит, а стены туннеля разлетаются в стороны
 *   top     — обложка разворачивается к камере, туннель растворяется
 *   expand  — обложку подхватывает DOM-элемент и уносит в плеер
 *
 * Фазы совпадают с машиной состояний в сторе (см. rollDice). Сцена не знает
 * про React: компонент только создаёт её, гоняет rAF и сообщает фазу.
 *
 * three.js грузится динамическим import (см. lib/threeKit.js): в основной бандл
 * он не попадает и не замедляет запуск приложения — только сам бросок.
 */

import {
  TAU, clamp, lerp, easeOutCubic, easeOutQuint, easeInOutCubic, easeOutBack, approach,
  mulberry, loadThree, makeArtTexture, makeGlowTexture, makeStarTexture,
} from './threeKit';

/* ------------------------------- сцена ------------------------------- */

const TUNNEL_R = 3.5;      // радиус туннеля
const SEG = 4.4;           // шаг между кольцами обложек
const RINGS = 18;
const PER_RING = 3;
const TILES = RINGS * PER_RING;
const TUNNEL_LEN = RINGS * SEG;
const STARS = 900;
const PORTAL_DIST = 30;    // портал появляется в этом расстоянии от камеры
const FINAL_DIST = 3.05;   // камера останавливается в этом расстоянии от обложки
const COVER_SIZE = 1.62;

export async function createCosmosScene(canvas, { accent = '#1db954' } = {}) {
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

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060b, 0.052);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  camera.position.set(0, 0, 0);

  const accentColor = new THREE.Color(accent);

  /* ---------- туннель обложек ---------- */
  const artTextures = Array.from({ length: 6 }, (_, i) => makeArtTexture(THREE, 256, 1000 + i * 977));
  const tileGeo = new THREE.PlaneGeometry(1.5, 1.5);
  const tiles = [];
  const tileGroup = new THREE.Group();
  scene.add(tileGroup);

  for (let i = 0; i < TILES; i++) {
    const rnd = mulberry(i * 7919 + 13);
    const ring = Math.floor(i / PER_RING);
    const a = (i % PER_RING) / PER_RING * TAU + ring * 0.72;      // спираль, а не сетка
    const dirX = Math.cos(a);
    const dirY = Math.sin(a) * 0.82;                              // туннель чуть сплюснут — так просторнее
    const r0 = TUNNEL_R * (0.86 + rnd() * 0.3);
    const mat = new THREE.MeshBasicMaterial({
      map: artTextures[i % artTextures.length],
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat.color.setHSL((rnd() * 0.12 + 0.5) % 1, 0.18, 0.92);
    const mesh = new THREE.Mesh(tileGeo, mat);
    mesh.position.set(dirX * r0, dirY * r0, -ring * SEG - rnd() * SEG * 0.6);

    /* Обложки «смотрят» внутрь туннеля. Сверху и снизу направление к оси
       совпадает с «вверхом», и lookAt вырождается — там берём другой «вверх».
       Заодно запоминаем, какая локальная ось смотрит вдоль полёта: по ней
       обложка и растягивается в полосу на большой скорости. */
    const steep = Math.abs(Math.cos(a)) < 0.25;
    mesh.up.set(0, steep ? 0 : 1, steep ? 1 : 0);
    mesh.lookAt(0, 0, mesh.position.z);
    mesh.rotateZ((rnd() - 0.5) * 0.5);
    tiles.push({
      mesh, mat, ux: dirX, uy: dirY, r0,
      axis: steep ? 'y' : 'x',                                     // ось растяжения «в полосу»
      phase: rnd() * TAU,
      spin: (rnd() - 0.5) * 0.7,
      delay: rnd() * 0.34,                                         // разлёт — не строем, а волной
      tint: rnd(),
    });
    tileGroup.add(mesh);
  }

  /* ---------- звёзды (пыль) ---------- */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(STARS * 3);
  const starSeed = mulberry(4242);
  for (let i = 0; i < STARS; i++) {
    const a = starSeed() * TAU;
    const r = 0.7 + starSeed() * TUNNEL_R * 1.35;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = Math.sin(a) * r * 0.82;
    starPos[i * 3 + 2] = -starSeed() * TUNNEL_LEN;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.055, map: makeGlowTexture(THREE, 64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]),
    transparent: true, opacity: 0.8, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* ---------- портал с выпавшим треком ---------- */
  const portal = new THREE.Group();
  portal.visible = false;
  scene.add(portal);

  const glowMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(THREE, 256, [
      [0, 'rgba(255,255,255,.85)'], [0.28, 'rgba(255,255,255,.34)'], [1, 'rgba(255,255,255,0)'],
    ]),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  glowMat.color.copy(accentColor);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), glowMat);
  glow.position.z = -0.02;
  portal.add(glow);

  const ringMat = new THREE.MeshBasicMaterial({
    color: accentColor, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.009, 6, 128), ringMat);
  portal.add(ring);

  // пока настоящая обложка не приехала, в портале — абстрактная заглушка:
  // пустой белый квадрат на разгоне выглядел бы как сбой
  const coverMat = new THREE.MeshBasicMaterial({
    map: artTextures[2], transparent: true, opacity: 0, toneMapped: false,
  });
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), coverMat);
  portal.add(cover);

  /* ---------- настоящие обложки из фонотеки ----------
     Туннель строится на рисованных заготовках, но как только приезжают
     настоящие обложки (из кэша — почти сразу), они занимают их места. */
  const realTextures = [];
  let artSlot = 0;

  function addArt(img) {
    if (!img || realTextures.length >= 60) return;
    let tex;
    try {
      tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
    } catch { return; }                       // картинку WebGL не принял — не беда
    realTextures.push(tex);
    if (artSlot < tiles.length) tiles[artSlot].mat.map = tex;
    artSlot += 1;
  }

  /* ---------- состояние ---------- */
  const S = {
    phase: 'idle', t: 0, pt: 0,
    speed: 6, flying: true,
    fov: 62, roll: 0,
    camZ: 0, targetZ: 0,
    burst: -1,                       // < 0 — разлёт не начинался
    portalZ: 0, portalIn: 0,
    growT: 0, arriveT: 0,            // накопительные: фаза меняется, движение — нет
    coverTex: null, accentColor,
    w: 1, h: 1,
    frames: 0,
  };

  const speedNorm = () => clamp((S.speed - 6) / 48, 0, 1);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    S.w = w; S.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setAccent(a) {
    try { S.accentColor = new THREE.Color(a || '#1db954'); } catch { S.accentColor = new THREE.Color('#1db954'); }
    glowMat.color.copy(S.accentColor);
    ringMat.color.copy(S.accentColor);
  }

  function setCover(img) {
    if (!img) return;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    S.coverTex?.dispose?.();
    S.coverTex = tex;
    coverMat.map = tex;
    coverMat.needsUpdate = true;
  }

  function setPhase(phase) {
    S.phase = phase;
    S.pt = 0;
    if (phase === 'settle') {
      // портал ставим впереди по ходу камеры — она к нему и притормозит
      S.flying = false;
      S.portalZ = S.camZ - PORTAL_DIST;
      S.targetZ = S.portalZ + FINAL_DIST;
      S.burst = 0;
      S.growT = 0;
      S.arriveT = 0;
      portal.position.set(0, 0, S.portalZ);
      portal.visible = true;
      portalIn(0);
    }
    if (phase === 'top') S.flying = false;
  }

  /**
   * Обложка в портале: появляется, разворачивается к камере, дышит.
   *
   * Таймеры здесь накопительные, а не «время с начала фазы»: фазы идут одна за
   * другой и сбрасывают счётчик, а движение обложки непрерывно — иначе на
   * переходе top → expand она откатывалась бы обратно, прямо в момент, когда её
   * подхватывает DOM-элемент.
   */
  function portalIn(dt) {
    const late = S.phase === 'settle' || S.phase === 'top' || S.phase === 'expand';
    const front = S.phase === 'top' || S.phase === 'expand';
    if (late) S.growT += dt;
    if (front) S.arriveT += dt;

    const grow = easeOutCubic(clamp(S.growT / 0.45, 0, 1));
    const arrive = easeOutBack(clamp(S.arriveT / 0.62, 0, 1));
    const turn = easeOutBack(clamp(S.arriveT / 0.72, 0, 1));
    const settle = easeOutCubic(clamp(S.growT / 0.8, 0, 1));
    S.portalIn = grow;

    coverMat.opacity = grow;
    glowMat.opacity = grow * 0.5;

    // «геройский» кадр: обложка занимает ~40% высоты, но не вылезает по ширине
    const aspect = S.w / S.h;
    const visibleH = 2 * FINAL_DIST * Math.tan((camera.fov * Math.PI) / 360);
    const size = Math.min(COVER_SIZE, visibleH * aspect * 0.62);
    const hero = lerp(0.93, 1, arrive);
    const breathe = 1 + Math.sin(S.t * 1.7) * 0.006;
    cover.scale.set(size * hero * breathe, size * hero * breathe, 1);

    // разворот к камере с лёгким доводчиком
    cover.rotation.y = lerp(-0.95, 0, turn);
    cover.rotation.x = lerp(0.16, 0, turn);
    cover.position.z = 0.01;

    ring.rotation.z += dt * 0.55;
    ring.scale.setScalar(lerp(1.5, 1, settle));
    const pulse = 0.42 + Math.sin(S.t * 2.3) * 0.14;
    ringMat.opacity = grow * (front ? pulse : 0.22);
    glow.scale.setScalar(lerp(1.25, 1.02, settle) * (1 + Math.sin(S.t * 1.6) * 0.02));
  }

  function updateTiles(dt) {
    const sn = speedNorm();
    const burst = S.burst;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const m = t.mesh;

      if (S.flying) {
        m.position.z += 0;                                  // движется камера, не туннель
        if (m.position.z > S.camZ + 3) m.position.z -= TUNNEL_LEN;   // переносим назад по кругу
      }

      // проявление из тумана и «дыхание» туннеля
      const appear = easeOutCubic(clamp((S.t - t.delay) / 0.9, 0, 1));
      const bob = Math.sin(S.t * 0.9 + t.phase) * 0.06;

      let r = t.r0 + bob;
      let op = appear;
      let spin = t.spin * 0.15 * (0.4 + sn);
      let stretch = 1 + sn * 1.25;

      if (burst >= 0) {
        // стены расходятся волной: чем дальше обложка, тем позже старт
        const b = easeOutQuint(clamp((burst - t.delay) / 0.85, 0, 1));
        r = t.r0 + b * 11;
        op = appear * (1 - easeInOutCubic(clamp((burst - t.delay) / 0.6, 0, 1)));
        spin = t.spin * (0.15 + b * 2.2);
        stretch = lerp(stretch, 1, b);
      }

      m.position.x = t.ux * r;
      m.position.y = t.uy * r;
      // полосы — вдоль полёта: на скорости обложка вытягивается по ходу камеры
      m.scale.set(t.axis === 'x' ? stretch : 1, t.axis === 'y' ? stretch : 1, 1);
      m.rotateZ(spin * dt);
      t.mat.opacity = op * (0.62 + sn * 0.32);
      t.mat.color.setHSL((0.52 + t.tint * 0.14) % 1, 0.16, 0.86 + sn * 0.14);
    }
    starMat.opacity = 0.8 * (burst >= 0 ? Math.max(0, 1 - burst * 1.35) : 1) * (0.5 + sn * 0.6);
  }

  function updateStars() {
    if (!S.flying) return;
    const pos = starGeo.attributes.position;
    const arr = pos.array;
    for (let i = 2; i < arr.length; i += 3) {
      if (arr[i] > S.camZ + 2) arr[i] -= TUNNEL_LEN;
    }
    pos.needsUpdate = true;
  }

  function render(dt) {
    S.t += dt;
    S.pt += dt;
    S.frames += 1;

    /* скорости и «дыхание» камеры по фазе */
    let targetSpeed = 6;
    let targetFov = 62;
    if (S.phase === 'idle') { targetSpeed = 7; targetFov = 62; }
    else if (S.phase === 'spin') { targetSpeed = 54; targetFov = 74; }
    else if (S.phase === 'balance') { targetSpeed = 11; targetFov = 67; }
    else if (S.phase === 'settle' || S.phase === 'top') { targetSpeed = 0; targetFov = 58; }
    else if (S.phase === 'expand') { targetSpeed = 0; targetFov = 58; }

    const rate = S.phase === 'spin' ? 2.4 : 3.2;
    S.speed = approach(S.speed, targetSpeed, rate, dt);
    S.fov = approach(S.fov, targetFov, 2.6, dt);

    if (S.flying) {
      S.camZ -= S.speed * dt;
    } else if (S.phase === 'settle' || S.phase === 'top' || S.phase === 'expand') {
      S.camZ = approach(S.camZ, S.targetZ, 2.7, dt);
    }
    camera.position.z = S.camZ;

    // крен: две волны разной частоты — камера «живая», а не на рельсе
    const sn = speedNorm();
    S.roll = (Math.sin(S.t * 0.7) * 0.022 + Math.sin(S.t * 1.93) * 0.011) * (0.25 + sn);
    camera.rotation.z = S.roll;
    camera.rotation.y = Math.sin(S.t * 0.45) * 0.012 * (1 - sn * 0.6);
    camera.fov = S.fov;
    camera.updateProjectionMatrix();

    if (S.burst >= 0 && S.burst < 1.6) S.burst += dt;

    // туман рассеивается, когда стены разошлись
    const burstFog = S.burst >= 0 ? clamp(S.burst / 1.2, 0, 1) : 0;
    scene.fog.density = lerp(0.052, 0.006, burstFog);

    updateTiles(dt);
    updateStars();
    if (portal.visible) portalIn(dt);

    stars.position.z = 0;
    renderer.render(scene, camera);
  }

  /** Экранный прямоугольник обложки — отсюда её подхватит DOM-элемент. */
  function coverRect() {
    if (!portal.visible || !S.w) return null;
    cover.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(([cx, cy]) => {
      v.set(cx, cy, 0).applyMatrix4(cover.matrixWorld).project(camera);
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
    tileGeo.dispose();
    tiles.forEach((t) => t.mat.dispose());
    artTextures.forEach((t) => t.dispose());
    starGeo.dispose();
    starMat.map?.dispose();
    starMat.dispose();
    glow.geometry.dispose();
    glowMat.map?.dispose();
    glowMat.dispose();
    ring.geometry.dispose();
    ringMat.dispose();
    cover.geometry.dispose();
    S.coverTex?.dispose();
    coverMat.dispose();
    realTextures.forEach((t) => t.dispose());
    renderer.dispose();
  }

  /** Числа для отладки и тестов: сцена действительно рисует, а не пустует. */
  function stats() {
    return {
      frames: S.frames,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length || 0,
      fog: Number(scene.fog.density.toFixed(4)),
      phase: S.phase,
      speed: Number(S.speed.toFixed(1)),
      fov: Number(S.fov.toFixed(1)),
      camZ: Number(S.camZ.toFixed(1)),
      burst: Number(S.burst.toFixed(2)),
      flying: S.flying,
      art: realTextures.length,
    };
  }

  resize();
  setAccent(accent);
  return { render, resize, setPhase, setCover, setAccent, addArt, coverRect, dispose, stats };
}
