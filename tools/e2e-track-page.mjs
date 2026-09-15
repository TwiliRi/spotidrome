/* Кнопка «поделиться» в полноэкранном плеере:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-track-page.mjs
   Проверяем не только, что файл скачался, но и что он **играет**: открываем
   страницу в браузере, жмём «play» и смотрим, что звук пошёл, а текст песни
   подсветил строку по времени. */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
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

/* Ставим первый трек и раскрываем плеер на весь экран. */
const track = await page.evaluate(() => {
  const s = window.__api.mock.songs[0];
  window.__store.getState().playQueue([s], 0);
  return { id: s.id, title: s.title, artist: s.artist, album: s.album };
});
await page.waitForFunction((id) => window.__store.getState().current()?.id === id, track.id, { timeout: 10000 });
await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: true }));
await page.waitForSelector('.np2', { timeout: 10000 });

const share = page.locator('[data-testid="np2-share"]');
ok('в плеере есть кнопка «поделиться»', await share.count() > 0);
ok('у кнопки понятная подсказка',
  /поделиться/i.test(String(await share.getAttribute('title'))), String(await share.getAttribute('title')));

const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
await share.click();
const download = await downloadPromise;

const name = download.suggestedFilename();
ok('имя файла — по треку и дате', /^spotidrome-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/.test(name), name);
const file = await download.path();
const html = await fs.readFile(file, 'utf8');

ok('это целая страница', html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>'));
ok('в шапке — название трека', html.includes(`<h1>${track.title}</h1>`), track.title);
ok('исполнитель на месте', html.includes(`<b>${track.artist}</b>`), track.artist);
ok('звук вклеен в файл', /<audio id="audio"[^>]+src="data:audio\//.test(html));
ok('обложка вклеена в файл', /<img alt="" src="data:image\//.test(html));
ok('в файле нет ссылок на сервер', !html.includes('http://') && !html.includes('https://'));
const lyricLines = (html.match(/<p class="l" data-t="/g) || []).length;
ok('текст песни выгружен построчно', lyricLines >= 5, `строк ${lyricLines}`);
ok('текст помечен как синхронный', html.includes('<section class="lyrics synced">'));

const toast = await page.locator('.toast').last().textContent().catch(() => '');
ok('плеер сказал, что страница готова', /страница готова/i.test(String(toast)), String(toast).slice(0, 100));

/* Главное: файл живёт сам по себе — открываем его и слушаем. */
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spotidrome-track-'));
const copy = path.join(dir, name);
await fs.copyFile(file, copy);
const view = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const viewProblems = watchProblems(view);
await view.goto(`file://${copy}`, { waitUntil: 'load' });

ok('страница открылась из файла', (await view.title()).includes(track.title), await view.title());
const h1 = (await view.locator('h1').first().innerText()).trim();
ok('название трека крупно в шапке', h1 === track.title, h1);
const bg = await view.evaluate(() => getComputedStyle(document.body).backgroundColor);
ok('фон тёмный, как в Spotify', bg === 'rgb(0, 0, 0)', bg);
const hero = await view.evaluate(() => getComputedStyle(document.querySelector('.hero')).backgroundImage);
ok('шапка на градиенте по цвету обложки', hero.includes('linear-gradient'), hero.slice(0, 60));

const rowVisible = await view.locator('#playrow').isVisible();
ok('свой плеер вместо родного: кнопка видна', rowVisible);
ok('родной <audio> спрятан', !(await view.locator('#audio').isVisible()));

/* «в стиле Spotify» — крупная обложка, зелёная кнопка, крупный текст песни */
const look = await view.evaluate(() => ({
  art: Math.round(document.querySelector('.art-big').getBoundingClientRect().width),
  play: Math.round(document.querySelector('.play').getBoundingClientRect().width),
  h1: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
  line: parseFloat(getComputedStyle(document.querySelector('.l')).fontSize),
  green: getComputedStyle(document.querySelector('.play')).backgroundColor,
}));
ok('шапка крупная, кнопка 56 px — как в Spotify', look.art === 232 && look.play === 56 && look.h1 >= 40, JSON.stringify(look));
ok('кнопка «играть» зелёная #1ed760', look.green === 'rgb(30, 215, 96)', look.green);
ok('текст песни набран крупно', look.line >= 20, `${look.line}px`);

/* Громкость: ползунок есть, по умолчанию 10%, и он действительно управляет звуком. */
const vol0 = await view.evaluate(() => ({
  volume: document.getElementById('audio').volume,
  now: document.getElementById('vbar').getAttribute('aria-valuenow'),
  fill: document.getElementById('vfill').style.width,
}));
ok('по умолчанию громкость 10%', Math.abs(vol0.volume - 0.1) < 0.001, JSON.stringify(vol0));
ok('ползунок стоит на 10', vol0.now === '10' && vol0.fill === '10%', JSON.stringify(vol0));
ok('ползунок громкости виден', await view.locator('#vbar').isVisible());

await view.locator('#mute').click();
const muted = await view.evaluate(() => ({
  v: document.getElementById('audio').volume,
  now: document.getElementById('vbar').getAttribute('aria-valuenow'),
  label: document.getElementById('mute').getAttribute('aria-label'),
}));
ok('кнопка выключает звук', muted.v === 0 && muted.now === '0', JSON.stringify(muted));
ok('кнопка теперь «включить звук»', /включить/i.test(String(muted.label)), String(muted.label));

await view.locator('#mute').click();
const back = await view.evaluate(() => document.getElementById('audio').volume);
ok('второй клик возвращает прежнюю громкость', Math.abs(back - 0.1) < 0.001, `${back}`);

const box = await view.locator('#vbar').boundingBox();
await view.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
const dragged = await view.evaluate(() => ({
  v: document.getElementById('audio').volume,
  now: Number(document.getElementById('vbar').getAttribute('aria-valuenow')),
}));
ok('клик по ползунку ставит громкость', dragged.v > 0.5 && dragged.v < 0.7, JSON.stringify(dragged));
ok('цифра на ползунке совпадает со звуком', Math.abs(dragged.now / 100 - dragged.v) < 0.02, JSON.stringify(dragged));

await view.locator('#vbar').press('ArrowLeft');
const keyed = await view.evaluate(() => document.getElementById('audio').volume);
ok('стрелка влево убавляет на 5 процентов', Math.abs((dragged.v - keyed) - 0.05) < 0.02, `${dragged.v} → ${keyed}`);
await view.locator('#vbar').press('Home');
ok('клавиша Home — в ноль', (await view.evaluate(() => document.getElementById('audio').volume)) === 0);
// возвращаем на 10% стрелками — заодно проверяем, что они работают в обе стороны
await view.locator('#vbar').press('ArrowRight');
await view.locator('#vbar').press('ArrowRight');
ok('стрелки возвращают громкость на 10%',
  Math.abs((await view.evaluate(() => document.getElementById('audio').volume)) - 0.1) < 0.001);

const ready = await view.evaluate(() => new Promise((resolve) => {
  const a = document.getElementById('audio');
  if (a.readyState >= 2) return resolve(a.duration);
  a.addEventListener('loadedmetadata', () => resolve(a.duration), { once: true });
  a.addEventListener('error', () => resolve(-1), { once: true });
  setTimeout(() => resolve(a.readyState), 4000);
}));
ok('звук из файла читается', typeof ready === 'number' && ready > 0, `длительность ${ready}`);

await view.locator('#pb').click();
await view.waitForTimeout(700);
const playing = await view.evaluate(() => {
  const a = document.getElementById('audio');
  return { paused: a.paused, t: a.currentTime };
});
ok('кнопка запустила звук', !playing.paused, JSON.stringify(playing));
ok('время идёт', playing.t > 0.1, `currentTime ${playing.t}`);

const moved = await view.evaluate(() => document.getElementById('fill').style.width);
ok('полоса прогресса заполняется', /%$/.test(moved) && parseFloat(moved) > 0, moved);

/* Текст должен подсвечивать строку по времени — как в Spotify.
   Мотаем к последней строке, которая успевает попасть в звук-заглушку. */
const target = await view.evaluate(() => {
  const a = document.getElementById('audio');
  const times = [].slice.call(document.querySelectorAll('.l[data-t]')).map((el) => parseFloat(el.getAttribute('data-t')));
  const fits = times.filter((t) => t + 0.5 < a.duration - 0.2);
  return fits.length ? fits[fits.length - 1] : -1;
});
ok('в демозвук попадает строка текста', target > 0, `цель ${target}`);
const synced = await view.evaluate(async (at) => {
  const a = document.getElementById('audio');
  a.currentTime = at + 0.4;                     // перематываем к этой строке
  await new Promise((r) => setTimeout(r, 900));
  const on = document.querySelectorAll('.l.on');
  return { n: on.length, at: on[0]?.getAttribute('data-t') || '', text: on[0]?.textContent || '' };
}, target);
ok('синхронный текст подсвечивает строку', synced.n === 1, JSON.stringify(synced));
ok('подсвечена та строка, что играет', Math.abs(parseFloat(synced.at) - target) < 0.01, JSON.stringify(synced));
ok('в подсвеченной строке есть слова', synced.text.length > 3, synced.text);

ok('в открытой странице нет ошибок', viewProblems.length === 0, viewProblems.slice(0, 3).join(' | '));
ok('нет ошибок в консоли приложения', problems.length === 0, problems.slice(0, 4).join(' | '));

if (process.env.SHOT) await view.screenshot({ path: process.env.SHOT });
await fs.rm(dir, { recursive: true, force: true });

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nСтраница трека со звуком и текстом работает');
await browser.close();
process.exit(failed ? 1 : 0);
