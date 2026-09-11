/* Проверка анимации «Чёрная дыра» (three.js):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-blackhole.mjs
   Главное, что проверяем: обложки сначала вылетают из горизонта (поток > 0),
   потом тот же поток плавно меняет знак и затягивает их обратно (поток < 0) —
   то есть разворот идёт через ноль, а не переключением двух эффектов. */

import { chromium } from 'playwright';
import { watchProblems } from './e2e-noise.mjs';
import { decodePng, brightness, contrast } from './png.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();

async function open({ blockWebGL = false, viewport = { width: 1440, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const problems = watchProblems(page);
  if (blockWebGL) {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (String(type).includes('webgl')) return null;      // как при выключенном ускорении
        return orig.call(this, type, ...rest);
      };
    });
  }
  await page.goto(APP, { waitUntil: 'load' });
  await page.getByRole('button', { name: /демо-библиотеку/i }).click();
  await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });
  return { page, problems };
}

/* ------------------------- 1. основной прогон ------------------------- */
{
  const { page, problems } = await open();
  await page.evaluate(() => window.__store.getState().updateSettings({ rollAnim: 'blackhole' }));
  // без await: rollDice живёт несколько секунд, нам нужно только её запустить
  await page.evaluate(() => { window.__store.getState().rollDice(); });

  await page.waitForSelector('.bh-overlay', { timeout: 5000 });
  ok('оверлей «Чёрной дыры» появился', true);

  /* Сэмплируем с первой же секунды: сцена поднимается асинхронно (three.js
     приезжает отдельным чанком), а выброс начинается сразу после idle. */
  const flows = [];
  const seen = new Set();
  let maxLive = 0;
  let swallowed = 0;
  let heroRect = null;
  let maxFrames = 0;
  let maxCalls = 0;
  let maxTris = 0;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await page.evaluate(() => {
      const s = window.__store.getState();
      const sc = window.__blackhole;
      /* В headless постобработка рисуется программно — кадр идёт секунды, и
         сцена отставала бы от таймеров фаз в разы. Подталкиваем её время сами,
         чтобы проверка смотрела хореографию, а не скорость этого компьютера. */
      if (sc) sc.render(0.2);
      const r = sc?.coverRect?.() || null;
      return {
        ph: s.dice?.phase || null,
        st: sc?.stats?.() || null,
        rect: r ? { w: r.w, h: r.h, x: r.x, y: r.y } : null,
      };
    });
    if (row.ph) seen.add(row.ph);
    if (row.st) {
      flows.push(row.st.flow);
      maxLive = Math.max(maxLive, row.st.live);
      swallowed = Math.max(swallowed, row.st.swallowed);
      maxFrames = Math.max(maxFrames, row.st.frames);
      maxCalls = Math.max(maxCalls, row.st.calls);
      maxTris = Math.max(maxTris, row.st.triangles);
    }
    if (row.rect && (row.ph === 'top' || row.ph === 'expand')) heroRect = row.rect;
    if (!row.ph) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(30);
  }

  ok('three.js сцена жива и рисует', maxFrames > 3 && maxCalls > 0, `кадров ${maxFrames}, вызовов ${maxCalls}`);
  ok('в кадре есть геометрия', maxTris > 0, `треугольников ${maxTris}`);
  ok('обложки вылетали из горизонта', Math.max(...flows) > 0.2, `максимум потока ${Math.max(...flows)}`);
  ok('поток развернулся и затягивает их обратно', Math.min(...flows) < -0.1, `минимум потока ${Math.min(...flows)}`);
  ok('разворот плавный: поток прошёл через ноль', flows.some((f) => Math.abs(f) < 0.25), flows.slice(0, 10).join(' '));
  ok('обложки действительно летали', maxLive > 0, `в полёте было ${maxLive}`);
  ok('дыра их проглотила', swallowed > 0, `съедено ${swallowed}`);
  ok('фазы дошли до разворота и финала', seen.has('settle') && seen.has('top'), [...seen].join(' → '));

  ok('обложка выпавшего трека на экране', !!heroRect && heroRect.w > 60 && heroRect.h > 60, JSON.stringify(heroRect));
  ok('обложка квадратная, без перекоса',
    !!heroRect && Math.abs(heroRect.w - heroRect.h) / Math.max(heroRect.w, heroRect.h) < 0.12,
    JSON.stringify(heroRect));

  const after = await page.evaluate(() => ({
    dice: window.__store.getState().dice,
    npOpen: window.__store.getState().nowPlayingOpen,
    hasTrack: !!window.__store.getState().current(),
    overlay: document.querySelectorAll('.bh-overlay').length,
    prep: document.body.classList.contains('roll-prep') || document.body.classList.contains('roll-handoff'),
  }));
  ok('анимация закрылась', after.dice === null && after.overlay === 0, JSON.stringify(after));
  ok('плеер открыт и трек играет', after.npOpen && after.hasTrack, JSON.stringify(after));
  ok('служебные классы сняты с body', !after.prep, JSON.stringify(after));

  ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));
  await page.close();
}

/* ---------- 2. настоящие обложки и живая картинка ---------- */
{
  // окно меньше: в headless снимок тяжёлого холста идёт секунды
  const { page } = await open({ viewport: { width: 900, height: 600 } });
  await page.evaluate(() => window.__store.getState().updateSettings({ rollAnim: 'blackhole' }));
  let art = 0;

  /* Снимаем по одной фазе за бросок и перепроверяем фазу после снимка: если
     она успела уйти в expand, кадр уже гаснет и судить по нему нельзя. */
  const shoot = async (want) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      // предыдущий бросок должен полностью отпустить стор
      await page.waitForFunction(
        () => !window.__store.getState().randomBusy && !window.__store.getState().dice,
        null, { timeout: 20000 },
      ).catch(() => {});
      await page.evaluate(() => { window.__store.getState().rollDice(); });
      await page.waitForSelector('.bh-canvas', { timeout: 8000 }).catch(() => {});
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        const ph = await page.evaluate(() => window.__store.getState().dice?.phase || null);
        // eslint-disable-next-line no-await-in-loop
        art = Math.max(art, await page.evaluate(() => window.__blackhole?.stats?.().art || 0));
        if (ph === want) {
          // снимаем весь кадр: снимок элемента ждёт стабильности и не успевает
          // за фазой, а оверлей и так занимает всё окно
          // eslint-disable-next-line no-await-in-loop
          const buf = await page.screenshot().catch(() => null);
          // eslint-disable-next-line no-await-in-loop
          const still = await page.evaluate(() => window.__store.getState().dice?.phase || null);
          /* Годится кадр, снятый пока сцена не гаснет: в expand холст уводится
             прозрачностью, и судить по такому кадру уже нельзя. */
          const okPhase = still === want || (want === 'settle' && still === 'top');
          if (buf && okPhase) return buf;
          break;
        }
        if (!ph) break;
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(25);
      }
      await page.evaluate(() => window.__store.getState().skipDice());
      await page.waitForTimeout(400);
    }
    return null;
  };

  const settle = await shoot('settle');
  await page.evaluate(() => window.__store.getState().skipDice());
  await page.waitForTimeout(500);
  const top = await shoot('top');
  await page.evaluate(() => window.__store.getState().skipDice());

  ok('сцена получила настоящие обложки фонотеки', art > 0, `обложек в пуле: ${art}`);
  ok('поймали обе фазы для снимков', !!settle && !!top,
    [settle && 'settle', top && 'top'].filter(Boolean).join(', '));

  for (const [ph, buf] of [['settle', settle], ['top', top]]) {
    if (!buf) continue;
    const img = decodePng(buf);
    const c = contrast(img);
    const mid = brightness(img, { x: 0.42, y: 0.4, w: 0.16, h: 0.2 });
    const edge = brightness(img, { x: 0.05, y: 0.05, w: 0.9, h: 0.1 });
    ok(`кадр «${ph}» не пустой и не плоский`, c.mean > 6 && c.sd > 12,
      `средняя яркость ${c.mean.toFixed(1)}, разброс ${c.sd.toFixed(1)}`);
    ok(`в кадре «${ph}» дыра — смысловой центр`, mid > edge,
      `центр ${mid.toFixed(1)} против ${edge.toFixed(1)} у края`);
  }
  await page.close();
}

/* ---------- 3. дыра дышит: пока трек ищется, обложки ходят в обе стороны ---------- */
{
  const { page, problems } = await open();
  await page.evaluate(() => window.__store.getState().updateSettings({ rollAnim: 'blackhole' }));
  // «сервер думает» полминуты: бросок гарантированно уйдёт в баланс и останется там
  await page.evaluate(() => {
    const orig = window.__api.getRandomSongs.bind(window.__api);
    window.__api.getRandomSongs = (...a) => orig(...a).then((s) => new Promise((r) => setTimeout(() => r(s), 30000)));
  });
  await page.evaluate(() => { window.__store.getState().rollDice(); });
  const balance = await page.waitForFunction(() => window.__store.getState().dice?.phase === 'balance', null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  ok('бросок дошёл до фазы ожидания', balance);

  /* Время сцены ведём сами: в headless постобработка рисуется программно и
     кадр идёт секунды, поэтому на настенные часы опираться нельзя. */
  const samples = [];
  for (let i = 0; i < 26; i++) {
    // eslint-disable-next-line no-await-in-loop
    const f = await page.evaluate(() => {
      const sc = window.__blackhole;
      if (!sc) return null;
      sc.render(0.35);
      return sc.stats().flow;
    });
    if (f != null) samples.push(f);
  }

  const up = Math.max(...samples);
  const down = Math.min(...samples);
  let turns = 0;
  let prev = 0;
  samples.forEach((f) => {
    const sign = f > 0.08 ? 1 : f < -0.08 ? -1 : 0;
    if (sign && prev && sign !== prev) turns += 1;
    if (sign) prev = sign;
  });
  ok('в ожидании обложки вылетают', up > 0.3, `максимум ${up}`);
  ok('и затягиваются обратно — без смены фазы', down < -0.3, `минимум ${down}`);
  ok('поток ходит туда-обратно, а не залипает', turns >= 2, `смен знака: ${turns}`);
  ok('дыхание дыры без ошибок', problems.length === 0, problems.slice(0, 3).join(' | '));
  await page.close();
}

/* --------------------- 4. без WebGL — запасная сцена --------------------- */
{
  const { page, problems } = await open({ blockWebGL: true });
  await page.evaluate(() => window.__store.getState().updateSettings({ rollAnim: 'blackhole' }));
  await page.evaluate(() => { window.__store.getState().rollDice(); });
  await page.waitForSelector('.rv-overlay, .bh-overlay', { timeout: 6000 }).catch(() => {});
  const kind = await page.evaluate(() => (document.querySelector('.bh-overlay') ? 'blackhole'
    : document.querySelector('.rv-overlay') ? 'vinyl' : 'none'));
  ok('без WebGL включилась запасная анимация', kind === 'vinyl', kind);
  const finished = await page.waitForFunction(() => window.__store.getState().dice === null, null, { timeout: 25000 })
    .then(() => true).catch(() => false);
  ok('бросок всё равно доигран до конца', finished);
  ok('без WebGL тоже без ошибок', problems.length === 0, problems.slice(0, 4).join(' | '));
  await page.close();
}

/* ----------------------- 5. переключатель в настройках ----------------------- */
{
  const { page } = await open();
  await page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true }));
  await page.waitForSelector('.modal');
  const has = await page.locator('.seg-btn', { hasText: 'Чёрная дыра' }).count();
  ok('в настройках есть «Чёрная дыра»', has === 1, `${has}`);
  await page.locator('.seg-btn', { hasText: 'Чёрная дыра' }).click();
  const mode = await page.evaluate(() => window.__store.getState().settings.rollAnim);
  ok('режим переключился', mode === 'blackhole', mode);

  // переключатель из пяти кнопок не должен вылезать за модальное окно
  const fits = await page.evaluate(() => {
    const seg = [...document.querySelectorAll('.modal .seg')].find((el) => el.textContent.includes('Чёрная дыра'));
    const modal = document.querySelector('.modal');
    if (!seg || !modal) return null;
    const a = seg.getBoundingClientRect();
    const b = modal.getBoundingClientRect();
    return { inside: a.left >= b.left - 1 && a.right <= b.right + 1, segW: Math.round(a.width), modalW: Math.round(b.width) };
  });
  ok('переключатель помещается в окно настроек', fits && fits.inside, JSON.stringify(fits));
  await page.close();
}

console.log(failed ? `\nПровалено проверок: ${failed}` : '\n«Чёрная дыра» работает');
await browser.close();
process.exit(failed ? 1 : 0);
