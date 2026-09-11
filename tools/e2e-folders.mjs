/* Метка «из какой музыкальной папки трек» в плеере.
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-folders.mjs
   Проверяем, что индекс «альбом → папка» собирается по-настоящему (альбомы
   разных папок не смешиваются), метка совпадает с папкой трека, клик по ней
   ограничивает медиатеку, а когда папка одна — метка и не показывается. */

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

/* ---------- 1. индекс папок ---------- */
const folders = await page.evaluate(() => window.__store.getState().musicFolders.map((f) => f.name));
ok('демо отдаёт несколько папок', folders.length > 1, folders.join(', '));

await page.waitForFunction(() => window.__store.getState().albumFolders?.ready === true, null, { timeout: 20000 })
  .catch(() => {});
const idx = await page.evaluate(() => {
  const i = window.__store.getState().albumFolders;
  const names = new Set();
  i.map.forEach((f) => names.add(f.name));
  return { ready: i.ready, albums: i.map.size, spread: [...names] };
});
ok('индекс «альбом → папка» собран', idx.ready && idx.albums > 0, JSON.stringify(idx));
ok('альбомы раскладываются по разным папкам', idx.spread.length > 1, idx.spread.join(' | '));

/* ---------- 2. метка в плеере ---------- */
await page.evaluate(() => { window.__store.getState().updateSettings({ rollAnim: 'off' }); });
await page.evaluate(() => { window.__store.getState().rollDice(); });
await page.waitForFunction(() => !!window.__store.getState().current(), null, { timeout: 20000 });
await page.waitForTimeout(300);

const bar = await page.evaluate(() => {
  const s = window.__store.getState();
  const t = s.current();
  return {
    want: s.folderOfTrack(t)?.name || null,
    shown: document.querySelector('.pl-folder')?.innerText.trim() || null,
    album: t.album,
  };
});
ok('в нижнем плеере есть метка папки', !!bar.shown, JSON.stringify(bar));
ok('метка совпадает с папкой трека', bar.shown === bar.want, `${bar.shown} ≠ ${bar.want}`);

await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: true }));
await page.waitForTimeout(300);
const np = await page.locator('.np2-tag.folder').innerText();
ok('в полноэкранном плеере та же метка', np.trim() === bar.want, `${np} ≠ ${bar.want}`);

/* ---------- 3. клик ограничивает медиатеку этой папкой ---------- */
await page.locator('.np2-tag.folder').click();
await page.waitForTimeout(700);
const after = await page.evaluate(() => {
  const s = window.__store.getState();
  const folder = s.folderOfTrack(s.current());
  return {
    id: s.settings.musicFolderId,
    folderId: folder?.id ?? null,
    npOpen: s.nowPlayingOpen,
  };
});
ok('клик ограничил библиотеку этой папкой', after.id != null && String(after.id) === String(after.folderId), JSON.stringify(after));
ok('плеер закрылся, чтобы была видна библиотека', after.npOpen === false);

/* ---------- 4. метка меняется вместе с треком ---------- */
await page.evaluate(() => window.__store.getState().setMusicFolder(null, true));
await page.waitForTimeout(400);
const seen = new Set();
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.__store.getState().next(true));
  await page.waitForTimeout(350);
  const cur = await page.evaluate(() => {
    const s = window.__store.getState();
    const t = s.current();
    return { want: s.folderOfTrack(t)?.name || null, shown: document.querySelector('.pl-folder')?.innerText.trim() || null };
  });
  ok(`метка верна после переключения (${i + 1})`, cur.shown === cur.want && !!cur.shown, JSON.stringify(cur));
  if (cur.want) seen.add(cur.want);
}
ok('в очереди попадаются треки из разных папок', seen.size > 1, [...seen].join(' | '));

/* ---------- 5. метка не ломает вёрстку плеера ---------- */
const geom = async () => page.evaluate(() => {
  const bar = document.querySelector('.player').getBoundingClientRect();
  const chip = document.querySelector('.pl-folder')?.getBoundingClientRect();
  const artist = document.querySelector('.pl-left .a')?.getBoundingClientRect();
  return {
    bar: { top: bar.top, bottom: bar.bottom },
    chip: chip && { top: chip.top, bottom: chip.bottom, left: chip.left, h: chip.height },
    artist: artist && { bottom: artist.bottom },
  };
});
const g1 = await geom();
ok('метка помещается в нижнюю панель', !!g1.chip && g1.chip.top >= g1.bar.top && g1.chip.bottom <= g1.bar.bottom, JSON.stringify(g1));
ok('метка не наезжает на исполнителя', !!g1.chip && !!g1.artist && g1.chip.top >= g1.artist.bottom - 1, JSON.stringify(g1));

// самая низкая панель (68 px) — метка всё ещё должна влезать
await page.evaluate(() => {
  const ui = window.__store.getState().settings.ui || {};
  window.__store.getState().updateSettings({ ui: { ...ui, barH: 68 } });
});
await page.waitForTimeout(400);
const g2 = await geom();
ok('метка влезает и в низкую панель', !!g2.chip && g2.chip.top >= g2.bar.top && g2.chip.bottom <= g2.bar.bottom, JSON.stringify(g2));
await page.evaluate(() => {
  const ui = window.__store.getState().settings.ui || {};
  window.__store.getState().updateSettings({ ui: { ...ui, barH: 88 } });
});
await page.waitForTimeout(300);

/* ---------- 6. одна папка — метки нет ---------- */
await page.evaluate(() => {
  const only = window.__store.getState().musicFolders.slice(0, 1);
  window.__store.setState({ musicFolders: only, albumFoldersKey: '' });
  window.__store.getState().loadFolderIndex();
});
await page.waitForTimeout(800);
const single = await page.evaluate(() => ({
  shown: document.querySelectorAll('.pl-folder').length,
  folders: window.__store.getState().musicFolders.length,
}));
ok('когда папка одна, метку не показываем', single.folders === 1 && single.shown === 0, JSON.stringify(single));

/* ---------- 7. кэш индекса ---------- */
await page.reload({ waitUntil: 'load' });
// демо-подключение сохранено — приложение может войти само, без кнопки
const auto = await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 8000 })
  .then(() => true).catch(() => false);
if (!auto) {
  await page.getByRole('button', { name: /демо-библиотеку/i }).click();
  await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });
}
const cached = await page.waitForFunction(() => window.__store.getState().albumFolders?.ready === true, null, { timeout: 4000 })
  .then(() => true).catch(() => false);
const stored = await page.evaluate(() => !!localStorage.getItem('spotidrome.folder-index.v1'));
ok('после перезагрузки индекс берётся из кэша', cached && stored, `ready=${cached} cache=${stored}`);

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nМетка музыкальной папки работает');
await browser.close();
process.exit(failed ? 1 : 0);
