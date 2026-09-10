/* Проверка трёх правок интерфейса:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-ui-fixes.mjs
   1) слева сверху остались только стрелки — логотипа и названия нет;
   2) заголовок в шапке принадлежит текущей странице: с альбома на главную
      больше не переползает старое название;
   3) «Сейчас играет» на экране «Недавнее» обновляется сразу при переключении,
      а не раз в минуту. */

import { chromium } from 'playwright';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = watchProblems(page);

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });

/* ------------------------- 1. логотип убран ------------------------- */
const brand = await page.evaluate(() => ({
  logo: document.querySelectorAll('.tb-logo').length,
  name: document.querySelectorAll('.tb-name').length,
  text: document.querySelector('.titlebar .tb-left')?.textContent?.trim() || '',
  arrows: document.querySelectorAll('.tb-left .tb-round').length,
}));
ok('логотипа слева сверху нет', brand.logo === 0 && brand.name === 0, JSON.stringify(brand));
ok('вверху слева нет надписи Spotidrome', !/spotidrome/i.test(brand.text), brand.text);
ok('стрелки «назад/вперёд» на месте', brand.arrows === 2, `${brand.arrows}`);

/* ------------- 2. заголовок шапки не переползает на главную ------------- */
const ids = await page.evaluate(() => ({ album: window.__api.mock.albums[0].id }));
await page.goto(`${APP}#/album/${ids.album}`, { waitUntil: 'load' });
await page.waitForSelector('.hero-title');
const albumName = (await page.locator('.hero-title').innerText()).trim();

// прокрутка проявляет шапку — там название альбома и кнопка «играть»
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 420; });
await page.waitForTimeout(500);
const onAlbum = await page.evaluate(() => ({
  title: document.querySelector('.topbar-h1')?.textContent?.trim() || '',
  play: document.querySelectorAll('.topbar-play').length,
}));
ok('на альбоме в шапке его название', onAlbum.title === albumName, `${onAlbum.title} vs ${albumName}`);
ok('на альбоме есть кнопка «играть» в шапке', onAlbum.play === 1, JSON.stringify(onAlbum));

// ушли на главную и прокрутили — чужого названия быть не должно
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 420; });
await page.waitForTimeout(500);
const onHome = await page.evaluate(() => ({
  title: document.querySelector('.topbar-h1')?.textContent?.trim() || '',
  play: document.querySelectorAll('.topbar-play').length,
}));
ok('на главной в шапке нет чужого названия', onHome.title === '', `"${onHome.title}"`);
ok('на главной в шапке нет чужой кнопки «играть»', onHome.play === 0, JSON.stringify(onHome));

// с плейлиста на главную — тот же сценарий, что жаловались
await page.goto(`${APP}#/playlist/pl-0`, { waitUntil: 'load' });
await page.waitForSelector('.hero-title');
const plName = (await page.locator('.hero-title').innerText()).trim();
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 420; });
await page.waitForTimeout(500);
const afterPl = await page.evaluate(() => document.querySelector('.topbar-h1')?.textContent?.trim() || '');
ok('после плейлиста на главной пусто', afterPl === '', `было «${plName}», в шапке «${afterPl}»`);

/* ------------------- 3. «Сейчас играет» обновляется сразу ------------------- */
await page.goto(`${APP}#/recent`, { waitUntil: 'load' });
await page.waitForSelector('.action-bar');

// ставим два трека в очередь — экран «Недавнее» открыт
const titles = await page.evaluate(() => {
  const s = window.__store.getState();
  const [a, b] = window.__api.mock.songs;
  s.playQueue([a, b], 0, { type: 'recent', name: 'Недавнее' });
  return [a.title, b.title];
});
await page.waitForTimeout(400);
const first = await page.evaluate(() => document.querySelector('.live-chip.mine')?.textContent?.trim() || '');
ok('свой трек появился в «сейчас играет»', first.includes(titles[0]), `${first} vs ${titles[0]}`);

// переключаем — строка должна обновиться, не дожидаясь минутного опроса
const t0 = Date.now();
await page.evaluate(() => window.__store.getState().next(true));
await page.waitForFunction(
  (t) => {
    const el = document.querySelector('.live-chip.mine');
    return !!el && el.textContent.includes(t);
  },
  titles[1],
  { timeout: 5000 },
).catch(() => {});
const spent = Date.now() - t0;
const second = await page.evaluate(() => document.querySelector('.live-chip.mine')?.textContent?.trim() || '');
ok('при переключении строка обновилась сразу', second.includes(titles[1]), `${second} vs ${titles[1]}`);
ok('обновление быстрее минутного опроса', spent < 3000, `${spent} мс`);

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

await page.screenshot({ path: '/tmp/e2e-ui-fixes.png' }).catch(() => {});
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nправки интерфейса работают');
await browser.close();
process.exit(failed ? 1 : 0);
