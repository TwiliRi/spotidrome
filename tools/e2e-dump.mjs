/* Выгрузка списка треков в .txt из настроек:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-dump.mjs
   Проверяем не только то, что файл скачался, но и его содержимое: шапка со
   счётчиком, строка «Исполнитель — Название» на каждый трек, без повторов. */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
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

/* Ожидания считаем по демо-данным: сколько треков в фонотеке и сколько
   уникальных пар «исполнитель — название». */
const expect = await page.evaluate(() => {
  const songs = window.__api.mock.songs.filter((s) => String(s.title || '').trim());
  const pairs = new Set(songs.map((s) => `${s.artist} — ${s.title}`));
  return { tracks: songs.length, pairs: pairs.size };
});

await page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true }));
await page.waitForSelector('.modal', { timeout: 10000 });
const row = page.locator('.modal .row', { hasText: 'Список треков' }).first();
ok('в настройках есть строка «Список треков»', await row.count() > 0);
const btn = row.getByRole('button', { name: /выгрузить/i });
ok('кнопка выгрузки на месте', await btn.count() > 0);

const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
await btn.click();
// пока идёт сбор, в строке виден счётчик
await page.waitForTimeout(120);
const hint = await row.locator('.hint').textContent().catch(() => '');
ok('во время сбора виден счётчик', /собираю|готово/i.test(String(hint)), String(hint).trim().slice(0, 80));

const download = await downloadPromise;
const name = download.suggestedFilename();
ok('файл называется по делу', /^spotidrome-tracks-\d{4}-\d{2}-\d{2}\.txt$/.test(name), name);

const file = await download.path();
ok('файл сохранён', !!file, String(file));
const text = await fs.readFile(file, 'utf8');
const lines = text.split('\n');

ok('шапка: что это', lines[0] === `# Spotidrome · список треков: ${expect.tracks}`, lines[0]);
ok('шапка: когда и откуда', /^# \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} · демо-режим$/.test(lines[1] || ''), lines[1]);
ok('после шапки — пустая строка', lines[2] === '', JSON.stringify(lines[2]));
ok('в конце файла перевод строки', text.endsWith('\n'));

const tracks = lines.slice(3).filter((l) => l.length);
ok('в файле все треки фонотеки', tracks.length === expect.tracks,
  `строк ${tracks.length}, треков в фонотеке ${expect.tracks}`);
ok('каждая строка — «Исполнитель — Название»',
  tracks.every((l) => /^[^\s].+ — .+$/.test(l)),
  tracks.find((l) => !/^[^\s].+ — .+$/.test(l)) || '');

// сортировка: по исполнителю, без скачков регистра
const sorted = [...tracks].sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base', numeric: true }));
ok('список отсортирован', JSON.stringify(tracks) === JSON.stringify(sorted),
  `${tracks[0]} … ${tracks[tracks.length - 1]}`);

const uniq = new Set(tracks);
ok('повторов нет', uniq.size === Math.min(expect.tracks, expect.pairs),
  `строк ${tracks.length}, уникальных ${uniq.size}, пар «исполнитель — название» ${expect.pairs}`);

if (process.env.SHOW) console.log(`\n--- ${name}\n${tracks.slice(0, 6).join('\n')}\n…\n${tracks.slice(-3).join('\n')}\n`);

const toast = await page.locator('.toast').last().textContent().catch(() => '');
ok('плеер сообщил, куда положил файл', /выгружено/i.test(String(toast)), String(toast).slice(0, 90));

// повторная выгрузка не ломает интерфейс
await page.waitForTimeout(400);
const btn2 = row.getByRole('button', { name: /выгрузить/i });
ok('после выгрузки кнопка снова рабочая', await btn2.count() > 0 && await btn2.isEnabled());
const hint2 = await row.locator('.hint').textContent().catch(() => '');
ok('в строке написано, сколько выгрузили', /готово/i.test(String(hint2)), String(hint2).trim().slice(0, 80));

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВыгрузка списка треков работает');
await browser.close();
process.exit(failed ? 1 : 0);
