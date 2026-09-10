/* Проверка текстов в живом приложении (нужен запущенный dev-сервер и Chromium от Playwright):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-lyrics.mjs          # или npm run test:lyrics:ui
   Проверяет решётку текстов целиком, в браузере и с реальным lrclib.net:
     - панель рендерит строки, активная следует за воспроизведением, клик перематывает;
     - поправка синхронизации сдвигает активную строку;
     - если на сервере текста нет — текст берётся из LRCLIB синхронным (CORS, таймкоды, кэш);
     - подогрев очереди и переключатели в настройках на месте. */

import { chromium } from 'playwright';
import { isNoise } from './e2e-noise.mjs';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !isNoise(m.text())) problems.push(`console.error: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });
await page.waitForFunction(() => !!window.__api, null, { timeout: 10000 });

const QUEEN = { id: 'e2e-queen', title: 'Bohemian Rhapsody (Single Edit)', artist: 'Queen', album: 'A Night at the Opera', duration: 355 };

/* --- запускаем демо-треки и открываем полноэкранный плеер --- */
await page.evaluate(async (song) => {
  const { buildMockLibrary } = await import('/src/lib/mock.js');
  const songs = [song, ...buildMockLibrary().songs.slice(0, 3)];
  await window.__store.getState().playQueue(songs, 0, { type: 'album', name: 'Тест текстов' });
  window.__store.getState().setUI({ nowPlayingOpen: true });
}, QUEEN);
await page.waitForSelector('.lyr p', { timeout: 15000 });

const lines = await page.locator('.lyr p').count();
ok('панель текста показала строки', lines >= 4, `строк: ${lines}`);
const src0 = await page.locator('.lyr-src').innerText();
ok('источник текста подписан', /демо|сервер|LRCLIB/i.test(src0), src0);

/* --- активная строка следует за временем --- */
const activeAt = async () => page.evaluate(() => [...document.querySelectorAll('.lyr p')].findIndex((p) => p.classList.contains('active')));
await page.evaluate(() => window.__store.getState().seek(2));
await page.waitForTimeout(400);
const a1 = await activeAt();
await page.evaluate(() => window.__store.getState().seek(60));
await page.waitForTimeout(600);
const a2 = await activeAt();
ok('подсветка переходит по строкам', a2 > a1, `${a1} → ${a2}`);

/* --- клик по строке перемотает трек --- */
await page.locator('.lyr p').nth(Math.min(3, lines - 1)).click();
await page.waitForTimeout(300);
const t = await page.evaluate(() => window.__store.getState().time);
ok('клик по строке перемотал', t > 5, `time=${t}`);

/* --- поправка синхронизации --- */
const shifted = await page.evaluate(async () => {
  const st = window.__store.getState();
  st.updateSettings({ lyricsOffset: -8 });
  await new Promise((r) => setTimeout(r, 300));
  const idx = [...document.querySelectorAll('.lyr p')].findIndex((p) => p.classList.contains('active'));
  st.updateSettings({ lyricsOffset: 0 });
  await new Promise((r) => setTimeout(r, 300));
  const back = [...document.querySelectorAll('.lyr p')].findIndex((p) => p.classList.contains('active'));
  return { idx, back };
});
ok('поправка −8 с откатывает активную строку назад', shifted.idx < shifted.back, JSON.stringify(shifted));

/* --- сценарий «на сервере текстов нет»: подсказка и кнопка поиска в LRCLIB --- */
await page.evaluate(() => {
  window.__api.localLyrics = async () => null;     // как на реальном сервере без .lrc и тегов
  window.__store.getState().updateSettings({ lrclib: true, lyricsPrefetch: true });
});
await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: false }));
await page.waitForTimeout(200);
await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: true }));
await page.waitForSelector('.np2-empty b', { timeout: 15000 });
const emptyState = await page.locator('.np2-empty').innerText();
ok('без текста на сервере предлагаем поиск в LRCLIB', /Искать на LRCLIB/.test(emptyState), emptyState.slice(0, 90).replace(/\n/g, ' '));
await page.getByRole('button', { name: /Искать на LRCLIB/i }).click();
await page.waitForSelector('.lyr p', { timeout: 40000 });

const netLines = await page.locator('.lyr p').count();
const netSrc = await page.locator('.lyr-src').innerText();
const netFirst = await page.locator('.lyr p').first().innerText();
ok('после поиска текст появился', netLines > 10, `строк: ${netLines}`);
ok('подписан источник LRCLIB и синхронизация', /LRCLIB/i.test(netSrc) && /синхронн/i.test(netSrc), netSrc);
ok('первая строка — реальный текст песни', /real life/i.test(netFirst), netFirst);

await page.evaluate(() => window.__store.getState().seek(75));
await page.waitForTimeout(600);
const netActive = await activeAt();
ok('строки подсвечиваются по времени трека', netActive > 3, `активная: ${netActive}`);

const link = await page.locator('.lyr-link').getAttribute('href');
ok('есть ссылка на страницу текста', typeof link === 'string' && link.includes('lrclib.net/track/'), link || 'нет ссылки');

/* --- найденное кэшируется: тот же трек отдаётся без нового запроса --- */
const cache = await page.evaluate(async (song) => {
  const before = !!window.__api.lyricsReady(song);
  const stats = window.__api.lyricsStats();
  window.__api.clearLyricsCache();
  return { before, after: !!window.__api.lyricsReady(song), sent: stats.sent, hits: stats.hits };
}, QUEEN);
ok('результат лёг в кэш клиента', cache.before === true, JSON.stringify(cache));
ok('кэш текстов можно сбросить', cache.after === false, JSON.stringify(cache));
ok('статистика запросов ведётся', cache.sent > 0 && cache.hits > 0, JSON.stringify(cache));

/* --- getLyrics() целиком: LRCLIB отдаёт синхронные строки по возрастанию --- */
const shaped = await page.evaluate(async (song) => {
  const res = await window.__api.getLyrics({ ...song, id: 'e2e-queen-2' }, { lrclib: true, force: true });
  if (!res) return null;
  const bad = res.lines.filter((l) => typeof l.start !== 'number' || l.start < 0).length;
  const sorted = res.lines.every((l, i, a) => !i || l.start >= a[i - 1].start);
  return { synced: res.synced, source: res.source, n: res.lines.length, bad, sorted, text: res.lines[0].text };
}, QUEEN);
ok('текст синхронный', shaped?.synced === true && shaped?.source === 'lrclib', JSON.stringify(shaped));
ok('у всех строк есть таймкоды', shaped?.bad === 0, `без таймкода: ${shaped?.bad}`);
ok('таймкоды отсортированы', shaped?.sorted === true);
ok('строк больше десяти', (shaped?.n || 0) > 10, `n=${shaped?.n}`);

/* --- предзагрузка очереди --- */
const warmed = await page.evaluate(async () => {
  const st = window.__store.getState();
  await st.prefetchLyrics();
  const stats = window.__api.lyricsStats();
  return { queue: st.queue.length, sent: stats.sent };
});
ok('предзагрузка текстов работает и не падает', warmed.queue > 1 && warmed.sent > 0, JSON.stringify(warmed));

/* --- настройки --- */
await page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true, nowPlayingOpen: false }));
await page.waitForSelector('.modal', { timeout: 5000 });
ok('в настройках есть переключатель LRCLIB', (await page.getByText(/база LRCLIB/i).count()) > 0);
ok('в настройках есть предзагрузка текстов', (await page.getByText(/Готовить тексты заранее/i).count()) > 0);
ok('в настройках есть поправка синхронизации', (await page.getByText(/Поправка синхронизации/i).count()) > 0);

/* шум окружения (HMR-сокет Vite, dev-404, lrclib) отсеивается в момент сбора ошибок */
const realProblems = problems;
ok('в консоли нет ошибок приложения', realProblems.length === 0, realProblems.join(' | '));

await browser.close();
console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
