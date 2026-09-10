/* Живая проверка экрана «Недавнее» (нужен dev-сервер и Chromium от Playwright):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-recent.mjs

   Проверяем весь путь: прослушивание засчитывается только после ~20 секунд,
   история группируется по дням, фильтруется, чистится (с «Вернуть»),
   переживает перезапуск, а большая история виртуализируется. */

import { chromium } from 'playwright';
import { isNoise } from './e2e-noise.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const DAY = 86400000;
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

const hist = () => page.evaluate(() => window.__store.getState().playHistory.map((x) => `${x.id}@${x.at}`));
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };

await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 20000 });

/* --- доступ к экрану --- */
ok('в медиатеке есть пункт «Недавнее»', (await page.locator('.lib-row', { hasText: 'Недавнее' }).count()) === 1);
await page.locator('.lib-row', { hasText: 'Недавнее' }).first().click();
await page.waitForFunction(() => location.hash === '#/recent', null, { timeout: 10000 });
ok('открылся экран «Недавнее»', (await page.locator('.hero-title').innerText()).trim() === 'Недавнее');
ok('пустая история — есть объяснение', await page.locator('.center-empty').isVisible());
ok('фильтры по дням на месте', (await page.locator('.action-bar .chip').count()) === 4);
ok('пустая история ничего не играет', await page.locator('.play-fab').isDisabled());

/* --- «сейчас играют» (getNowPlaying) --- */
await page.waitForTimeout(600);
ok('строка «Сейчас играет» показывает данные сервера', (await page.locator('.live-chip').count()) > 0, String(await page.locator('.live-chip').count()));

/* --- правило записи: 20 секунд --- */
await go('#/liked');
await page.waitForSelector('.track-row', { timeout: 15000 });
await page.locator('.track-row').first().locator('.cell-title').dblclick();
await page.waitForFunction(() => window.__store.getState().playing === true, null, { timeout: 10000 });
await page.evaluate(() => window.__store.getState().seek(4));            // 4 секунды — рано
await page.waitForTimeout(300);
ok('короткое прослушивание не записывается', (await hist()).length === 0, (await hist()).join());
ok('короткое прослушивание не считается и по «ended»',
  await page.evaluate(() => window.__store.getState().markPlayed()) === false && (await hist()).length === 0);

await page.evaluate(() => window.__store.getState().seek(25));           // дослушали — записалось
await page.waitForFunction(() => window.__store.getState().playHistory.length === 1, null, { timeout: 5000 });
const rec = await page.evaluate(() => {
  const h = window.__store.getState().playHistory[0];
  const s = window.__store.getState();
  return { id: h.id, title: h.title, cur: s.queue[s.index]?.id, ctx: h.context, keys: Object.keys(h).sort() };
});
ok('после 20 секунд трек попал в историю', rec.id === rec.cur, JSON.stringify(rec));
ok('в записи есть контекст и обложка', Array.isArray(rec.keys) && rec.keys.includes('coverArt') && rec.keys.includes('at'), rec.keys.join(','));
await page.evaluate(() => window.__store.getState().seek(30));           // тот же трек дальше
await page.waitForTimeout(300);
ok('тот же трек не дублируется', (await hist()).length === 1, (await hist()).join());

/* --- экран показывает запись --- */
await go('#/recent');
await page.waitForSelector('.recent-row', { timeout: 10000 });
ok('история видна в списке', (await page.locator('.recent-row').count()) === 1);
ok('заголовок дня — «Сегодня»', (await page.locator('.recent-day .rd-label').first().innerText()) === 'Сегодня');
ok('в шапке счётчик прослушиваний', /1 прослушивание/.test(await page.locator('.hero-sub').innerText()), await page.locator('.hero-sub').innerText());

/* --- большие данные: дни, фильтры, виртуализация --- */
/* 19 дней по 40 записей + один «давний»: раскладка по дням не зависит от часов */
await page.evaluate(async ([DAY]) => {
  const pl = await window.__api.getPlaylist(window.__store.getState().playlists[0].id);
  const src = pl.songs;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const out = [];
  for (let d = 0; d < 19; d++) {
    for (let k = 0; k < 40; k++) {
      const s = src[(d * 40 + k) % src.length];
      out.push({
        id: `${s.id}-h${d}-${k}`, title: `Трек из истории ${d}-${k}`, artist: s.artist, album: s.album,
        albumId: s.albumId, coverArt: s.albumId, duration: 200,
        at: t0 - d * DAY + 9 * 3600000 + k * 600000,
      });
    }
  }
  out.push({ id: 'old', title: 'Давний', artist: 'A', album: 'B', albumId: 'a', duration: 100, at: t0 - 200 * DAY + 3600000 });
  window.__store.getState().restorePlayHistory(out);
}, [DAY]);
await go('#/library');
await go('#/recent');
await page.waitForSelector('.recent-day', { timeout: 10000 });

const big = await page.evaluate(() => ({
  total: window.__store.getState().playHistory.length,
  days: document.querySelectorAll('.recent-day').length,
  rows: document.querySelectorAll('.vlist .track-row').length,
  virtual: !!document.querySelector('.tracks-virtual'),
  scrollH: document.querySelector('.vlist')?.scrollHeight || 0,
  size: Number(document.querySelector('.vlist .track-row')?.getAttribute('aria-setsize')) || 0,
  labels: [...document.querySelectorAll('.recent-day .rd-label')].map((x) => x.textContent),
  first: document.querySelector('.vlist .recent-row .t-name')?.textContent,
}));
ok('большая история виртуализирована', big.virtual && big.rows > 0 && big.rows < 40, JSON.stringify({ v: big.virtual, r: big.rows }));
ok('полное число строк известно списку (треки + заголовки дней)', big.size === 287, `setsize=${big.size}`);
ok('виден заголовок сегодняшнего дня', big.labels[0] === 'Сегодня', JSON.stringify(big.labels));
ok('виртуальный список не теряет заголовки', big.days >= 1, String(big.days));
ok('прокрутка огромной истории возможна', big.scrollH > 10000, String(big.scrollH));

/* фильтры */
const counts = {};
for (const label of ['Сегодня', '7 дней', '30 дней', 'Всё']) {
  await page.locator('.action-bar .chip', { hasText: label }).click();
  await page.waitForTimeout(450);
  counts[label] = await page.evaluate(() => ({
    plays: Number((document.querySelector('.hero-sub')?.innerText.match(/(\d+)\s+прослуш/) || [])[1]) || 0,
    size: Number(document.querySelector('.vlist .track-row')?.getAttribute('aria-setsize')) || 0,
  }));
}
ok('«Сегодня» — 40 записей и один день', counts['Сегодня'].plays === 40 && counts['Сегодня'].size === 41, JSON.stringify(counts['Сегодня']));
ok('«7 дней» — 280 записей и 7 заголовков', counts['7 дней'].plays === 280 && counts['7 дней'].size === 287, JSON.stringify(counts['7 дней']));
ok('«30 дней» — все 19 дней', counts['30 дней'].plays === 760 && counts['30 дней'].size === 779, JSON.stringify(counts['30 дней']));
ok('«Всё» — вся история вместе с давним треком', counts['Всё'].plays === 761 && counts['Всё'].size === 781, JSON.stringify(counts['Всё']));
ok('фильтры упорядочены по объёму', counts['Сегодня'].plays < counts['7 дней'].plays && counts['7 дней'].plays < counts['30 дней'].plays, JSON.stringify(counts));

/* самый старый день подписан датой, а не «Сегодня» */
await page.evaluate(() => { const el = document.querySelector('.vlist'); el.scrollTop = 1e7; });
await page.waitForTimeout(250);
await page.evaluate(() => { const el = document.querySelector('.vlist'); el.scrollTop = 1e7; });
await page.waitForTimeout(400);
const tail = await page.evaluate(() => {
  const el = document.querySelector('.vlist');
  const hs = [...document.querySelectorAll('.vlist .recent-day .rd-label')].map((x) => x.textContent);
  return {
    last: hs[hs.length - 1] || '',
    n: hs.length,
    top: el.scrollTop, h: el.scrollHeight,
    pos: [...document.querySelectorAll('.vlist > *')].slice(-3).map((x) => `${x.className}|${x.getAttribute('aria-posinset')}`),
    rows: document.querySelectorAll('.vlist .track-row').length,
  };
});
ok('давний день подписан датой, а не «Сегодня»', /^\d+\s+[а-яё]+(\s+\d{4})?$/i.test(tail.last), JSON.stringify(tail));

/* играем день */
await page.locator('.action-bar .chip', { hasText: 'Сегодня' }).click();
await page.evaluate(() => { document.querySelector('.vlist').scrollTop = 0; });
await page.waitForTimeout(450);

await page.locator('.recent-day .chip-btn').first().click();
await page.waitForTimeout(700);
const dayPlay = await page.evaluate(() => {
  const s = window.__store.getState();
  return { len: s.queue.length, idx: s.index, ctx: s.context?.name, first: s.queue[0]?.title };
});
ok('«Играть день» берёт треки этого дня', dayPlay.len === 40 && dayPlay.idx === 0, JSON.stringify(dayPlay));
ok('контекст воспроизведения — имя дня', dayPlay.ctx === 'Сегодня', String(dayPlay.ctx));

/* прокрутка внутри списка меняет строки */
const beforeScroll = await page.evaluate(() => document.querySelector('.vlist .recent-row .t-name')?.textContent);
await page.evaluate(() => { document.querySelector('.vlist').scrollTop = 20000; });
await page.waitForTimeout(400);
const afterScroll = await page.evaluate(() => document.querySelector('.vlist .recent-row .t-name')?.textContent);
ok('прокрутка истории показывает другие треки', beforeScroll !== afterScroll, `${beforeScroll} → ${afterScroll}`);
ok('в DOM по-прежнему мало строк', (await page.locator('.vlist .track-row').count()) < 40);

/* удаление записи */
await page.evaluate(() => { location.hash = '#/recent'; window.__store.getState().setUI({}); });
await go('#/library');
await go('#/recent');
await page.locator('.action-bar .chip', { hasText: 'Сегодня' }).click();
await page.waitForTimeout(450);
const victim = await page.evaluate(() => {
  const r = document.querySelector('.vlist .recent-row');
  const t = r.querySelector('.t-name').textContent;
  return { t, at: window.__store.getState().playHistory.find((x) => x.title === t)?.at };
});
await page.locator('.vlist .recent-row').first().locator('.right button').click();
await page.waitForTimeout(400);
const afterRemove = await page.evaluate((at) => window.__store.getState().playHistory.some((x) => x.at === at), victim.at);
ok('крестик убирает запись из истории', afterRemove === false, String(afterRemove));

/* очистка и «Вернуть» */
await page.locator('.action-bar .pill-btn').click();
await page.waitForFunction(() => window.__store.getState().playHistory.length === 0, null, { timeout: 5000 });
ok('«Очистить» обнуляет историю', await page.locator('.center-empty').isVisible());
await page.locator('.toast button', { hasText: 'Вернуть' }).click();
await page.waitForFunction(() => window.__store.getState().playHistory.length > 0, null, { timeout: 5000 });
ok('«Вернуть» из тоста восстанавливает историю', (await hist()).length === 760, String((await hist()).length));

/* перезапуск: история в конфиге */
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__store?.getState?.().booted === true, null, { timeout: 15000 });
const afterReload = await hist();
ok('история переживает перезапуск', afterReload.length === 760, String(afterReload.length));
await go('#/recent');
await page.waitForSelector('.recent-row', { timeout: 10000 });
ok('после перезапуска список снова с заголовками дней',
  (await page.evaluate(() => Number(document.querySelector('.vlist .track-row')?.getAttribute('aria-setsize')) || 0)) >= 200,
  await page.evaluate(() => document.querySelector('.recent-day .rd-label')?.textContent || ''));

/* память можно выключить */
await page.evaluate(() => window.__store.getState().updateSettings({ rememberPlays: false }));
await page.waitForTimeout(300);
ok('выключенная память очищает историю', (await hist()).length === 0, String((await hist()).length));
await go('#/library');
await go('#/recent');
ok('на экране есть подсказка про настройку', await page.locator('.notice').isVisible());
ok('кнопка «Включить» на месте', (await page.locator('.notice .pill-btn').count()) === 1);
await page.locator('.notice .pill-btn').click();
await page.waitForTimeout(300);
ok('подсказка исчезла после включения', (await page.locator('.notice').count()) === 0);

console.log(problems.length ? `\nзамечания консоли:\n${problems.slice(0, 6).join('\n')}` : '\nконсоль чистая');
await browser.close();
process.exit(failed || problems.length ? 1 : 0);
