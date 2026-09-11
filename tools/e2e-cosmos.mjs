/* Проверка анимации случайного трека «Космос» (three.js):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-cosmos.mjs
   Смотрит, что сцена реально рисуется (draw-вызовы WebGL), фазы идут по очереди,
   в финале обложка из портала улетает в плеер, а без WebGL бросок продолжается
   запасной плоской сценой. */

import { chromium } from 'playwright';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const problems = [];

async function open({ blockWebGL = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const list = watchProblems(page);
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
  return { page, problems: list };
}

/* ------------------------- 1. основной прогон ------------------------- */
{
  const { page, problems } = await open();
  await page.evaluate(() => window.__store.getState().updateSettings({ rollAnim: 'cosmos' }));
  // без await: rollDice живёт несколько секунд, нам нужно только её запустить
  await page.evaluate(() => { window.__store.getState().rollDice(); });

  await page.waitForSelector('.cos-overlay', { timeout: 5000 });
  ok('оверлей «Космоса» появился', true);

  /* Сэмплируем с первой секунды: сцена поднимается асинхронно, а обложки
     сейчас настоящие — первые кадры грузят текстуры и идут медленнее. */
  const seen = new Set();
  let maxFrames = 0;
  let maxCalls = 0;
  let maxTris = 0;
  let art = 0;
  let rect = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await page.evaluate(() => {
      const s = window.__store.getState();
      const sc = window.__cosmos;
      const r = sc?.coverRect?.() || null;
      return {
        ph: s.dice?.phase || null,
        st: sc?.stats?.() || null,
        rect: r ? { w: r.w, h: r.h, x: r.x, y: r.y } : null,
      };
    });
    if (row.ph) seen.add(row.ph);
    if (row.st) {
      maxFrames = Math.max(maxFrames, row.st.frames);
      maxCalls = Math.max(maxCalls, row.st.calls);
      maxTris = Math.max(maxTris, row.st.triangles);
      art = Math.max(art, row.st.art || 0);
    }
    if (row.rect && row.ph === 'top') rect = row.rect;
    if (!row.ph || row.ph === 'expand') break;      // expand проверяем снаружи: там летит обложка
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(40);
  }

  ok('three.js сцена жива и рисует', maxFrames > 8 && maxCalls > 0, `кадров ${maxFrames}, вызовов ${maxCalls}`);
  ok('в кадре есть геометрия', maxTris > 0, `треугольников ${maxTris}`);
  ok('туннель получил настоящие обложки', art > 0, `обложек в пуле: ${art}`);

  ok('прошли разгон полёта', seen.has('spin'), [...seen].join(' → '));
  ok('дошли до портала', seen.has('settle'), [...seen].join(' → '));
  ok('дошли до разворота обложки', seen.has('top'), [...seen].join(' → '));

  // в фазе «top» обложка в портале имеет экранный прямоугольник — из него будет перелёт
  const inView = rect && rect.w > 40 && rect.h > 40
    && rect.x > -rect.w && rect.y > -rect.h
    && rect.x < 1440 && rect.y < 900;
  ok('обложка в портале на экране', !!inView, JSON.stringify(rect));

  await page.waitForSelector('.cos-fly', { timeout: 8000 }).catch(() => {});
  ok('обложка полетела в плеер', (await page.locator('.cos-fly').count()) === 1);

  await page.waitForFunction(() => window.__store.getState().dice === null, null, { timeout: 10000 }).catch(() => {});
  const after = await page.evaluate(() => ({
    dice: window.__store.getState().dice,
    npOpen: window.__store.getState().nowPlayingOpen,
    hasTrack: !!window.__store.getState().current(),
    overlay: document.querySelectorAll('.cos-overlay').length,
  }));
  ok('анимация закрылась', after.dice === null && after.overlay === 0, JSON.stringify(after));
  ok('плеер открыт и трек играет', after.npOpen && after.hasTrack, JSON.stringify(after));

  problems.forEach((p) => problems.push(p));
  ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));
  await page.close();
}

/* --------------------- 2. без WebGL — запасная сцена --------------------- */
{
  const { page, problems } = await open({ blockWebGL: true });
  await page.evaluate(() => window.__store.getState().updateSettings({ rollAnim: 'cosmos' }));
  // без await: rollDice живёт несколько секунд, нам нужно только её запустить
  await page.evaluate(() => { window.__store.getState().rollDice(); });
  await page.waitForSelector('.rv-overlay, .cos-overlay', { timeout: 6000 }).catch(() => {});
  const kind = await page.evaluate(() => document.querySelector('.cos-overlay') ? 'cosmos'
    : document.querySelector('.rv-overlay') ? 'vinyl' : 'none');
  ok('без WebGL включилась запасная анимация', kind === 'vinyl', kind);
  const finished = await page.waitForFunction(() => window.__store.getState().dice === null, null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  ok('бросок всё равно доигран до конца', finished);
  ok('без WebGL тоже без ошибок', problems.length === 0, problems.slice(0, 4).join(' | '));
  await page.close();
}

/* ----------------------- 3. переключатель в настройках ----------------------- */
{
  const { page } = await open();
  await page.goto(`${APP}#/`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true }));
  await page.waitForSelector('.modal');
  const has = await page.locator('.seg-btn', { hasText: 'Космос 3D' }).count();
  ok('в настройках есть «Космос 3D»', has === 1, `${has}`);
  await page.locator('.seg-btn', { hasText: 'Космос 3D' }).click();
  const mode = await page.evaluate(() => window.__store.getState().settings.rollAnim);
  ok('режим переключился', mode === 'cosmos', mode);
  await page.close();
}

console.log(failed ? `\nПровалено проверок: ${failed}` : '\n«Космос» работает');
await browser.close();
process.exit(failed ? 1 : 0);
