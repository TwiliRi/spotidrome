/* Живая проверка истории поиска (нужен dev-сервер и Chromium от Playwright):
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-search-history.mjs
   Идём через интерфейс как человек: печатаем в поле поиска, смотрим подсказки,
   выбираем стрелками, убираем по одному, перезагружаем окно, трогаем настройку. */

import { chromium } from 'playwright';
import { isNoise } from './e2e-noise.mjs';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !isNoise(m.text())) problems.push(`console.error: ${m.text()}`);
});

const input = page.locator('.tb-search input');
const hist = (n) => page.waitForFunction((k) => window.__store.getState().searchHistory.length === k, n, { timeout: 10000 });
const queries = () => page.evaluate(() => window.__store.getState().searchHistory.map((x) => x.q));

await page.goto(URL, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });

/* --- запись запросов: только по Enter или по кнопке «Искать» --- */
await input.click();
await input.fill('aurora');                       // есть в демо-библиотеке
await page.waitForTimeout(700);                   // дебаунс поиска уже прошёл...
ok('простой набор текста историю не пишет', (await queries()).length === 0, (await queries()).join());
await page.waitForSelector('.card', { timeout: 10000 });
ok('результаты поиска при этом на месте', (await page.locator('.page h2').count()) > 0);

await input.press('Enter');
await hist(1);
ok('Enter записал запрос', (await queries()).join() === 'aurora', (await queries()).join());

await input.fill('neon');
await page.locator('.tb-go').click();              // клик по лупе
await hist(2);
ok('клик по иконке поиска тоже записывает', (await queries()).join() === 'neon,aurora', (await queries()).join());
ok('лупа не теряет фокус поля', await input.evaluate((el) => el === document.activeElement));

await input.fill('  AURORA  ');
await input.press('Enter');
await page.waitForFunction(() => window.__store.getState().searchHistory[0]?.q === 'AURORA', null, { timeout: 10000 });
ok('повтор поднимается наверх, дубля нет', (await queries()).join() === 'AURORA,neon', (await queries()).join());

await input.fill('а');
await input.press('Enter');
await page.waitForTimeout(400);
ok('однобуквенный запрос не запоминается', (await queries()).length === 2, (await queries()).join());
await input.fill('neon');

/* --- потолок в 12 записей --- */
await page.evaluate(() => {
  for (let i = 0; i < 15; i++) window.__store.getState().pushSearchHistory(`тест ${i}`);
});
const capped = await queries();
ok('история ограничена 12 запросами', capped.length === 12, `${capped.length} шт.`);
ok('свежие сверху, старые вытесняются', capped[0] === 'тест 14' && capped[1] === 'тест 13', capped.slice(0, 2).join(', '));

/* --- выпадающий список --- */
await input.click();
await page.waitForSelector('.tb-hist', { timeout: 5000 });
const shown = await page.locator('.tb-hist-item').count();
ok('под полем поиска показаны недавние запросы', shown === 12, `строк: ${shown}`);
const headText = await page.locator('.tb-hist-head').innerText();
ok('показан заголовок списка', /недавние поиски|совпадения в истории/i.test(headText), headText.replace(/\n/g, ' '));
ok('у строки есть время «сколько назад»', /назад|только что/.test(await page.locator('.tb-hist-ago').first().innerText()),
  await page.locator('.tb-hist-ago').first().innerText());

// фильтр по вводу: совпадения — наверх
await page.evaluate(() => window.__store.getState().pushSearchHistory('aurora fields'));
await input.click();
await input.fill('aurora');
await page.waitForTimeout(150);
const order = await page.evaluate(() => [...document.querySelectorAll('.tb-hist-q > span')].map((e) => e.textContent));
ok('введённый текст поднимает совпадения наверх', order[0] === 'aurora fields' && !order[1].includes('aurora'), order.join(' | '));

/* --- выбор стрелками и Enter --- */
await input.press('ArrowDown');
await page.waitForTimeout(120);
const hlText = await page.locator('.tb-hist-item.hl .tb-hist-q').innerText();
await input.press('Enter');
await page.waitForTimeout(400);
ok('Enter по подсвеченной строке подставляет её в поиск', (await input.inputValue()).trim().length > 0
  && (await page.url()).includes('q='), `${hlText} → ${await input.inputValue()}`);
await page.waitForSelector('.tb-hist', { state: 'detached', timeout: 5000 }).catch(() => {});
ok('после выбора список закрыт', (await page.locator('.tb-hist').count()) === 0);

/* --- выбор строки кликом обновляет её время и поднимает наверх --- */
await input.click();
await page.waitForSelector('.tb-hist');
await page.locator('.tb-hist-item', { hasText: 'тест 5' }).locator('.tb-hist-q').click();
await page.waitForTimeout(400);
ok('клик по строке истории поднимает её наверх', (await queries())[0] === 'тест 5', (await queries()).slice(0, 3).join(', '));

/* --- удаление по одному и очистка --- */
const before = (await queries()).length;
await input.click();
await page.waitForSelector('.tb-hist');
await page.locator('.tb-hist-item').first().hover();
await page.locator('.tb-hist-item').first().locator('.tb-hist-x').click();
await page.waitForTimeout(300);
ok('крестик убирает запрос из истории', (await queries()).length === before - 1, `${before} → ${await queries().then((q) => q.length)}`);

await input.click();
await page.waitForSelector('.tb-hist');
await page.locator('.tb-hist-head button').click();
await hist(0);
ok('«Очистить» обнуляет историю', (await queries()).length === 0);

/* --- снова наполняем и проверяем страницу поиска + перезагрузку --- */
await input.fill('молния');
await input.press('Enter');
await hist(1);
await input.fill('aurora');
await input.press('Enter');
await hist(2);
await page.waitForTimeout(600);                                   // persist() пишет с задержкой
await page.evaluate(() => { window.location.hash = '#/search'; });
await page.waitForTimeout(400);
const chips = await page.locator('.hist-chip').allInnerTexts();
ok('на пустой странице поиска показаны недавние запросы', chips.length === 2, chips.join(' / '));
await page.locator('.hist-chip > button:first-child').last().click();      // «молния» — последняя плитка
await page.waitForTimeout(500);
ok('клик по плитке запускает поиск', (await page.url()).includes('q=%D0%BC%D0%BE%D0%BB%D0%BD%D0%B8%D1%8F'), await page.url());
const afterChip = await queries();
ok('плитка поднимает свой запрос наверх', afterChip.join() === 'молния,aurora', afterChip.join(', '));

await page.waitForTimeout(600);                                             // persist() пишет с задержкой
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__store?.getState?.().booted === true, null, { timeout: 15000 });
const afterReload = await page.evaluate(() => window.__store.getState().searchHistory.map((x) => x.q));
ok('история переживает перезапуск (сохранена в конфиге)', afterReload.join() === 'молния,aurora', afterReload.join(', '));

/* --- настройка: выключили — история стирается и не пишется --- */
await page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true }));
await page.waitForSelector('.modal');
ok('в настройках есть переключатель истории', (await page.getByText('История поиска', { exact: true }).count()) > 0);
await page.getByText('История поиска', { exact: true }).locator('xpath=../..').locator('.switch').click();
await page.waitForTimeout(300);
ok('при выключении история очищена', (await queries()).length === 0);
await page.keyboard.press('Escape');
await input.click();
await input.fill('новый запрос');
await input.press('Enter');
await page.waitForTimeout(700);
ok('с выключенной настройкой запросы не пишутся даже по Enter', (await queries()).length === 0, (await queries()).join());
await page.evaluate(() => window.__store.getState().updateSettings({ rememberSearch: true }));
await page.waitForTimeout(200);
await input.fill('включили снова');
await input.press('Enter');
await page.waitForTimeout(700);
ok('после включения запись возобновляется', (await queries()).join() === 'включили снова', (await queries()).join());

/* --- горячая клавиша «/» открывает поле и список --- */
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('/');
await page.waitForTimeout(250);
ok('по «/» курсор встаёт в поиск', await input.evaluate((el) => el === document.activeElement));

ok('в консоли нет ошибок приложения', problems.length === 0, problems.join(' | '));

await browser.close();
console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
