/* Проверка исправлений после аудита — в живом приложении (нужен dev-сервер):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-audit.mjs            # или npm run test:audit:ui
   Проверяет то, что нельзя проверить «в лоб» на чистых функциях:
     - клик по обложке в нижнем плеере открывает полноэкранный;
     - горячие клавиши не мешают в открытых окнах и не срабатывают дважды на кнопке;
     - биография исполнителя с сервера не попадает в DOM разметкой (без XSS);
     - «Удалить из плейлиста» убирает именно видимый трек, даже если часть
       треков скрыта как исключённые (раньше уходил сосед);
     - «Скачать все треки» в браузере не осыпает ошибками на каждый трек. */

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

/* состояние стора по ключу (селекторы в evaluate не сериализуются) */
const S = (key) => page.evaluate((k) => window.__store.getState()[k], key);
const act = (fn, arg) => page.evaluate(fn, arg);
/* демо-библиотека живёт на window, а page.goto её затирает — возвращаем */
const withLib = async () => {
  await page.evaluate(async () => {
    if (!window.__lib) {
      const { buildMockLibrary } = await import('/src/lib/mock.js');
      window.__lib = buildMockLibrary();
    }
  });
};

/* ---------- запуск демо-трека ---------- */
await withLib();
await act(async () => {
  await window.__store.getState().playQueue(window.__lib.songs.slice(0, 3), 0, { type: 'album', name: 'Аудит' });
});
await page.waitForTimeout(500);
ok('в демо что-то играет', await S('playing') === true);

/* ---------- 1. обложка в нижнем плеере кликабельна ---------- */
await page.locator('.pl-left img').first().click();
await page.waitForTimeout(500);
ok('клик по обложке в нижнем плеере открыл полноэкранный', await page.locator('.np2').count() === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('Escape закрыл полноэкранный плеер', await page.locator('.np2').count() === 0);

/* ---------- 2. горячие клавиши в открытых окнах ---------- */
await act(() => window.__store.getState().pause());
await page.waitForTimeout(200);
const playingBefore = await S('playing');
const dislikedBefore = await act(() => window.__store.getState().dislikedIds.size);
await act(() => window.__store.getState().setUI({ settingsOpen: true }));
await page.waitForSelector('.modal', { timeout: 5000 });
await page.keyboard.press(' ');
await page.keyboard.press('x');
await page.keyboard.press('d');
await page.waitForTimeout(400);
ok('пробел в окне настроек не трогает воспроизведение', (await S('playing')) === playingBefore);
ok('литеры в окне настроек не дизлайкают и не переключают AutoDJ',
  (await act(() => window.__store.getState().dislikedIds.size)) === dislikedBefore);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('Escape закрывает окно настроек', await page.locator('.modal').count() === 0);

/* та же клавиша в списке — работает */
await page.keyboard.press(' ');
await page.waitForTimeout(350);
ok('снова за окном пробел управляет воспроизведением', (await S('playing')) === !playingBefore);
await page.keyboard.press(' ');
await page.waitForTimeout(300);

/* пробел по сфокусированной кнопке — ровно одно переключение, а не два */
await act(() => window.__store.getState().pause());
await page.waitForTimeout(250);
await page.locator('.pl-play').focus();
await page.keyboard.press(' ');
await page.waitForTimeout(450);
ok('пробел на кнопке «Играть» переключает один раз', (await S('playing')) === true);
await page.keyboard.press(' ');
await page.waitForTimeout(450);
ok('и обратно — один раз', (await S('playing')) === false);

/* ---------- 3. биография исполнителя: только текст ---------- */
await act(() => {
  window.__xss = 0;
  const api = window.__api;
  api.getArtistInfo = async () => ({
    biography: 'Привет <b>мир</b><img src=x onerror="window.__xss=1"><a href="javascript:window.__xss=2">ссылка</a><script>window.__xss=3</scr' + 'ipt>',
    similarArtist: [],
  });
});
await withLib();
const artistId = await act(() => window.__lib.artists[0].id);
await page.goto(`${APP}#/artist/${artistId}`, { waitUntil: 'load' });
await withLib();
await page.evaluate(() => {
  window.__xss = 0;
  window.__api.getArtistInfo = async () => ({
    biography: 'Привет <b>мир</b><img src=x onerror="window.__xss=1"><a href="javascript:window.__xss=2">ссылка</a><script>window.__xss=3</scr' + 'ipt>',
    similarArtist: [],
  });
});
await page.waitForTimeout(1200);
const bioText = await page.locator('.section p').first().innerText().catch(() => '');
ok('биография показана текстом', /Привет/.test(bioText) && /мир/.test(bioText), JSON.stringify(bioText));
ok('разметка из сети не попала в DOM', await page.locator('.section p b, .section p img').count() === 0);
ok('обработчики и javascript:-ссылка не выполнились', (await act(() => window.__xss)) === 0);

/* ---------- 4. «Удалить из плейлиста» убирает нужный трек ---------- */
const pl = await act(async () => {
  const store = window.__store.getState();
  const songs = window.__lib.songs.slice(0, 3);
  const created = await store.createPlaylistWith('Аудит: удаление', songs);
  return { id: created?.id, ids: songs.map((s) => s.id), inMock: window.__api.mock.playlists.find((p) => p.id === created?.id)?.entry.map((s) => s.id) };
});
ok('плейлист создан сразу с треками', JSON.stringify(pl.inMock) === JSON.stringify(pl.ids), JSON.stringify(pl.inMock));

await page.goto(`${APP}#/playlist/${pl.id}`, { waitUntil: 'load' });
await withLib();
await page.waitForTimeout(900);
// скрываем самый первый трек как исключённый — строки сдвигаются относительно сервера
const hidden = pl.ids[0];
await act((id) => window.__store.getState().dislike(window.__lib.songs.find((s) => s.id === id), { silent: true }), hidden);
await page.waitForTimeout(700);
const rows = await page.locator('.track-row').count();
ok('исключённый трек скрыт в списке', rows === 2, `строк: ${rows}`);

await page.locator('.track-row').first().click({ button: 'right' });
await page.waitForTimeout(300);
await page.locator('.ctx button', { hasText: 'Удалить из плейлиста' }).first().click();
await page.waitForTimeout(1200);
const after = await act((id) => window.__api.mock.playlists.find((p) => p.id === id).entry.map((s) => s.id), pl.id);
ok('удалён именно видимый трек, а не сосед сверху', JSON.stringify(after) === JSON.stringify([pl.ids[0], pl.ids[2]]), JSON.stringify(after));
ok('удаление не ломает исключённый трек (он всё ещё в плейлисте)', after.includes(pl.ids[0]));

/* ---------- 5. пакетная загрузка: одна ошибка вместо сотни ---------- */
await act(() => { window.__store.getState().clearDislikes(); });
const toastsBefore = await page.locator('.toast').count();
await withLib();
await page.goto(`${APP}#/album/${await act(() => window.__lib.albums[0].id)}`, { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.locator('.action-bar [title="Скачать альбом"]').click();
await page.waitForTimeout(700);
const toastsAfter = await page.locator('.toast').count();
ok('скачивание в браузере не плодит тост на каждый трек', toastsAfter - toastsBefore <= 1, `тостов: ${toastsBefore} → ${toastsAfter}`);
const toastText = await page.locator('.toast').last().innerText().catch(() => '');
ok('скачивание объясняет, что нужно десктоп-приложение', /десктоп/i.test(toastText), JSON.stringify(toastText));

/* ---------- 6. форматирование длин в живом интерфейсе ---------- */
const longFmt = await act(() => import('/src/lib/util.js').then((m) => [m.fmt(4532), m.fmtLong(3605), m.bytes(2.5 * 1024 ** 4)]));
ok('часы в длительности и размерах', longFmt[0] === '1:15:32' && longFmt[1] === '1 ч 0 мин' && longFmt[2] === '2.5 ТБ', JSON.stringify(longFmt));

ok('в консоли нет ошибок приложения', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nвсе проверки аудита пройдены');
await browser.close();
process.exit(failed ? 1 : 0);
