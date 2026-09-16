/* Проверка блокировки исполнителей в живом приложении (нужен dev-сервер):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-banned.mjs            # или npm run test:banned:ui

   Что проверяем:
     - кнопка на странице исполнителя блокирует и разблокирует его;
     - заблокированный попадает на вкладку «Исполнители»;
     - его треки уходят из списков (альбом) и из очереди;
     - AutoDJ и «далее» по очереди его не подхватывают;
     - меню трека тоже умеет блокировать.
*/

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

/* берём исполнителя с альбомом: по нему удобнее всего считать треки */
const pick = await page.evaluate(() => {
  const albums = window.__api.mock.albums;
  const songs = window.__api.mock.songs;
  for (const al of albums) {
    const own = songs.filter((s) => s.albumId === al.id);
    if (own.length >= 3 && al.artistId) {
      return { artistId: al.artistId, artist: al.artist, albumId: al.id, tracks: own.length };
    }
  }
  return null;
});
if (!pick) { console.log('FAIL в демо-библиотеке не нашлось исполнителя с альбомом'); process.exit(1); }
console.log(`     исполнитель: ${pick.artist}, альбомов/треков в альбоме: ${pick.tracks}`);

const rowsOnAlbum = () => page.evaluate(() => document.querySelectorAll('.tracks .track-row').length);

/* ---------- 1. блокировка со страницы исполнителя ---------- */
await page.goto(`${APP}#/artist/${pick.artistId}`, { waitUntil: 'load' });
await page.waitForSelector('.hero-title');
const btn = page.getByRole('button', { name: /Заблокировать$/ });
ok('на странице исполнителя есть кнопка блокировки', await btn.count() > 0);
await btn.first().click();
await page.waitForTimeout(400);

const banned = await page.evaluate((name) => {
  const st = window.__store.getState();
  return {
    list: (st.settings.bannedArtists || []).map((a) => a.name),
    isBanned: st.isArtistBanned({ name }),
    btn: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /Заблокирован/.test(t)) || '',
  };
}, pick.artist);
ok('исполнитель попал в список заблокированных', banned.list.includes(pick.artist), JSON.stringify(banned.list));
ok('стор подтверждает блокировку', banned.isBanned === true);
ok('кнопка переключилась в «Заблокирован»', /Заблокирован/.test(banned.btn), banned.btn);

/* ---------- 2. он виден на вкладке «Исполнители» ---------- */
await page.goto(`${APP}#/disliked?tab=artists`, { waitUntil: 'load' });
await page.waitForSelector('.tracks .track-row, .center-empty');
const tabArtists = await page.evaluate(() => ({
  title: document.querySelector('.hero-title')?.textContent?.trim() || '',
  rows: [...document.querySelectorAll('.tracks .track-row .t-name')].map((e) => e.textContent.trim()),
  onTab: document.querySelector('.seg-btn.on')?.textContent?.trim() || '',
}));
ok('вкладка «Исполнители» открылась', /Исполнители/.test(tabArtists.onTab), tabArtists.onTab);
ok('заблокированный виден в списке', tabArtists.rows.includes(pick.artist), JSON.stringify(tabArtists.rows));
ok('заголовок страницы — про исполнителей', /Заблокированные исполнители/.test(tabArtists.title), tabArtists.title);

/* ---------- 3. треки ушли из списков ---------- */
await page.goto(`${APP}#/album/${pick.albumId}`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const hidden = await rowsOnAlbum();
ok('трек(и) исполнителя скрыты из альбома', hidden === 0, `строк в списке: ${hidden}`);

const inLists = await page.evaluate((name) => {
  const st = window.__store.getState();
  const songs = window.__api.mock.songs;
  const own = songs.filter((s) => (s.artist || '') === name);
  return {
    all: own.length,
    left: st.filterExcluded(own).length,
    bannedFlag: own.every((s) => st.trackBanned(s)),
  };
}, pick.artist);
ok('фильтр убирает все треки исполнителя', inLists.left === 0, `было ${inLists.all}, осталось ${inLists.left}`);
ok('каждый его трек помечен заблокированным', inLists.bannedFlag === true);

/* ---------- 4. AutoDJ не подхватывает заблокированного ---------- */
await page.evaluate(async () => {
  const st = window.__store.getState();
  await st.playQueue(window.__api.mock.songs.slice(0, 3), 0, { type: 'queue', name: 'старт' });
});
await page.waitForTimeout(600);
/* включение AutoDJ само запускает добор — даём ему закончить, иначе
   следующий вызов упрётся в autodjBusy и вернёт 0 */
await page.evaluate(() => window.__store.getState().setAutoDj({ enabled: true, mode: 'random', buffer: 5 }));
await page.waitForTimeout(1500);
const dj = await page.evaluate(async () => {
  const added = await window.__store.getState().autoDjRefill('more');
  const st = window.__store.getState();
  const tail = st.queue.slice(st.index + 1);   // играющий трек не считаем: его включили руками
  return { added, tail: tail.length, bad: tail.filter((t) => st.trackBanned(t)).length };
});
ok('AutoDJ добрал треки', dj.added > 0, `добавлено ${dj.added}`);
ok('в хвосте AutoDJ нет заблокированного', dj.bad === 0, `таких треков: ${dj.bad} из ${dj.tail}`);
await page.evaluate(() => window.__store.getState().setAutoDj({ enabled: false }));

/* ---------- 5. «далее» перешагивает через заблокированный трек ---------- */
const jump = await page.evaluate(async () => {
  const st = window.__store.getState();
  const songs = window.__api.mock.songs;
  const own = songs.find((s) => st.trackBanned(s));
  const others = songs.filter((s) => !st.trackBanned(s)).slice(0, 2);
  // кладём заблокированный трек в очередь сами: так бывает, если его
  // добавили до блокировки или поставили вручную
  const q = [others[0], own, others[1]];
  window.__store.setState({ queue: q, queueSource: q, index: 0 });
  await new Promise((r) => setTimeout(r, 250));
  const before = window.__store.getState().index;
  await window.__store.getState().next();
  await new Promise((r) => setTimeout(r, 300));
  const after = window.__store.getState().index;
  const cur = window.__store.getState().current();
  return { before, after, artist: cur?.artist || '', banned: own.artist };
});
ok('очередь перешагнула через заблокированный трек', jump.before === 0 && jump.after === 2, `было ${jump.before}, стало ${jump.after}`);
ok('играет не заблокированный исполнитель', jump.artist !== jump.banned, `${jump.artist} против ${jump.banned}`);

/* ---------- 6. блокировка из меню трека (правый клик по строке) ---------- */
await page.goto(`${APP}#/album/${pick.albumId}`, { waitUntil: 'load' });
await page.waitForTimeout(600);
/* снимем бан, чтобы в списке были строки */
await page.evaluate((name) => window.__store.getState().unbanArtist({ name }), pick.artist);
await page.waitForTimeout(500);
const rowArtist = await page.evaluate(() => {
  const el = document.querySelector('.tracks .track-row .t-artist');
  return el ? el.textContent.trim() : '';
});
await page.locator('.tracks .track-row').first().click({ button: 'right' });
await page.waitForSelector('.ctx');
const menuLabels = await page.evaluate(() => [...document.querySelectorAll('.ctx button')].map((b) => b.textContent.trim()));
const banItem = menuLabels.find((t) => /^Заблокировать: /.test(t));
ok('в меню трека есть пункт блокировки исполнителя', !!banItem, menuLabels.slice(0, 8).join(' | '));
await page.locator('.ctx button', { hasText: /^Заблокировать: / }).first().click();
await page.waitForTimeout(400);
const fromMenu = await page.evaluate(() => {
  const st = window.__store.getState();
  return {
    count: (st.settings.bannedArtists || []).length,
    names: (st.settings.bannedArtists || []).map((a) => a.name),
    rows: document.querySelectorAll('.tracks .track-row').length,
  };
});
ok('блокировка из меню трека попала в настройки', fromMenu.count >= 1, JSON.stringify(fromMenu));
ok('после неё список треков опустел', fromMenu.rows === 0, `строк: ${fromMenu.rows}, бан: ${JSON.stringify(fromMenu.names)}, исполнитель строки: ${rowArtist}`);

/* ---------- 7. разблокировка возвращает треки ---------- */
await page.goto(`${APP}#/disliked?tab=artists`, { waitUntil: 'load' });
await page.waitForSelector('.tracks .track-row');
const beforeUnban = await page.evaluate(() => (window.__store.getState().settings.bannedArtists || []).length);
await page.getByRole('button', { name: 'Разблокировать', exact: true }).first().click();
await page.waitForTimeout(300);
const after = await page.evaluate(() => (window.__store.getState().settings.bannedArtists || []).length);
ok('кнопка «Разблокировать» убирает одного', after === beforeUnban - 1, `было ${beforeUnban}, стало ${after}`);

await page.evaluate(() => window.__store.getState().clearBannedArtists());
await page.goto(`${APP}#/album/${pick.albumId}`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const back = await rowsOnAlbum();
ok('после разблокировки треки вернулись в альбом', back > 0, `строк: ${back}`);

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nблокировка исполнителей работает');
await browser.close();
process.exit(failed ? 1 : 0);
