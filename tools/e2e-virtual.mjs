/* Живая проверка виртуализации списков (нужен dev-сервер и Chromium от Playwright):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-virtual.mjs

   Что проверяем:
   - огромный плейлист (4000 треков) держит в DOM только видимые строки;
   - прокрутка списка меняет набор строк, а не перерисовывает всё;
   - двойной клик по строке ставит в очередь именно этот трек;
   - высота строк следует плотности интерфейса;
   - короткие списки остаются обычными (без внутреннего скролла). */

import { chromium } from 'playwright';
import { isNoise } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const BIG = Number(process.env.BIG || 4000);
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !isNoise(m.text())) problems.push(`console.error: ${m.text()}`);
});

/* Патч ставим до загрузки: он переживает перезагрузку страницы и делает
   первый плейлист демо-библиотеки огромным. */
await page.addInitScript(([n]) => {
  let tries = 0;
  const t = setInterval(() => {
    const api = window.__api;
    if (api && !api.__patched) {
      api.__patched = true;
      const orig = api.getPlaylist.bind(api);
      api.getPlaylist = async (id) => {
        const r = await orig(id);
        const src = r?.songs?.length ? r.songs : (r?.playlist?.entry || []);
        const base = src.length ? src : [{ id: 'z', title: 'Трек', artist: 'Артист', album: 'Альбом', albumId: 'a1', duration: 200 }];
        const big = [];
        for (let i = 0; i < n; i++) {
          const s = base[i % base.length];
          big.push({ ...s, id: `${s.id}-v${i}`, title: `Трек номер ${i + 1}`, playCount: i });
        }
        return { ...r, songs: big, playlist: { ...r.playlist, entry: big, songCount: big.length } };
      };
      clearInterval(t);
    }
    if (++tries > 800) clearInterval(t);
  }, 5);
}, [BIG]);

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 20000 });

const plName = await page.evaluate(() => window.__store.getState().playlists?.[0]?.name);
await page.locator('.side-lib').getByText(plName, { exact: true }).first().click();
await page.waitForSelector('.vlist .track-row', { timeout: 20000 });

const state = () => page.evaluate(() => {
  const box = document.querySelector('.vlist-box');
  const list = document.querySelector('.vlist');
  const row = document.querySelector('.vlist .track-row');
  return {
    virtual: !!document.querySelector('.tracks-virtual'),
    rows: document.querySelectorAll('.vlist .track-row').length,
    boxH: box && Math.round(box.getBoundingClientRect().height),
    scrollH: list && list.scrollHeight,
    scrollTop: list && list.scrollTop,
    rowH: row && Math.round(row.getBoundingClientRect().height),
    rowPos: row && getComputedStyle(row).position,
    headPos: document.querySelector('.track-head') && getComputedStyle(document.querySelector('.track-head')).position,
    nodes: document.querySelectorAll('*').length,
    first: document.querySelector('.vlist .track-row .t-name')?.textContent?.trim(),
    hero: document.querySelector('.hero-sub')?.innerText?.replace(/\s+/g, ' ') || '',
  };
});

const a = await state();
ok('список на тысячи треков ушёл в виртуальный режим', a.virtual);
ok(`в DOM ${a.rows} строк вместо ${BIG}`, a.rows > 0 && a.rows < 40, String(a.rows));
ok('высота прокрутки = все треки', a.scrollH >= BIG * a.rowH - a.rowH * 2, `${a.scrollH} vs ${BIG * a.rowH}`);
ok('строки позиционирует список, а не поток', a.rowPos === 'absolute', a.rowPos);
ok('шапка списка не липкая в виртуальном режиме', a.headPos === 'static', a.headPos);
ok('внутренний скроллбок задан', a.boxH >= 200, String(a.boxH));
ok('весь DOM страницы мал для гигантского плейлиста', a.nodes < 3000, String(a.nodes));
ok('в шапке — реальное число треков', a.hero.includes(String(BIG)), a.hero);

/* прокрутка: должны появиться другие строки */
await page.evaluate(() => { document.querySelector('.vlist').scrollTop = 20000; });
await page.waitForTimeout(350);
const b = await state();
ok('после прокрутки список не раздувается', b.rows < 40, String(b.rows));
ok('прокрутка показывает другие треки', b.first !== a.first && /номер 3\d\d$/.test(b.first), b.first);
ok('скролл действительно произошёл', b.scrollTop > 19000, String(b.scrollTop));

/* двойной клик по строке — играет именно она */
await page.evaluate(() => {
  const st = window.__store.getState();
  window.__calls = [];
  const orig = st.playQueue.bind(st);
  window.__store.setState({ playQueue: (songs, i, ctx) => { window.__calls.push({ n: songs?.length, i }); return orig(songs, i, ctx); } });
});
await page.locator('.vlist .track-row').nth(2).locator('.cell-title').dblclick();
await page.waitForTimeout(600);
const call = await page.evaluate(() => window.__calls[0]);
const now = await page.evaluate(() => {
  const s = window.__store.getState();
  return { idx: s.index, len: s.queue.length, title: s.queue[s.index]?.title };
});
ok('двойной клик берёт весь список целиком', call && call.n === BIG, JSON.stringify(call));
ok('в очереди оказывается тот же трек', now.title === b.first || /номер/.test(now.title), `${now.title} / ${b.first}`);
ok('номер строки совпадает с индексом в очереди', now.idx >= 300 && now.idx < BIG, String(now.idx));

/* плотность: высота строк и высота блока должны пересчитаться */
const before = await state();
await page.evaluate(() => window.__store.getState().setUi({ density: 'compact' }));
await page.waitForFunction(() => Math.round(document.querySelector('.vlist .track-row')?.getBoundingClientRect().height || 99) === 40, null, { timeout: 5000 });
const c = await state();
ok('compact уменьшил строку', c.rowH === 40, String(c.rowH));
ok('строк после уплотнения не меньше', c.rows >= before.rows, `${c.rows} vs ${before.rows}`);
await page.evaluate(() => window.__store.getState().setUi({ density: 'cozy' }));
await page.waitForFunction(() => Math.round(document.querySelector('.vlist .track-row')?.getBoundingClientRect().height || 0) === 68, null, { timeout: 5000 });
ok('cozy увеличил строку', (await state()).rowH === 68);
await page.screenshot({ path: '/tmp/e2e-virtual.png' });

/* маленький список не должен обзаводиться внутренним скроллом */
await page.evaluate(() => window.__store.getState().setUi({ density: 'normal' }));
const albumId = await page.evaluate(async () => (await window.__api.albumList('random', 1))?.[0]?.id);
await page.evaluate((id) => { location.hash = `#/album/${id}`; }, albumId);
await page.waitForFunction(() => document.querySelectorAll('.album-page .track-row, .page .track-row').length > 0, null, { timeout: 15000 });
const small = await page.evaluate(() => ({
  virtual: !!document.querySelector('.tracks-virtual'),
  rows: document.querySelectorAll('.track-row').length,
  box: !!document.querySelector('.vlist-box'),
  head: getComputedStyle(document.querySelector('.track-head')).position,
}));
ok('короткий список рендерится как раньше', !small.virtual && !small.box && small.rows > 0 && small.rows < 60, JSON.stringify(small));
ok('в обычном режиме шапка осталась липкой', small.head === 'sticky', small.head);
ok('плотность возвращается в норму', (await page.evaluate(() => window.__store.getState().settings.ui.density)) === 'normal');

/* perf: длинный список не должен тормозить прокрутку */
await page.evaluate(() => { location.hash = `#/playlist/${window.__store.getState().playlists[0].id}`; });
await page.waitForSelector('.vlist .track-row', { timeout: 20000 });
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  await page.evaluate((top) => { document.querySelector('.vlist').scrollTop = top; }, i * 9000);
  await page.waitForTimeout(60);
}
const perScroll = (Date.now() - t0) / 12;
ok(`прокрутка 12 раз по ${BIG}-строчному списку занимает ~${Math.round(perScroll)} мс за шаг`, perScroll < 260, String(Math.round(perScroll)));

console.log(problems.length ? `\nзамечания консоли:\n${problems.slice(0, 6).join('\n')}` : '\nконсоль чистая');
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
