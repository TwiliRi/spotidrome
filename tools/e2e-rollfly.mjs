/* Перелёт обложки в плеер во всех режимах броска.
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-rollfly.mjs
   Регрессия, которую ловим: картинку перелёта забывали *поставить* в точку
   старта — она оставалась в левом верхнем углу оверлея в своём натуральном
   размере и улетала не в плеер, а за край экрана влево-вверх. Поэтому здесь
   проверяется не «картинка есть», а геометрия: откуда летит, куда попадает
   и не вылетает ли по дороге за край окна. */

import { chromium } from 'playwright';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const MODES = process.env.MODE ? process.env.MODE.split(',') : ['vinyl', 'dice', 'cosmos', 'blackhole'];
const FLY = { vinyl: '.rv-fly', dice: '.dice-fly', cosmos: '.cos-fly', blackhole: '.bh-fly' };
const CLS = { vinyl: ['roll-prep', 'roll-handoff'], dice: ['dice-prep', 'dice-handoff'], cosmos: ['roll-prep', 'roll-handoff'], blackhole: ['roll-prep', 'roll-handoff'] };

let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};
const round = (v) => Math.round(v);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = watchProblems(page);

/* Перехват Element.animate: приложение запускает перелёт ровно один раз, и в
   этот момент нам нужен прямоугольник картинки. */
await page.addInitScript(() => {
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    try {
      if (this.classList && [...this.classList].some((c) => /-fly$/.test(c))) {
        const b = this.getBoundingClientRect();
        window.__fly = {
          start: { x: b.x, y: b.y, w: b.width, h: b.height },
          kf: JSON.parse(JSON.stringify(keyframes)),
        };
      }
    } catch { /* снимать нечего — проверка разберётся */ }
    return orig.call(this, keyframes, options);
  };
});

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });

/* Следим за картинкой перелёта изнутри страницы. Фаза длится меньше секунды,
   а «Чёрная дыра» в программном рендерере занимает главный поток на секунды:
   из внешнего опроса (и даже из rAF) такую вспышку легко пропустить. Поэтому
   перехватываем сам вызов animate() — он происходит ровно в момент старта,
   и там же можно снять прямоугольник, от которого картинка полетела. */
const resetFly = () => page.evaluate(() => { window.__fly = null; });

for (const mode of MODES) {
  // eslint-disable-next-line no-await-in-loop
  await page.evaluate((m) => window.__store.getState().updateSettings({ rollAnim: m }), mode);
  // плеер, открытый прошлым броском, перекрывает кнопку — закрываем его Esc
  // eslint-disable-next-line no-await-in-loop
  if (await page.locator('.np2').count()) await page.keyboard.press('Escape');
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(400);
  // eslint-disable-next-line no-await-in-loop
  await resetFly();

  // eslint-disable-next-line no-await-in-loop
  await page.click('.tb-round.dice');
  // eslint-disable-next-line no-await-in-loop
  await page.waitForFunction(() => window.__store.getState().dice === null,
    null, { polling: 200, timeout: 180000 });
  // eslint-disable-next-line no-await-in-loop
  await page.waitForFunction(() => {
    const c = document.querySelector('.np2-cover');
    return c && Number(getComputedStyle(c).opacity) > 0.9;
  }, null, { polling: 100, timeout: 10000 }).catch(() => {});

  // eslint-disable-next-line no-await-in-loop
  const res = await page.evaluate(() => {
    const box = (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const cover = document.querySelector('.np2-cover');
    return {
      fly: window.__fly || null,
      cover: cover ? box(cover) : null,
      opacity: cover ? Number(getComputedStyle(cover).opacity) : 0,
      stray: [...document.querySelectorAll('img')].filter((i) => /-fly\b/.test(i.className)).length,
      cls: [...document.body.classList],
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });

  if (!res.fly) { ok(`${mode}: обложка перелетает в плеер`, false, 'картинка перелёта не запускалась'); continue; }

  const { start, kf } = res.fly;
  const poses = (kf || []).map((k) => {
    const p = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(String(k.transform || ''));
    return p ? { dx: Number(p[1]), dy: Number(p[2]), s: Number(p[3]) } : null;
  }).filter(Boolean);
  if (!poses.length) {
    ok(`${mode}: обложка перелетает в плеер`, false, `непонятные позы: ${JSON.stringify(kf)}`);
    continue;
  }

  const startC = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  // точки пути: центр картинки в каждой позе анимации
  const path = poses.map((p) => ({
    x: startC.x + p.dx, y: startC.y + p.dy, w: start.w * p.s,
  }));
  const land = path[path.length - 1];
  const coverC = res.cover ? { x: res.cover.x + res.cover.w / 2, y: res.cover.y + res.cover.h / 2 } : null;

  // старт не в углу оверлея: картинку поставили туда, где обложка в сцене
  ok(`${mode}: стартует не из угла экрана`, startC.x > 60 && startC.y > 60,
    `центр ${round(startC.x)},${round(startC.y)}`);
  ok(`${mode}: стартовая точка внутри кадра`,
    startC.x < res.vw - 20 && startC.y < res.vh - 20 && start.w < res.vw,
    `прямоугольник ${round(start.x)},${round(start.y)} ${round(start.w)}x${round(start.h)}`);

  // попадает ровно в обложку плеера — промах центра не больше пары пикселей
  const miss = coverC ? Math.hypot(land.x - coverC.x, land.y - coverC.y) : Infinity;
  ok(`${mode}: попадает в обложку плеера`, miss <= 4,
    `центр ${round(land.x)},${round(land.y)} против ${round(coverC?.x)},${round(coverC?.y)} (промах ${round(miss)} px)`);
  const sizeMiss = res.cover ? Math.abs(land.w - res.cover.w) : Infinity;
  ok(`${mode}: прилетает в размер обложки`, sizeMiss <= 4,
    `${round(land.w)}px против ${round(res.cover?.w)}px`);

  /* по дороге картинка не должна вылетать за пределы окна — именно так и
     выглядел баг: обложка уходила влево-вверх и пропадала за краем */
  const gone = path.filter((p) => p.x < -8 || p.y < -8 || p.x > res.vw + 8 || p.y > res.vh + 8);
  ok(`${mode}: по пути не вылетает за край экрана`, gone.length === 0,
    `точек ${path.length}, за краем ${gone.length}: ${gone.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')}`);

  /* после броска ничего не висит: ни картинки, ни служебных классов */
  const left = CLS[mode].filter((c) => res.cls.includes(c));
  ok(`${mode}: перелётная картинка убрана`, res.stray === 0, `осталось ${res.stray}`);
  ok(`${mode}: служебные классы сняты`, left.length === 0, left.join(', '));
  ok(`${mode}: обложка плеера видна`, res.opacity > 0.9, `opacity ${res.opacity}`);

  /* смена трека после броска — обложка не должна никуда улетать */
  // eslint-disable-next-line no-await-in-loop
  await page.evaluate(() => window.__store.getState().next(true));
  // eslint-disable-next-line no-await-in-loop
  await page.waitForTimeout(800);
  // eslint-disable-next-line no-await-in-loop
  const swapped = await page.evaluate(() => {
    const cover = document.querySelector('.np2-cover');
    const b = cover?.getBoundingClientRect();
    return {
      rect: b ? { x: b.x, y: b.y } : null,
      anims: cover ? cover.getAnimations().length : -1,
      transform: cover ? getComputedStyle(cover).transform : null,
    };
  });
  const moved = res.cover && swapped.rect
    ? Math.hypot(swapped.rect.x - res.cover.x, swapped.rect.y - res.cover.y)
    : Infinity;
  ok(`${mode}: смена трека не уносит обложку`, moved < 2 && swapped.anims === 0,
    `сдвиг ${round(moved)} px, анимаций ${swapped.anims}, transform ${swapped.transform}`);
}

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nПерелёт обложки в плеер работает во всех режимах');
await browser.close();
process.exit(failed ? 1 : 0);
