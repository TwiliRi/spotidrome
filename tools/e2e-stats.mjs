/* Живая проверка экрана «Статистика» (нужен dev-сервер и Chromium от Playwright):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-stats.mjs

   Проверяем: демо-история засеивается, экран открывается из медиатеки,
   крупные цифры и графики рисуются, промежутки переключаются, топы ведут
   на страницы исполнителей и альбомов, воспроизведение запускается. */

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { isNoise } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
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

const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
const count = (sel) => page.locator(sel).count();
const text = async (sel) => (await page.locator(sel).first().innerText()).trim();

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 20000 });

/* --- демо-история засеивается сама --- */
await page.waitForFunction(() => window.__store.getState().playHistory.length > 0, null, { timeout: 15000 });
const seeded = await page.evaluate(() => {
  const st = window.__store.getState();
  return { n: st.playHistory.length, flag: st.settings.demoPlaysSeeded, uniq: new Set(st.playHistory.map((x) => x.id)).size };
});
ok('в демо-режиме история засеяна', seeded.n > 100, JSON.stringify(seeded));
ok('в засеянной истории нет повторов', seeded.uniq === seeded.n);
ok('флаг засева запомнен, чтобы историю не перезаписывать', seeded.flag === true);

/* --- доступ к экрану --- */
const libRow = page.locator('.lib-row', { hasText: 'Статистика' }).first();
ok('в медиатеке есть пункт «Статистика»', (await libRow.count()) === 1);
await libRow.click();
await page.waitForFunction(() => location.hash === '#/stats', null, { timeout: 10000 });
ok('открылся экран «Статистика»', (await text('.hero-title')) === 'Статистика');

/* --- крупные цифры --- */
const big = await text('.shn-value');
ok('крупная цифра показывает время', /\d/.test(big) && /(ч|мин)/.test(big), big);
ok('под цифрой подписан промежуток', /дн|всё/i.test(await text('.shn-cap')), await text('.shn-cap'));
ok('карточек с метриками — четыре', (await count('.stat-card')) === 4);
const kpiValues = await page.locator('.stat-card .sc-value').allInnerTexts();
ok('метрики посчитаны', kpiValues.every((v) => v.trim().length > 0), kpiValues.join(' | '));
ok('время не пустое', /ч|мин/.test(kpiValues[0]), kpiValues[0]);
ok('исполнителей больше одного', Number(kpiValues[2]) > 1, kpiValues[2]);
ok('экран покрашен акцентом', await page.evaluate(() => {
  const el = document.querySelector('.stats-page');
  return /^(#|rgb|hsl)/.test(getComputedStyle(el).getPropertyValue('--accent').trim());
}));

/* --- график по дням --- */
ok('на графике 30 столбцов', (await count('.chart-bars .bar')) === 30, String(await count('.chart-bars .bar')));
const chartH = await page.evaluate(() => document.querySelector('.chart-bars').getBoundingClientRect().height);
ok('график имеет высоту', chartH > 80, String(chartH));
const bars = await page.evaluate(() => [...document.querySelectorAll('.chart-bars .bar')]
  .map((b) => b.getBoundingClientRect().height));
ok('дни отличаются по высоте', Math.max(...bars) > 20 && Math.min(...bars) < Math.max(...bars) * 0.6,
  `max ${Math.max(...bars).toFixed(0)} min ${Math.min(...bars).toFixed(0)}`);
ok('под графиком подписан максимум', /плотный день/.test(await text('.chart-foot')));

/* --- тепловая карта --- */
ok('сетка 7 × 24', (await count('.heat-cell')) === 168, String(await count('.heat-cell')));
ok('подписаны дни недели', (await page.locator('.heat-cap').allInnerTexts()).join(',') === 'пн,вт,ср,чт,пт,сб,вс');
const hot = await page.evaluate(() => [...document.querySelectorAll('.heat-cell')]
  .filter((c) => c.classList.contains('on')).length);
ok('в карте есть заполненные клетки', hot > 10, String(hot));
ok('у заполненной клетки есть подсказка', /:00/.test(await page.locator('.heat-cell.on').first().getAttribute('title')));

/* --- топ исполнителей --- */
const artists = await page.locator('.tl-row').count();
ok('в топе исполнителей до восьми строк', artists > 3 && artists <= 8, String(artists));
const firstArtist = await page.locator('.tl-row').first().locator('.tl-name').innerText();
const widths = await page.evaluate(() => [...document.querySelectorAll('.tl-bar i')].map((i) => i.getBoundingClientRect().width));
ok('полоски топ-исполнителей убывают', widths[0] >= widths[1] && widths[1] >= widths[widths.length - 1],
  widths.map((w) => w.toFixed(0)).join(','));
ok('у первого исполнителя указано время', /ч|мин/.test(await page.locator('.tl-row').first().locator('.tl-meta').innerText()),
  await page.locator('.tl-row').first().locator('.tl-meta').innerText());

/* --- переход на страницу исполнителя --- */
await page.locator('.tl-row').first().locator('.tl-name a').click();
await page.waitForFunction(() => location.hash.startsWith('#/artist/'), null, { timeout: 8000 });
const artistHash = await page.evaluate(() => location.hash);
const artistName = (await text('.hero-title')).trim();
ok('топ-исполнитель ведёт на его страницу', artistHash.startsWith('#/artist/'), artistHash);
ok('на странице тот же исполнитель', artistName === firstArtist.trim(), `${firstArtist} → ${artistName}`);
await go('#/stats');

/* --- топ альбомов --- */
const albums = await page.locator('.alb-card').count();
ok('в топе альбомов до шести карточек', albums > 2 && albums <= 6, String(albums));
ok('у альбома есть обложка', (await count('.alb-card .alb-cover img')) > 0 || (await count('.alb-card .alb-cover .ph')) > 0);
await page.locator('.alb-card').first().click();
await page.waitForFunction(() => location.hash.startsWith('#/album/'), null, { timeout: 8000 });
ok('альбом открывается по клику', true);
await go('#/stats');

/* --- жанры и факты (жанры приходят с сервера — ждём) --- */
await page.waitForTimeout(900);
const genres = await count('.gen-row');
ok('жанры подтянулись с сервера', genres > 0, String(genres));
ok('фактов хотя бы три', (await count('.fact')) >= 3, String(await count('.fact')));
const facts = await page.locator('.fact .fact-value').allInnerTexts();
ok('у фактов есть значения', facts.every((v) => v.trim().length > 0), facts.join(' | '));

/* --- переключение промежутка --- */
const tracks30 = Number((await page.locator('.stat-card .sc-value').nth(1).innerText()).trim());
await page.locator('.action-bar .chip', { hasText: '7 дней' }).click();
await page.waitForTimeout(400);
ok('за 7 дней столбцов семь', (await count('.chart-bars .bar')) === 7, String(await count('.chart-bars .bar')));
const tracks7 = Number((await page.locator('.stat-card .sc-value').nth(1).innerText()).trim());
ok('за 7 дней треков меньше, чем за 30', tracks7 > 0 && tracks7 < tracks30, `${tracks7} / ${tracks30}`);
await page.locator('.action-bar .chip', { hasText: 'Всё время' }).click();
await page.waitForTimeout(400);
const tracksAll = Number((await page.locator('.stat-card .sc-value').nth(1).innerText()).trim());
ok('за всё время треков больше, чем за 30 дней', tracksAll > tracks30, `${tracksAll} / ${tracks30}`);
ok('за всё время напоминаем про размер истории', /сотен/.test(await page.locator('.stats-wrap').innerText()));
await page.locator('.action-bar .chip', { hasText: '30 дней' }).click();
await page.waitForTimeout(300);

/* --- воспроизведение --- */
await page.locator('.play-fab').click();
await page.waitForFunction(() => window.__store.getState().playing === true, null, { timeout: 10000 });
const queue = await page.evaluate(() => {
  const s = window.__store.getState();
  return { q: s.queue.length, ctx: s.context?.type, hist: s.playHistory.length };
});
ok('кнопка играть наполняет очередь', queue.q > 0 && queue.q <= queue.hist, JSON.stringify(queue));
ok('очередь помечена как «статистика»', queue.ctx === 'stats', String(queue.ctx));

/* играем только треки одного исполнителя */
await page.evaluate(() => window.__store.getState().togglePlay());
await page.waitForTimeout(200);
const artistOfFirst = (await page.locator('.tl-row').first().locator('.tl-name').innerText()).trim();
await page.locator('.tl-row').first().locator('.ghost-btn').click();
await page.waitForTimeout(600);
const onlyOne = await page.evaluate(() => {
  const s = window.__store.getState();
  return { n: s.queue.length, names: [...new Set(s.queue.map((t) => t.artist))] };
});
ok('кнопка у исполнителя играет только его треки',
  onlyOne.n > 0 && onlyOne.names.every((n) => n.includes(artistOfFirst) || artistOfFirst.includes(n.split(' feat.')[0])),
  `${artistOfFirst} → ${onlyOne.names.join(' / ')}`);

/* --- пустая история --- */
const snapshot = await page.evaluate(() => window.__store.getState().playHistory);
await page.evaluate(() => window.__store.getState().clearPlayHistory());
await page.waitForTimeout(400);
ok('без истории показываем объяснение', await page.locator('.center-empty').isVisible());
ok('без истории кнопка играть недоступна', await page.locator('.play-fab').isDisabled());
await page.evaluate((list) => window.__store.getState().restorePlayHistory(list), snapshot);
await page.waitForTimeout(400);
ok('после возврата экран снова с цифрами',
  (await count('.center-empty')) === 0 && (await count('.chart-bars .bar')) === 30,
  `${await count('.center-empty')} / ${await count('.chart-bars .bar')}`);

/* --- отдельная HTML-страница --- */
await page.locator('.action-bar .pill-btn').click();
const dl = await page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
ok('кнопка «Страница .html» скачивает файл', !!dl);
if (dl) {
  const name = dl.suggestedFilename();
  ok('имя файла — про статистику', /^spotidrome-stats-\d{4}-\d{2}-\d{2}\.html$/.test(name), name);
  const html = await readFile(await dl.path(), 'utf8').catch(() => '');
  ok('в файле есть заголовок и строки треков',
    html.includes('Моя статистика') && html.includes('<li class="row">'), `${html.length} байт`);
}
await page.waitForTimeout(400);

/* --- демо-история не должна уезжать на настоящий сервер --- */
const dropped = await page.evaluate(() => {
  const st = window.__store.getState();
  const seededAt = st.settings.demoPlaysAt;
  st.recordPlay(window.__api.mock.songs[0], { at: Date.now() });      // как будто реальное прослушивание
  const before = window.__store.getState().playHistory.length;
  const wasDemo = window.__api.demo;
  window.__api.demo = false;                                          // притворяемся настоящим подключением
  const changed = window.__store.getState().dropSeededDemoPlays();
  const after = window.__store.getState().playHistory.length;
  const again = window.__store.getState().dropSeededDemoPlays();       // повторно ничего не чистим
  window.__api.demo = wasDemo;
  return { seededAt, before, after, changed, again, at: window.__store.getState().playHistory[0]?.at };
});
ok('демо-записи выбрасываются при подключении к настоящему серверу',
  dropped.changed === true && dropped.after === 1, JSON.stringify(dropped));
ok('свежее прослушивание при этом остаётся', dropped.at > dropped.seededAt, JSON.stringify(dropped));
ok('повторно историю не чистим', dropped.again === false);

ok('консоль чистая', problems.length === 0, problems.slice(0, 3).join(' | '));

await browser.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nэкран статистики работает');
process.exit(failed ? 1 : 0);
