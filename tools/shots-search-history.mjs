/* Кадры для визуальной проверки (запускать с поднятым dev-сервером):
     node tools/shots-search-history.mjs → .shots/*.png (папка в архив не попадает) */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
mkdirSync(new URL('../.shots/', import.meta.url).pathname, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });

await page.evaluate(() => {
  ['aurora fields', 'neon kasette', 'queen', 'кино', 'slow burn live'].forEach((q) => window.__store.getState().pushSearchHistory(q));
});
await page.locator('.tb-search input').click();
await page.waitForSelector('.tb-hist');
await page.locator('.tb-hist-item').nth(1).hover();
await page.waitForTimeout(250);
await page.screenshot({ path: new URL('../.shots/search-history-dropdown.png', import.meta.url).pathname });

await page.locator('.tb-hist input, .tb-clear').first().click().catch(() => {});
await page.evaluate(() => { window.__store.getState().setUI({ settingsOpen: false }); window.location.hash = '#/search'; });
await page.waitForTimeout(600);
await page.screenshot({ path: new URL('../.shots/search-history-page.png', import.meta.url).pathname });
await browser.close();
console.log('shots ok');
