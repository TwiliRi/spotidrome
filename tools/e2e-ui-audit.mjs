/* Автоматический аудит интерфейса: ищем типовые ui/ux-беды в живом приложении.
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-ui-audit.mjs            # npm run audit:ui:scan
   Это не тест «на проход», а сборщик находок: печатает, что нашёл, чтобы потом
   починить и закрыть регрессионными проверками в e2e-ui-fixes.mjs.
   Смотрим: горизонтальную прокрутку, вылезающие за экран элементы, обрезанный
   без многоточия текст, кнопки без доступного имени, картинки без alt,
   микроскопические кнопки, модальные окна (фокус, Esc, клик по фону),
   перекрытие контента нижним плеером и тостами. */

import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const WIDTHS = (process.env.WIDTHS || '1440,1280,1024,860,720').split(',').map(Number);

/* Проверки, работающие внутри страницы: собираем «сырые» находки. */
const SCAN = () => {
  const out = { spill: [], clipped: [], noName: [], noAlt: [], tiny: [], behind: [], contrast: [], cut: [], dupId: [], nested: [] };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title')
    || (el.textContent || '').trim() || el.getAttribute('placeholder') || '').trim();
  const path = (el) => {
    const bits = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += '#' + e.id;
      else if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
      bits.unshift(s);
      if (bits.length > 4) break;
    }
    return bits.join(' > ');
  };
  const clippedByParent = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflow !== 'visible' || s.overflowX !== 'visible') return true;
    }
    return false;
  };
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    /* 1. элемент вылез за боковые границы окна */
    if (s.position !== 'fixed' && !clippedByParent(el) && (r.right > vw + 2 || r.left < -2)) {
      out.spill.push({ sel: path(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
    }

    /* 2. текст обрезан без многоточия */
    const ownText = [].slice.call(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (ownText && s.overflow === 'hidden' && s.textOverflow === 'clip' && s.whiteSpace === 'nowrap'
      && el.scrollWidth > el.clientWidth + 1) {
      out.clipped.push({ sel: path(el), text: ownText.slice(0, 40), scroll: el.scrollWidth, client: el.clientWidth });
    }

    /* 3. интерактивный элемент без доступного имени */
    const tag = el.tagName;
    if ((tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button') && !name(el)) {
      out.noName.push({ sel: path(el), size: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }

    /* 4. картинка без alt */
    if (tag === 'IMG' && !el.hasAttribute('alt')) out.noAlt.push({ sel: path(el), src: (el.getAttribute('src') || '').slice(0, 30) });

    /* 5. кнопка, в которую трудно попасть пальцем */
    if ((tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button') && (r.width < 20 || r.height < 20)) {
      out.tiny.push({ sel: path(el), size: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
  }

  /* 6. тусклый текст: считаем контраст по WCAG (фон ищем по родителям) */
  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const a = fg[3];
    const mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const l1 = lum(mix); const l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const own = [].slice.call(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    const s = getComputedStyle(el);
    const fg = rgb(s.color);
    if (!fg) continue;
    let bg = null;
    for (let p = el; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      const c = rgb(st.backgroundColor);
      if (c && c[3] >= 0.9) {
        // сверху может лежать затемняющий градиент (жанровые карточки) — учитываем
        const alphas = [...(st.backgroundImage || '').matchAll(/rgba\(\s*0,\s*0,\s*0,\s*([\d.]+)\s*\)/g)]
          .map((m) => parseFloat(m[1]));
        if (alphas.length) {
          const k = alphas.reduce((a, b) => a + b, 0) / alphas.length;
          bg = [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k), 1];
        } else bg = c;
        break;
      }
    }
    if (!bg) bg = [0, 0, 0, 1];
    const r = ratio(fg, bg);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const need = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
    if (r < need) {
      out.contrast.push({ sel: path(el), text: own.slice(0, 30), ratio: Math.round(r * 100) / 100, need, size: Math.round(size) });
    }
  }

  /* 7. обрезанный текст без подсказки: прочитать целиком уже нельзя */
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow !== 'ellipsis' || el.scrollWidth <= el.clientWidth + 1) continue;
    let hasTip = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.getAttribute('title') || p.getAttribute('aria-label')) { hasTip = true; break; }
    }
    if (hasTip) continue;
    out.cut.push({ sel: path(el), text: (el.textContent || '').trim().slice(0, 34) });
  }

  /* 8. дубли id и кнопка внутри кнопки — ломают доступность и клики */
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) out.dupId.push({ id, раз: n });
  for (const el of document.querySelectorAll('button button, button a, a button, a a')) {
    out.nested.push({ sel: path(el) });
  }

  /* 9. контент, за которым сидит нижний плеер: прокручиваем в конец и смотрим,
        не прячется ли последняя строка под панелью */
  const scroll = document.querySelector('.scroll');
  const player = document.querySelector('.player');
  if (scroll && player) {
    scroll.scrollTop = scroll.scrollHeight;
    const pTop = player.getBoundingClientRect().top;
    const kids = [].slice.call(scroll.querySelectorAll('.page > *')).filter(vis);
    const last = kids[kids.length - 1];
    if (last) {
      const b = last.getBoundingClientRect().bottom;
      if (b > pTop + 1) out.behind.push({ под: Math.round(b - pTop), последний: last.className || last.tagName });
    }
  }
  return out;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(APP, { waitUntil: 'load' });
await page.getByRole('button', { name: /демо-библиотеку/i }).click();
await page.waitForFunction(() => window.__store?.getState?.().connected === true, null, { timeout: 15000 });

/* адреса для обхода берём из демо-библиотеки */
const routes = await page.evaluate(() => {
  const m = window.__api.mock;
  return {
    '/': null, '/search': null, '/library': null, '/liked': null, '/recent': null,
    '/stats': null, '/offline': null, '/disliked': null,
    '/album/x': `/album/${m.albums[0].id}`,
    '/artist/x': `/artist/${m.artists[0].id}`,
    '/playlist/x': `/playlist/${m.playlists[0].id}`,
    '/genre/x': `/genre/${encodeURIComponent(m.songs[0].genre || m.genres?.[0]?.value || 'Rock')}`,
  };
});

const found = [];
const note = (kind, where, items) => {
  const uniq = [];
  for (const it of items) {
    const key = JSON.stringify(it);
    if (!uniq.some((u) => JSON.stringify(u) === key)) uniq.push(it);
  }
  for (const it of uniq.slice(0, 6)) found.push({ kind, where, ...it });
};

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  for (const [label, route] of Object.entries(routes)) {
    await page.goto(`${APP}#${route || label}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const res = await page.evaluate(SCAN);
    const where = `${width}px ${label}`;
    note('вылезает за экран', where, res.spill);
    note('обрезанный текст', where, res.clipped);
    note('кнопка без имени', where, res.noName);
    note('img без alt', where, res.noAlt);
    note('кнопка мельче 20px', where, res.tiny);
    note('контент под плеером', where, res.behind);
    note('тусклый текст', where, res.contrast);
    note('обрезано без подсказки', where, res.cut);
    note('повтор id', where, res.dupId);
    note('кнопка в кнопке', where, res.nested);
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (hscroll) found.push({ kind: 'горизонтальная прокрутка', where });
  }
}

/* ---------- окна и панели ---------- */
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(600);

const modals = [
  ['настройки', () => page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true })), '.modal'],
  ['эквалайзер', () => page.evaluate(() => window.__store.getState().setUI({ eqOpen: true })), '.modal'],
  ['раскладка', () => page.evaluate(() => window.__store.getState().setUI({ layoutOpen: true })), '.modal'],
  ['о программе', () => page.evaluate(() => window.__store.getState().setUI({ aboutOpen: true })), '.modal'],
];
for (const [label, open, sel] of modals) {
  await open();
  await page.waitForSelector(sel, { timeout: 5000 });
  await page.waitForTimeout(350);

  /* фокус не должен гулять по фону за открытым окном */
  const trapped = await page.evaluate((s) => {
    const modal = document.querySelector(s);
    let inside = true;
    for (let i = 0; i < 25; i++) {
      const el = document.activeElement;
      if (el && !modal.contains(el) && el !== document.body) { inside = false; break; }
      const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      document.dispatchEvent(ev);
      break;                                    // реальный Tab делает браузер
    }
    return { inside, active: document.activeElement?.className || document.activeElement?.tagName };
  }, sel);
  if (!trapped.inside) found.push({ kind: 'фокус уходит из окна', where: label, sel: trapped.active });

  /* Tab: настоящая прокрутка по 25 элементам — считаем, сколько раз вышли за окно */
  let escaped = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const out = await page.evaluate((s) => {
      const m = document.querySelector(s);
      const a = document.activeElement;
      return !!(m && a && !m.contains(a) && a !== document.body);
    }, sel);
    if (out) escaped++;
  }
  if (escaped) found.push({ kind: 'Tab уводит фокус за окно', where: label, раз: escaped });

  /* Esc закрывает */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator(sel).count()) {
    found.push({ kind: 'Esc не закрывает окно', where: label });
    await page.evaluate((s) => { const b = document.querySelector(`${s} .icon-btn`); if (b) b.click(); }, sel);
    await page.waitForTimeout(250);
  }

  /* клик по фону закрывает */
  await open();
  await page.waitForSelector(sel, { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.mouse.click(20, 20);
  await page.waitForTimeout(300);
  if (await page.locator(sel).count()) {
    found.push({ kind: 'клик по фону не закрывает окно', where: label });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

/* ---------- полноэкранный плеер и очередь ---------- */
await page.evaluate(async () => {
  const { buildMockLibrary } = await import('/src/lib/mock.js');
  window.__lib = window.__lib || buildMockLibrary();
  await window.__store.getState().playQueue(window.__lib.songs.slice(0, 5), 0, { type: 'album', name: 'Аудит' });
});
await page.waitForTimeout(500);

for (const width of [1440, 1024, 860]) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: true }));
  await page.waitForSelector('.np2', { timeout: 5000 });
  await page.waitForTimeout(600);
  const res = await page.evaluate(SCAN);
  const where = `${width}px плеер`;
  note('вылезает за экран', where, res.spill);
  note('обрезанный текст', where, res.clipped);
  note('кнопка без имени', where, res.noName);
  note('кнопка мельче 20px', where, res.tiny);
  note('тусклый текст', where, res.contrast);
  note('обрезано без подсказки', where, res.cut);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/* очередь справа */
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => window.__store.getState().setUI({ queueOpen: true }));
await page.waitForTimeout(600);
{
  const res = await page.evaluate(SCAN);
  note('вылезает за экран', '1440px очередь', res.spill);
  note('обрезанный текст', '1440px очередь', res.clipped);
  note('кнопка без имени', '1440px очередь', res.noName);
  note('тусклый текст', '1440px очередь', res.contrast);
  note('обрезано без подсказки', '1440px очередь', res.cut);
}

/* контекстное меню у трека */
{
  const row = page.locator('.track-row, .row').first();
  if (await row.count()) {
    await row.click({ button: 'right' });
    await page.waitForTimeout(400);
    const menu = await page.locator('.ctx, .context-menu, .menu').count();
    if (!menu) found.push({ kind: 'контекстное меню не открылось', where: 'клик правой кнопкой по треку' });
    else {
      const box = await page.locator('.ctx, .context-menu, .menu').first().boundingBox();
      if (box && (box.x + box.width > 1440 + 2 || box.y + box.height > 900 + 2)) {
        found.push({ kind: 'меню вылезло за экран', where: 'контекстное меню' });
      }
      await page.keyboard.press('Escape');
    }
  }
}

/* ---------- печать ---------- */
const byKind = {};
for (const f of found) (byKind[f.kind] = byKind[f.kind] || []).push(f);
console.log('\n=== НАЙДЕНО ===');
if (!found.length) console.log('ничего');
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n${kind} — ${list.length}`);
  for (const f of list.slice(0, 8)) {
    const { kind: _k, where, ...rest } = f;
    console.log(`  [${where}] ${JSON.stringify(rest)}`);
  }
}
await browser.close();
