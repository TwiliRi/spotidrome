/* HTML-страница «Исключённые треки»:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-page-export.mjs
   Смотрим не только, что файл скачался, но и что он **открывается**: страницу
   загружаем обратно в браузер и проверяем, что она тёмная, строки на месте
   и обложки реально отрисовались. Файл должен жить сам по себе, без сервера. */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const N = 5;                      // сколько треков исключаем для прогона
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const problems = watchProblems(page);

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });

/* Исключаем несколько треков — как будто человек жал на «палец вниз». */
const picked = await page.evaluate((n) => {
  const st = window.__store.getState();
  const songs = window.__api.mock.songs.slice(0, n);
  songs.forEach((s) => st.dislike(s, { silent: true }));
  return songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist, album: s.album }));
}, N);
await page.waitForFunction((n) => window.__store.getState().dislikedIds.size === n, N, { timeout: 10000 });

await page.goto(`${APP}#/disliked`, { waitUntil: 'load' });
await page.waitForSelector('.dis-row', { timeout: 10000 });
ok('исключённые треки видны в списке', (await page.locator('.dis-row').count()) === N,
  `строк ${await page.locator('.dis-row').count()}`);

const btn = page.getByRole('button', { name: /HTML-страница/i });
ok('кнопка «HTML-страница» на месте', await btn.count() > 0);

const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
await btn.click();
const download = await downloadPromise;

const name = download.suggestedFilename();
ok('файл называется по делу', /^spotidrome-disliked-\d{4}-\d{2}-\d{2}\.html$/.test(name), name);

const file = await download.path();
ok('файл сохранён', !!file, String(file));
const html = await fs.readFile(file, 'utf8');

ok('это целая страница', html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>'));
ok('в шапке — название списка', html.includes('<h1>Исключённые треки</h1>'));
ok('сколько треков — в подзаголовке', /<b>5 треков<\/b>/.test(html), html.match(/<p class="sub">.*?<\/p>/)?.[0] || '');
const rows = (html.match(/<li class="row">/g) || []).length;
ok('строк по числу треков', rows === N, `строк ${rows}`);
ok('все треки попали в страницу', picked.every((t) => html.includes(`>${t.title}<`)),
  picked.map((t) => t.title).filter((t) => !html.includes(`>${t.title}<`)).join(', '));
ok('обложки вклеены в файл', /<img class="art" src="data:image\//.test(html));
ok('в файле нет ссылок на сервер', !html.includes('http://') && !html.includes('https://'));
ok('в файле нет скриптов', !/<script/i.test(html));

const toast = await page.locator('.toast').last().textContent().catch(() => '');
ok('плеер сообщил, куда положил файл', /страница готова/i.test(String(toast)), String(toast).slice(0, 90));

/* Главная проверка: файл открывается сам по себе, без приложения и сервера.
   Копируем его под нормальным именем с расширением .html — иначе браузер
   отдаёт скачанный файл как текст и «страница» не рендерится. */
const copy = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'spotidrome-page-')), name);
await fs.copyFile(file, copy);
const view = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const viewProblems = watchProblems(view);
await view.goto(`file://${copy}`, { waitUntil: 'load' });

ok('страница открылась из файла', (await view.title()).includes('Исключённые треки'), await view.title());
const h1 = await view.locator('h1').first().innerText();
ok('заголовок виден', h1.trim() === 'Исключённые треки', h1);
ok('строки отрисованы', (await view.locator('.row').count()) === N, `строк ${await view.locator('.row').count()}`);
ok('номера строк на месте', (await view.locator('.row .n').first().innerText()).trim() === '1');

const bg = await view.evaluate(() => getComputedStyle(document.body).backgroundColor);
ok('фон тёмный — как в Spotify', bg === 'rgb(0, 0, 0)', bg);

const covers = await view.evaluate(() => [...document.querySelectorAll('img.art')]
  .map((img) => ({ w: img.naturalWidth, h: img.naturalHeight })));
ok('обложки загрузились', covers.length === N && covers.every((c) => c.w > 0 && c.h > 0),
  JSON.stringify(covers));

/* «Как в Spotify» — это крупная шапка на градиенте и крупные обложки в строках */
const look = await view.evaluate(() => {
  const hero = document.querySelector('.hero');
  const h1 = document.querySelector('h1');
  const big = document.querySelector('.art-big');
  const art = document.querySelector('.row img.art, .row .art-ph');
  return {
    hero: getComputedStyle(hero).backgroundImage.includes('gradient'),
    h1: parseFloat(getComputedStyle(h1).fontSize),
    big: Math.round(big.getBoundingClientRect().width),
    art: Math.round(art.getBoundingClientRect().width),
    green: getComputedStyle(document.querySelector('.row .title')).color,
  };
});
ok('шапка — крупная, на градиенте', look.hero && look.h1 >= 32 && look.big >= 130, JSON.stringify(look));
ok('обложка в строке — 56 px (как в списке Spotify)', look.art === 56, `${look.art}px`);

const firstRow = await view.locator('.row').first().innerText();
ok('в строке есть и название, и исполнитель', firstRow.split('\n').filter(Boolean).length >= 3,
  JSON.stringify(firstRow));
ok('на странице нет битой картинки', (await view.locator('img.art[src=""]').count()) === 0);
ok('в открытой странице нет ошибок', viewProblems.length === 0, viewProblems.slice(0, 3).join(' | '));

ok('нет ошибок в консоли приложения', problems.length === 0, problems.slice(0, 4).join(' | '));

if (process.env.SHOT) await view.screenshot({ path: `${process.env.SHOT}`, fullPage: false });

await fs.rm(path.dirname(copy), { recursive: true, force: true });

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nHTML-страница для «Исключённых треков» работает');
await browser.close();
process.exit(failed ? 1 : 0);
