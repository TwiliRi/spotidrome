/* Автоматическая подгрузка списков: медиатека, жанр, поиск.
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-paging.mjs
   Главное: список не обрывается на первой странице — у края экрана сам
   догружается следующий кусок, повторов нет, а в конце видно, что это всё. */

import { chromium } from 'playwright';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

/** В самый низ. Списки скроллятся не в окне, а в своих контейнерах
    (`.scroll` — страница, `.vlist` — виртуальный список), поэтому крутим
    всё, что нашлось: лишний вызов ничему не мешает. */
const toBottom = (page) => page.evaluate(() => {
  const els = [document.querySelector('.vlist'), document.querySelector('.scroll'), document.scrollingElement];
  for (const el of els) {
    if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
});

/** Крутим до конца, пока не появится пометка «это всё» или не кончится терпение. */
const scrollUntilEnd = async (page, { tries = 14, pause = 450 } = {}) => {
  for (let i = 0; i < tries; i++) {
    if (await page.locator('.paged-end').count()) break;
    // eslint-disable-next-line no-await-in-loop
    await toBottom(page);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(pause);
  }
  await page.waitForTimeout(300);
  return page.locator('.paged-end').first().textContent().catch(() => null);
};

/** Наверх: то же самое, только в обратную сторону. */
const toTop = (page) => page.evaluate(() => {
  for (const el of [document.querySelector('.vlist'), document.querySelector('.scroll'), document.scrollingElement]) {
    if (el) el.scrollTop = 0;
  }
  window.scrollTo(0, 0);
});

const num = (text) => { const m = String(text || '').match(/\d+/); return m ? Number(m[0]) : -1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = watchProblems(page);

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });
await page.waitForFunction(() => !!window.__api?.mock, null, { timeout: 10000 });

const demo = await page.evaluate(() => {
  const byGenre = {};
  for (const s of window.__api.mock.songs) byGenre[s.genre] = (byGenre[s.genre] || 0) + 1;
  const [genre, inGenre] = Object.entries(byGenre).sort((a, b) => b[1] - a[1])[0];
  return { albums: window.__api.mock.albums.length, genre, inGenre };
});

/* ------------------------------ 1. медиатека ------------------------------ */
{
  await page.goto(`${APP}#/library?tab=albums`, { waitUntil: 'load' });
  await page.waitForSelector('.grid .card', { timeout: 15000 });
  await page.waitForTimeout(700);
  const first = await page.locator('.grid .card').count();
  ok('первая страница — не вся фонотека', first > 0 && first < demo.albums,
    `карточек ${first}, альбомов в фонотеке ${demo.albums}`);
  ok('первая страница не пустая', first >= 12, `карточек ${first}`);

  await toBottom(page);
  await page.waitForTimeout(900);
  const second = await page.locator('.grid .card').count();
  ok('у края списка страница догрузилась сама', second > first, `было ${first}, стало ${second}`);

  const end = await scrollUntilEnd(page);
  const all = await page.locator('.grid .card').count();
  ok('догрузились все альбомы', all === demo.albums, `карточек ${all} из ${demo.albums}`);

  const uniq = await page.evaluate(() => {
    // карточка открывается по клику, ссылки в ней нет — считаем по data-id
    const ids = [...document.querySelectorAll('.grid .card')].map((el) => el.dataset.id);
    return { total: ids.length, uniq: new Set(ids).size };
  });
  ok('повторов нет', uniq.total > 0 && uniq.total === uniq.uniq,
    `карточек ${uniq.total}, уникальных ${uniq.uniq}`);
  ok('в конце списка — пометка, что это всё', !!end && num(end) === demo.albums, String(end));

  /* сменили сортировку — список начался заново, а не прибавился к старому */
  await toTop(page);
  await page.waitForTimeout(200);
  await page.selectOption('select', 'alphabeticalByName');
  await page.waitForTimeout(900);
  const afterSort = await page.locator('.grid .card').count();
  ok('смена сортировки перезагружает список', afterSort > 0 && afterSort <= first,
    `карточек ${afterSort} (было ${second})`);

  const end2 = await scrollUntilEnd(page);
  const all2 = await page.locator('.grid .card').count();
  ok('после смены сортировки тоже догружается всё', all2 === demo.albums && num(end2) === demo.albums,
    `карточек ${all2}, пометка «${end2}»`);
}

/* -------------------------------- 2. жанр -------------------------------- */
{
  await page.goto(`${APP}#/genre/${encodeURIComponent(demo.genre)}`, { waitUntil: 'load' });
  await page.waitForSelector('.track-row, .tracks', { timeout: 15000 });
  await page.waitForTimeout(700);
  // список виртуальный: в DOM живёт только видимая часть, поэтому считаем по шапке и пометке
  const shown = num(await page.locator('.hero-sub').first().textContent());
  ok('жанр: первая порция — не весь жанр', shown > 0 && shown < demo.inGenre,
    `показано ${shown} из ${demo.inGenre}`);
  const end = await scrollUntilEnd(page);
  ok(`жанр «${demo.genre}» догрузился до конца`, num(end) === demo.inGenre,
    `пометка «${end}», треков в жанре ${demo.inGenre}`);
  ok('жанр: список больше одной страницы', demo.inGenre > 40, `треков ${demo.inGenre}`);
}

/* ------------------------------- 3. поиск ------------------------------- */
{
  await page.goto(`${APP}#/search?q=a`, { waitUntil: 'load' });
  await page.waitForSelector('.track-row', { timeout: 15000 });
  await page.waitForTimeout(800);
  const expect = await page.evaluate(() => {
    const q = 'a';
    return window.__api.mock.songs
      .filter((s) => (s.title + s.artist + s.album).toLowerCase().includes(q)).length;
  });
  ok('запрос даёт больше одной страницы', expect > 40, `совпадений ${expect}`);
  const end = await scrollUntilEnd(page, { tries: 25, pause: 380 });
  ok('поиск догрузил все найденные треки', num(end) === expect, `пометка «${end}», ожидали ${expect}`);
}

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nАвтоматическая подгрузка страниц работает');
await browser.close();
process.exit(failed ? 1 : 0);
