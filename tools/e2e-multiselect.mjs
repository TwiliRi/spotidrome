/* Проверка мультивыбора в списке треков и перетаскивания плейлистов:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-multiselect.mjs
   Проверяет: Shift/Ctrl/Ctrl+A, панель действий, пачковое «в очередь» и
   «удалить из плейлиста», а также перенос плейлиста мышью в медиатеке. */

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

/* ------------------------- 1. мультивыбор треков ------------------------- */
await page.goto(`${APP}#/playlist/pl-0`, { waitUntil: 'load' });
await page.waitForSelector('.track-row');
const rows = () => page.locator('.track-row').count();
const before = await rows();
/* кликаем по названию: середина строки — это колонка «Альбом», она открывает альбом */
const clickRow = (i, modifiers) => page.locator('.track-row').nth(i).locator('.t-name').click({ modifiers });

await clickRow(0);
await clickRow(3, ['Shift']);
ok('Shift выделяет диапазон', (await page.locator('.track-row.sel').count()) === 4,
  `выделено: ${await page.locator('.track-row.sel').count()}`);
ok('панель действий появилась', await page.locator('.sel-bar').isVisible());
// выделенная строка подсвечена, панель не уехала за край окна
const look = await page.evaluate(() => {
  const row = document.querySelector('.track-row.sel');
  const bar = document.querySelector('.sel-bar');
  const rb = bar?.getBoundingClientRect();
  return {
    bg: row ? getComputedStyle(row).backgroundColor : '',
    barW: rb ? Math.round(rb.width) : 0,
    barTop: rb ? Math.round(rb.top) : -1,
  };
});
ok('выделенная строка подсвечена', /rgba?\(30, ?215, ?96/.test(look.bg), look.bg);
ok('панель действий в пределах окна', look.barW > 300 && look.barTop >= 0 && look.barTop < 900, JSON.stringify(look));


// Ctrl снимает выделение с одной строки, не трогая остальные
await clickRow(1, ['Control']);
ok('Ctrl снимает одну строку', (await page.locator('.track-row.sel').count()) === 3);

// Ctrl+A — всё, Esc — снять
await page.keyboard.press('Control+a');
const all = await page.locator('.track-row.sel').count();
ok('Ctrl+A выделяет всё', all === before, `выделено ${all} из ${before}`);
await page.keyboard.press('Escape');
ok('Esc снимает выделение', (await page.locator('.track-row.sel').count()) === 0);

/* --------------------- 2. пачка в очередь и в плейлист --------------------- */
await clickRow(0);
await clickRow(4, ['Shift']);
const queueLen = () => page.evaluate(() => window.__store.getState().queue.length);
const q0 = await queueLen();
await page.locator('.sel-bar').getByRole('button', { name: /в очередь/i }).click();
await page.waitForTimeout(300);
const q1 = await queueLen();
ok('пачка ушла в очередь', q1 - q0 === 5, `было ${q0}, стало ${q1}`);

// окно «Добавить в плейлист» открывается пачкой и показывает счётчик
await page.locator('.sel-bar').getByRole('button', { name: /в плейлист/i }).click();
await page.waitForSelector('.modal.atp');
const atpTitle = await page.locator('.modal.atp .hint').innerText();
ok('окно «Добавить в плейлист» получило пачку', /5\s+треков/i.test(atpTitle), atpTitle);
await page.keyboard.press('Escape');

/* --------------------------- 3. удаление пачкой --------------------------- */
await clickRow(0);
await clickRow(1, ['Shift']);
const n0 = await rows();
await page.locator('.sel-bar').getByRole('button', { name: /удалить/i }).click();
await page.waitForFunction((n) => document.querySelectorAll('.track-row').length !== n, n0, { timeout: 8000 });
const n1 = await rows();
ok('пачка удалена из плейлиста', n1 === n0 - 2, `было ${n0}, стало ${n1}`);
ok('выделение снято после удаления', (await page.locator('.sel-bar').count()) === 0);

/* ---------------------- 4. перетаскивание плейлистов ---------------------- */
const plRows = () => page.locator('.lib-row[draggable="true"]');
const libNames = () => plRows().evaluateAll((els) => els.map((e) => e.querySelector('.name .t')?.textContent?.trim() || ''));

const order0 = await libNames();
ok('в медиатеке есть свои плейлисты', order0.length >= 3, order0.join(' | '));

// тянем первый плейлист на нижнюю половину третьего — то есть «после него»
await plRows().nth(0).dragTo(plRows().nth(2), { targetPosition: { x: 30, y: 46 } });
await page.waitForTimeout(400);

const order1 = await libNames();
const saved = await page.evaluate(() => window.__store.getState().settings.playlistOrder);
ok('порядок плейлистов изменился', JSON.stringify(order0) !== JSON.stringify(order1), `${order0.join(' > ')}  →  ${order1.join(' > ')}`);
ok('порядок сохранён в настройках', (saved || []).length > 0, JSON.stringify(saved));
ok('перетащенный плейлист уехал вниз', order1.indexOf(order0[0]) >= 2, order1.join(' > '));

// во время переноса видно и источник, и место, куда плейлист упадёт
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.lib-row[draggable="true"]')];
  const dt = new DataTransfer();
  window.__dndMarks = { dt };
  rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.lib-row[draggable="true"]')];
  const r = rows[2].getBoundingClientRect();
  rows[2].dispatchEvent(new DragEvent('dragover', {
    bubbles: true, cancelable: true, dataTransfer: window.__dndMarks.dt,
    clientX: r.x + r.width / 2, clientY: r.y + r.height * 0.8,
  }));
});
await page.waitForTimeout(150);
const marks = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.lib-row[draggable="true"]')];
  return { src: rows[0].className, dst: rows[2].className };
});
ok('источник помечен при переносе', /\bdragging\b/.test(marks.src), marks.src);
ok('место переноса подсвечено', /\bdrop-after\b/.test(marks.dst), marks.dst);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.lib-row[draggable="true"]')];
  rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dndMarks.dt }));
});
await page.waitForTimeout(100);

// сброс через меню по правому клику
await plRows().first().click({ button: 'right' });
await page.waitForSelector('.ctx');
await page.locator('.ctx').getByRole('button', { name: /сбросить порядок/i }).click();
await page.waitForTimeout(300);
const order2 = await libNames();
ok('сброс вернул порядок сервера', JSON.stringify(order2) === JSON.stringify(order0), order2.join(' > '));

/* ------------- 5. сетка медиатеки и сохранение после перезагрузки ------------- */
const cards = () => page.locator('.grid .card[draggable="true"]');
const cardNames = () => cards().evaluateAll((els) => els.map((e) => e.querySelector('.title')?.textContent?.trim() || ''));

await page.goto(`${APP}#/library?tab=playlists`, { waitUntil: 'load' });
await page.waitForSelector('.grid .card');
const grid0 = await cardNames();
ok('сетка плейлистов на месте', grid0.length >= 3, grid0.join(' | '));

await cards().nth(0).dragTo(cards().nth(2), { targetPosition: { x: 130, y: 90 } });
await page.waitForTimeout(400);
const grid1 = await cardNames();
ok('в сетке плейлист переставился', JSON.stringify(grid0) !== JSON.stringify(grid1), `${grid0.join(' > ')}  →  ${grid1.join(' > ')}`);

// порядок один на всё приложение: медиатека слева показывает его же
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForSelector('.lib-row');
const libAfterGrid = await libNames();
// в медиатеке слева к своим плейлистам добавляются общие — сравниваем «свою» часть
ok('порядок из сетки виден в медиатеке',
  libAfterGrid.slice(0, grid1.length).join('>') === grid1.join('>'),
  `${libAfterGrid.join(' > ')} vs ${grid1.join(' > ')}`);

// и переживает перезапуск
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.lib-row[draggable="true"]', { timeout: 15000 });
const libAfterReload = await libNames();
ok('порядок сохранился после перезагрузки',
  libAfterReload.slice(0, grid1.length).join('>') === grid1.join('>'), libAfterReload.join(' > '));

/* ---------------- 6. «Любимые»: пачкой убрать сердечки и клавиша Del ---------------- */
await page.goto(`${APP}#/liked`, { waitUntil: 'load' });
await page.waitForSelector('.track-row');
const liked0 = await rows();
ok('в любимых есть треки', liked0 >= 4, `${liked0}`);

await clickRow(0);
await clickRow(2, ['Shift']);
await page.locator('.sel-bar').getByRole('button', { name: /убрать из любимых/i }).click();
await page.waitForFunction((n) => document.querySelectorAll('.track-row').length !== n, liked0, { timeout: 8000 });
const liked1 = await rows();
ok('пачка снята с любимых', liked1 === liked0 - 3, `было ${liked0}, стало ${liked1}`);

// Del удаляет выделенное там, где у списка есть действие «удалить»
await page.goto(`${APP}#/playlist/pl-1`, { waitUntil: 'load' });
await page.waitForSelector('.track-row');
const del0 = await rows();
await clickRow(0);
await clickRow(1, ['Shift']);
await page.keyboard.press('Delete');
await page.waitForFunction((n) => document.querySelectorAll('.track-row').length !== n, del0, { timeout: 8000 });
ok('Del удаляет выделенное', (await rows()) === del0 - 2, `было ${del0}, стало ${await rows()}`);

await page.screenshot({ path: '/tmp/e2e-multiselect.png' }).catch(() => {});

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nпроверки мультивыбора и драг-н-дропа чисты');
await browser.close();
process.exit(failed ? 1 : 0);
