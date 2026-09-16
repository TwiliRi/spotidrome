/* Проверка трёх правок интерфейса:
     npx vite --host 0.0.0.0 --port 5173 &
     node tools/e2e-ui-fixes.mjs
   1) слева сверху остались только стрелки — логотипа и названия нет;
   2) заголовок в шапке принадлежит текущей странице: с альбома на главную
      больше не переползает старое название;
   3) «Сейчас играет» на экране «Недавнее» обновляется сразу при переключении,
      а не раз в минуту. */

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

/* ------------------------- 1. логотип убран ------------------------- */
const brand = await page.evaluate(() => ({
  logo: document.querySelectorAll('.tb-logo').length,
  name: document.querySelectorAll('.tb-name').length,
  text: document.querySelector('.titlebar .tb-left')?.textContent?.trim() || '',
  arrows: document.querySelectorAll('.tb-left .tb-round').length,
}));
ok('логотипа слева сверху нет', brand.logo === 0 && brand.name === 0, JSON.stringify(brand));
ok('вверху слева нет надписи Spotidrome', !/spotidrome/i.test(brand.text), brand.text);
ok('стрелки «назад/вперёд» на месте', brand.arrows === 2, `${brand.arrows}`);

/* ------------- 2. заголовок шапки не переползает на главную ------------- */
const ids = await page.evaluate(() => ({ album: window.__api.mock.albums[0].id }));
await page.goto(`${APP}#/album/${ids.album}`, { waitUntil: 'load' });
await page.waitForSelector('.hero-title');
const albumName = (await page.locator('.hero-title').innerText()).trim();

// прокрутка проявляет шапку — там название альбома и кнопка «играть»
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 420; });
await page.waitForTimeout(500);
const onAlbum = await page.evaluate(() => ({
  title: document.querySelector('.topbar-h1')?.textContent?.trim() || '',
  play: document.querySelectorAll('.topbar-play').length,
}));
ok('на альбоме в шапке его название', onAlbum.title === albumName, `${onAlbum.title} vs ${albumName}`);
ok('на альбоме есть кнопка «играть» в шапке', onAlbum.play === 1, JSON.stringify(onAlbum));

// ушли на главную и прокрутили — чужого названия быть не должно
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 420; });
await page.waitForTimeout(500);
const onHome = await page.evaluate(() => ({
  title: document.querySelector('.topbar-h1')?.textContent?.trim() || '',
  play: document.querySelectorAll('.topbar-play').length,
}));
ok('на главной в шапке нет чужого названия', onHome.title === '', `"${onHome.title}"`);
ok('на главной в шапке нет чужой кнопки «играть»', onHome.play === 0, JSON.stringify(onHome));

// с плейлиста на главную — тот же сценарий, что жаловались
await page.goto(`${APP}#/playlist/pl-0`, { waitUntil: 'load' });
await page.waitForSelector('.hero-title');
const plName = (await page.locator('.hero-title').innerText()).trim();
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 420; });
await page.waitForTimeout(500);
const afterPl = await page.evaluate(() => document.querySelector('.topbar-h1')?.textContent?.trim() || '');
ok('после плейлиста на главной пусто', afterPl === '', `было «${plName}», в шапке «${afterPl}»`);

/* ------------------- 3. «Сейчас играет» обновляется сразу ------------------- */
await page.goto(`${APP}#/recent`, { waitUntil: 'load' });
await page.waitForSelector('.action-bar');

// ставим два трека в очередь — экран «Недавнее» открыт
const titles = await page.evaluate(() => {
  const s = window.__store.getState();
  const [a, b] = window.__api.mock.songs;
  s.playQueue([a, b], 0, { type: 'recent', name: 'Недавнее' });
  return [a.title, b.title];
});
await page.waitForTimeout(400);
const first = await page.evaluate(() => document.querySelector('.live-chip.mine')?.textContent?.trim() || '');
ok('свой трек появился в «сейчас играет»', first.includes(titles[0]), `${first} vs ${titles[0]}`);

// переключаем — строка должна обновиться, не дожидаясь минутного опроса
const t0 = Date.now();
await page.evaluate(() => window.__store.getState().next(true));
await page.waitForFunction(
  (t) => {
    const el = document.querySelector('.live-chip.mine');
    return !!el && el.textContent.includes(t);
  },
  titles[1],
  { timeout: 5000 },
).catch(() => {});
const spent = Date.now() - t0;
const second = await page.evaluate(() => document.querySelector('.live-chip.mine')?.textContent?.trim() || '');
ok('при переключении строка обновилась сразу', second.includes(titles[1]), `${second} vs ${titles[1]}`);
ok('обновление быстрее минутного опроса', spent < 3000, `${spent} мс`);

/* ---------------- 4. доступность окон, ползунков и текста ---------------- */

/* окна: Esc закрывает, Tab не уходит в интерфейс позади, фокус возвращается */
const openModal = async (flag) => page.evaluate((f) => window.__store.getState().setUI({ [f]: true }), flag);
const modalGone = () => page.locator('.modal').count();

for (const [flag, name] of [['settingsOpen', 'настройки'], ['eqOpen', 'эквалайзер'], ['layoutOpen', 'раскладка'], ['aboutOpen', 'о программе']]) {
  await openModal(flag);
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.waitForTimeout(250);

  let escaped = 0;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const out = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      const a = document.activeElement;
      return !!(m && a && !m.contains(a) && a !== document.body);
    });
    if (out) escaped++;
  }
  ok(`${name}: Tab не уводит фокус из окна`, escaped === 0, `выходов ${escaped}`);

  const named = await page.evaluate(() => {
    const btns = [].slice.call(document.querySelectorAll('.modal button'));
    const bad = btns.filter((b) => !(b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent || '').trim()));
    return bad.length;
  });
  ok(`${name}: у каждой кнопки в окне есть имя`, named === 0, `без имени ${named}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(`${name}: Esc закрывает окно`, (await modalGone()) === 0);
}

/* список треков тоже доступен с клавиатуры: дошли Tab, стрелки, Enter */
const albumId = await page.evaluate(() => window.__api.mock.albums[0].id);
await page.goto(`${APP}#/album/${albumId}`, { waitUntil: 'load' });
await page.waitForSelector('.track-row');
await page.waitForTimeout(600);
const boxTab = await page.evaluate(() => document.querySelector('.tracks')?.getAttribute('tabindex'));
ok('список треков достижим по Tab', boxTab === '0', `tabindex=${boxTab}`);
await page.evaluate(() => document.querySelector('.tracks').focus());
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
ok('стрелка выделяет строку', (await page.locator('.track-row.sel').count()) === 1);
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
const played = await page.evaluate(() => ({ t: window.__store.getState().current()?.title, p: window.__store.getState().playing }));
ok('Enter играет выбранную строку', !!played.t && played.p === true, JSON.stringify(played));

/* громкость двигается с клавиатуры: ползунок — это настоящий slider */
await page.evaluate(() => {
  const s = window.__store.getState();
  s.setVolume(0.4);
});
await page.waitForTimeout(200);
const vol0 = await page.evaluate(() => window.__store.getState().settings.volume);
await page.locator('.player .slider.vol').focus();
const role = await page.evaluate(() => {
  const el = document.querySelector('.player .slider.vol');
  return { role: el.getAttribute('role'), now: el.getAttribute('aria-valuenow'), tab: el.getAttribute('tabindex') };
});
ok('ползунок громкости доступен с клавиатуры', role.role === 'slider' && role.tab === '0' && role.now != null, JSON.stringify(role));
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
const vol1 = await page.evaluate(() => window.__store.getState().settings.volume);
ok('стрелки меняют громкость', vol1 > vol0 + 0.05, `${vol0} → ${vol1}`);

/* тумблеры — настоящие переключатели, а не div с onClick */
await page.evaluate(() => window.__store.getState().setUI({ settingsOpen: true }));
await page.waitForSelector('.modal');
const switches = await page.evaluate(() => {
  const all = [].slice.call(document.querySelectorAll('.switch'));
  return {
    всего: all.length,
    кнопок: all.filter((el) => el.tagName === 'BUTTON' && el.getAttribute('role') === 'switch').length,
  };
});
ok('тумблеры — кнопки с ролью switch', switches.всего > 0 && switches.кнопок === switches.всего, JSON.stringify(switches));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

/* длинное слово в шапке больше не уезжает за край окна */
await page.setViewportSize({ width: 860, height: 900 });
await page.goto(`${APP}#/disliked`, { waitUntil: 'load' });
await page.waitForTimeout(700);
const spill = await page.evaluate(() => {
  const vw = window.innerWidth;
  const bad = [];
  for (const el of document.querySelectorAll('.hero *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none') continue;
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflow !== 'visible') { clipped = true; break; }
    }
    const r = el.getBoundingClientRect();
    if (!clipped && (r.right > vw + 2 || r.left < -2)) bad.push(el.className || el.tagName);
  }
  return bad;
});
ok('шапка со словом «Исключённые» влезает в узкое окно', spill.length === 0, spill.slice(0, 3).join(', '));
await page.setViewportSize({ width: 1440, height: 900 });

/* кнопки-иконки в плеере: попасть мышью можно */
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
const tiny = await page.evaluate(() => [].slice.call(document.querySelectorAll('.player button'))
  .map((b) => { const r = b.getBoundingClientRect(); return { c: b.className, w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter((b) => b.w < 24 || b.h < 24));
ok('в нижнем плеере нет кнопок мельче 24 px', tiny.length === 0, JSON.stringify(tiny.slice(0, 3)));

/* обрезанные названия в медиатеке объясняют себя подсказкой */
const tips = await page.evaluate(() => {
  const rows = [].slice.call(document.querySelectorAll('.lib-row .meta .name, .lib-row .meta .sub'));
  return { всего: rows.length, безПодсказки: rows.filter((el) => !el.getAttribute('title')).length };
});
ok('названия в медиатеке подписаны', tips.всего > 0 && tips.безПодсказки === 0, JSON.stringify(tips));

/* жанры на странице поиска: белый текст читается на любом цвете карточки */
await page.goto(`${APP}#/search`, { waitUntil: 'load' });
await page.waitForTimeout(1000);
const worst = await page.evaluate(() => {
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (fg, bg) => { const a = fg[3]; const mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); const l1 = lum(mix); const l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  let min = 99;
  for (const card of document.querySelectorAll('.grid.wide button')) {
    const st = getComputedStyle(card);
    const bg = rgb(st.backgroundColor);
    if (!bg) continue;
    const al = [...(st.backgroundImage || '').matchAll(/rgba\(\s*0,\s*0,\s*0,\s*([\d.]+)\s*\)/g)].map((m) => parseFloat(m[1]));
    const under = al.length ? [bg[0] * (1 - al[0] * 0 + (al.reduce((a, b) => a + b, 0) / al.length)) / 1, 0, 0] : null;
    const k = al.length ? al.reduce((a, b) => a + b, 0) / al.length : 0;
    const real = [bg[0] * (1 - k), bg[1] * (1 - k), bg[2] * (1 - k), 1];
    for (const span of card.querySelectorAll('span')) {
      if (!(span.textContent || '').trim()) continue;
      const fg = rgb(getComputedStyle(span).color);
      if (!fg) continue;
      min = Math.min(min, ratio(fg, real));
    }
    void under;
  }
  return Math.round(min * 100) / 100;
});
ok('текст на цветных карточках жанров читается', worst >= 4.4, `худший контраст ${worst}`);

/* склонения: «1 трек», а не «1 треков» */
const words = await page.evaluate(async () => {
  const m = await import('/src/lib/util.js');
  return [1, 2, 5, 11, 21].map((n) => m.songsWord(n)).concat([1, 2, 5].map((n) => m.albumsWord(n)));
});
ok('слова склоняются по числам', words.join(' | ') === '1 трек | 2 трека | 5 треков | 11 треков | 21 трек | 1 альбом | 2 альбома | 5 альбомов', words.join(' | '));

/* ---------- 5. ручка очереди, кнопки полноэкранного, узкое окно ---------- */
await page.goto(`${APP}#/`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => window.__store.getState().setUI({ queueOpen: true }));
await page.waitForSelector('.rightbar');

/* ручка очереди: ловится не одним пикселем, а всей полосой */
const grip = await page.evaluate(() => {
  const el = document.querySelector('.rightbar .splitter');
  const r = el.getBoundingClientRect();
  const y = r.top + r.height / 2;
  let hit = 0;
  for (let x = Math.round(r.left); x < Math.round(r.right); x++) {
    const e = document.elementFromPoint(x, y);
    if (e && (e === el || el.contains(e))) hit++;
  }
  return { w: Math.round(r.width), hit };
});
ok('ручку очереди можно захватить всей полосой', grip.hit >= 8, `полоса ${grip.w} px, ловится ${grip.hit} px`);

/* и панель действительно тянется мышью */
const beforeW = await page.evaluate(() => Math.round(document.querySelector('.rightbar').getBoundingClientRect().width));
const gripPoint = await page.evaluate(() => {
  const r = document.querySelector('.rightbar .splitter').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(gripPoint.x, gripPoint.y);
await page.mouse.down();
await page.mouse.move(gripPoint.x - 60, gripPoint.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const afterW = await page.evaluate(() => Math.round(document.querySelector('.rightbar').getBoundingClientRect().width));
ok('ширина очереди меняется перетаскиванием', afterW - beforeW > 40, `было ${beforeW}, стало ${afterW}`);
await page.evaluate(() => window.__store.getState().setUi({ rightW: 340 }));

/* кнопки вверху полноэкранного плеера: большие и попадаются с любой точки */
await page.evaluate(() => {
  const st = window.__store.getState();
  st.playQueue(window.__api.mock.songs.slice(0, 4), 0, { name: 'Демо' });
});
await page.waitForTimeout(500);
await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: true }));
await page.waitForSelector('.np2-top-actions');
const hitbox = await page.evaluate(() => {
  const b = [].slice.call(document.querySelectorAll('.np2-top-actions button')).find((x) => x.title === 'Эквалайзер');
  const r = b.getBoundingClientRect();
  const at = (dx, dy) => { const e = document.elementFromPoint(r.left + dx, r.top + dy); return e === b || b.contains(e); };
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    corners: [at(1, 1), at(r.width - 1, 1), at(1, r.height - 1), at(r.width - 1, r.height - 1)],
  };
});
ok('кнопка вверху полноэкранного — не меньше 44 px', hitbox.w >= 44 && hitbox.h >= 44, JSON.stringify(hitbox));
ok('в неё попадаешь даже самым углом', hitbox.corners.every(Boolean), JSON.stringify(hitbox));

/* «свернуть» стоит перед выходом из полноэкранного режима */
const order = await page.evaluate(() => [].slice.call(document.querySelectorAll('.np2-top-actions button')).map((b) => b.title || ''));
const iMin = order.findIndex((t) => /^Свернуть/.test(t));
const iExit = order.findIndex((t) => /Выйти из полноэкранного/.test(t));
ok('в полноэкранном режиме есть кнопка «свернуть»', iMin >= 0, JSON.stringify(order));
ok('она стоит перед выходом из полноэкранного режима', iMin >= 0 && iExit > iMin, `свернуть ${iMin}, выход ${iExit}`);
/* верхняя панель не должна перехватывать клики (Electron: -webkit-app-region) */
const region = await page.evaluate(() => {
  const tb = document.querySelector('.titlebar');
  const cs = getComputedStyle(tb);
  return cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region');
});
ok('под полноэкранным слоем верхняя полоса не таскает окно', region === 'no-drag', `получили «${region}»`);

await page.getByTestId('np2-minimize').click();
await page.waitForTimeout(400);
const collapsed = await page.evaluate(() => ({
  bar: !!document.querySelector('.minbar'),
  app: !!document.querySelector('.app'),
  np2: !!document.querySelector('.np2'),
  playing: !!window.__store.getState().playing,
}));
ok('«свернуть» сворачивает всё приложение', collapsed.bar && !collapsed.app && !collapsed.np2, JSON.stringify(collapsed));
await page.getByTestId('app-restore').click();
await page.waitForTimeout(400);
const restored = await page.evaluate(() => ({
  bar: !!document.querySelector('.minbar'),
  app: !!document.querySelector('.app'),
}));
ok('из плашки приложение разворачивается обратно', !restored.bar && restored.app, JSON.stringify(restored));
await page.evaluate(() => window.__store.getState().setUI({ nowPlayingOpen: false }));
await page.waitForTimeout(250);
const regionBack = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.titlebar'));
  return cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region');
});
ok('после закрытия плеера окно снова можно таскать за шапку', regionBack === 'drag', `получили «${regionBack}»`);

/* узкое окно: очередь уступает место, а не оставляет чёрную дыру справа */
await page.evaluate(() => window.__store.getState().setUI({ queueOpen: true }));
const narrow = [];
for (const w of [1440, 1300, 1200, 1100, 1000, 900, 860, 820]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(320);
  const r = await page.evaluate(() => {
    const rb = document.querySelector('.rightbar');
    const vis = !!rb && getComputedStyle(rb).display !== 'none';
    const boxes = ['.sidebar', '.main', '.player']
      .map((s) => document.querySelector(s)).filter(Boolean)
      .map((e) => e.getBoundingClientRect())
      .concat(vis ? [rb.getBoundingClientRect()] : []);
    const title = document.querySelector('.titlebar');
    return {
      gap: Math.round(window.innerWidth - Math.max(...boxes.map((b) => b.right))),
      main: Math.round(document.querySelector('.main').getBoundingClientRect().width),
      titleH: Math.round((title?.getBoundingClientRect().height) || 0),
      zero: boxes.filter((b) => b.width < 40).length,
    };
  });
  if (!(r.gap >= 6 && r.gap <= 12 && r.main > 300 && r.titleH > 0 && r.zero === 0)) narrow.push(`${w}: ${JSON.stringify(r)}`);
}
ok('в узком окне очередь не ломает раскладку', narrow.length === 0, narrow.join(' | '));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);

ok('нет ошибок в консоли', problems.length === 0, problems.slice(0, 4).join(' | '));

await page.screenshot({ path: '/tmp/e2e-ui-fixes.png' }).catch(() => {});
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nправки интерфейса работают');
await browser.close();
process.exit(failed ? 1 : 0);
