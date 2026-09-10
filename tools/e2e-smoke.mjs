/* Дымовая проверка всех страниц после рефакторинга подписок на стор:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-smoke.mjs
   Заходит на каждую страницу, следит за ошибками в консоли и убеждается,
   что вместо пустоты или бесконечного спиннера появился контент. */

import { chromium } from 'playwright';
import { watchProblems } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = watchProblems(page);

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });
await page.waitForFunction(() => !!window.__api, null, { timeout: 10000 });

const ids = await page.evaluate(() => {
  const api = window.__api;
  return {
    album: api.mock.albums[0].id,
    artist: api.mock.artists[0].id,
    playlist: api.mock.playlists[0]?.id,
    genre: encodeURIComponent(api.mock.songs.find((s) => s.genre)?.genre || 'Rock'),
  };
});

/** @param {string} hash — маршрут; @param {string} sel — селектор контента */
const visit = async (label, hash, sel) => {
  await page.goto(`${APP}#${hash}`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const spinners = await page.locator('.spinner').count();
  const found = await page.locator(sel).count();
  ok(`${label}: контент на месте`, found > 0 && spinners === 0, `элементов: ${found}, спиннеров: ${spinners}`);
};

await visit('Главная', '/', '.card, .tile');
await visit('Медиатека', '/library', '.card');
await visit('Поиск', '/search?q=aurora', '.track-row, .card');
await visit('Альбом', `/album/${ids.album}`, '.hero-title');
await visit('Исполнитель', `/artist/${ids.artist}`, '.hero-title');
await visit('Жанр', `/genre/${ids.genre}`, '.hero-title');
await visit('Любимые', '/liked', '.tracks, .center-empty');
await visit('Недавнее', '/recent', '.tracks, .center-empty');
await visit('Исключённые', '/disliked', '.page, .center-empty');
await visit('Офлайн', '/offline', '.page');
if (ids.playlist) await visit('Плейлист', `/playlist/${ids.playlist}`, '.hero-title, .center-empty');

/* очередь, эквалайзер и настройки открываются и закрываются */
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.evaluate(async () => {
  const { buildMockLibrary } = await import('/src/lib/mock.js');
  await window.__store.getState().playQueue(buildMockLibrary().songs.slice(0, 4), 0, { type: 'album', name: 'Дым' });
});
await page.waitForTimeout(600);
for (const [key, sel, label] of [
  ['queueOpen', '.rightbar', 'панель очереди'],
  ['eqOpen', '.modal', 'эквалайзер'],
  ['layoutOpen', '.modal', 'окно раскладки'],
]) {
  await page.evaluate((k) => window.__store.getState().setUI({ [k]: true }), key);
  await page.waitForTimeout(400);
  const seen = await page.locator(sel).count();
  ok(`${label} открывается`, seen > 0, `элементов: ${seen}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await page.evaluate((k) => window.__store.getState().setUI({ [k]: false }), key);
  await page.waitForTimeout(250);
}

/* эквалайзер: выключенный предусилитель не должен остаться в тракте */
const eqState = await page.evaluate(async () => {
  const s = window.__store.getState();
  s.setEq({ enabled: false, preamp: 8, bands: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] });
  const offGain = window.__engine.preamp ? window.__engine.preamp.gain.value : null;
  s.setEq({ enabled: true });
  const onGain = window.__engine.preamp ? window.__engine.preamp.gain.value : null;
  const band = window.__engine.filters?.[0]?.gain.value ?? null;
  s.setEq({ enabled: false, preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  return { offGain, onGain, band };
});
if (eqState.offGain !== null) {
  ok('при выключенном эквалайзере предусиление не действует', Math.abs(eqState.offGain - 1) < 0.001, JSON.stringify(eqState));
  ok('при включении предусиление возвращается', eqState.onGain > 1.5, JSON.stringify(eqState));
  ok('при включении полосы применены', Math.abs(eqState.band - 3) < 0.001, JSON.stringify(eqState));
} else {
  ok('аудио-граф недоступен в этом окружении (пропуск)', true);
}

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nдымовая проверка чиста');
await browser.close();
process.exit(failed ? 1 : 0);
