/**
 * Отдельная HTML-страница со списком треков — чтобы можно было просто
 * скинуть её человеку.
 *
 * Страница **самодостаточна**: стили внутри, картинки в виде data-URI,
 * ни одного внешнего шрифта, скрипта или ссылки на сервер. Такой файл
 * открывается в любом браузере и без интернета — у того, кому его скинули,
 * нет доступа ни к Navidrome, ни к вашей фонотеке.
 *
 * Оформление — в духе Spotify: тёмный фон, крупная шапка с градиентом,
 * строки списка с обложкой, названием, исполнителем, альбомом и длительностью.
 */

import { fmt, fmtLong, plural, songsWord } from './util.js';

const COVER_SIZE = 160;         // обложка в страницу: в строке она 56 px, запас на_retina не нужен
const LANES = 4;                // сколько обложек качаем одновременно

/** Экранирование текста: названия треков приходят из тегов, там бывает что угодно. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * В src пускаем только картинки, встроенные в файл: чужих ссылок в странице
 * не будет. SVG разрешён: внутри <img> он работает в «статическом» режиме —
 * ни скрипты, ни внешние ссылки из него не выполняются. А вот незакодированный
 * <svg> в адресе — верный признак подмены, такое не пропускаем.
 */
export function safeCover(src) {
  const s = String(src || '');
  return /^data:image\/[a-z0-9.+-]+(;[a-z0-9.+-]+(=[a-z0-9.+-]+)?)?(;base64)?,[^\s<>"'`]+$/i.test(s) ? s : '';
}

/** Инициалы для заглушки: обложка нашлась не всегда, пустая клетка выглядит хуже. */
export function initials(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '♪';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const fileDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Имя файла страницы: латиница и цифры — не спотыкается ни на одной файловой системе. */
export const pageFileName = (prefix = 'disliked', d = new Date()) => `spotidrome-${prefix}-${fileDate(d)}.html`;

/**
 * Готовая страница.
 *
 * @param {Array}  tracks  [{ title, artist, album, duration, cover, at }]
 * @param {object} o       { title, kind, note, date, glyph }
 * @returns {string} HTML целиком
 */
export function buildPlaylistHtml(tracks, o = {}) {
  const {
    title = 'Исключённые треки',
    kind = 'Плейлист',
    note = '',
    date = new Date(),
    glyph = 'thumb-down',
  } = o || {};

  const list = Array.isArray(tracks) ? tracks : [];
  const total = list.reduce((s, t) => s + (Number(t?.duration) || 0), 0);
  const rows = list.map((t, i) => {
    const cover = safeCover(t?.cover);
    const art = cover
      ? `<img class="art" src="${cover}" alt="" width="56" height="56">`
      : `<span class="art art-ph" aria-hidden="true">${escapeHtml(initials(t?.album || t?.title))}</span>`;
    return `      <li class="row">
        <span class="n">${i + 1}</span>
        ${art}
        <span class="t">
          <span class="title">${escapeHtml(t?.title || '(без названия)')}</span>
          <span class="artist">${escapeHtml(t?.artist || 'Неизвестный исполнитель')}</span>
        </span>
        <span class="album c-album">${escapeHtml(t?.album || '')}</span>
        <span class="time c-time">${t?.duration ? fmt(t.duration) : ''}</span>
      </li>`;
  }).join('\n');

  const subTotal = total ? ` · ${fmtLong(total)}` : '';

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Spotidrome">
<title>${escapeHtml(title)} — Spotidrome</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #000; color: #fff;
    font: 400 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .hero { background: linear-gradient(180deg, #7a1f2b 0%, #40141f 46%, #121212 100%); }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
  .hero-in { display: flex; align-items: flex-end; gap: 24px; padding: 64px 0 24px; flex-wrap: wrap; }
  .art-big {
    width: 192px; height: 192px; flex: none; border-radius: 6px; display: grid; place-items: center;
    background: linear-gradient(135deg, #b3283c, #4a1520); box-shadow: 0 24px 70px rgba(0,0,0,.55);
  }
  .art-big svg { width: 96px; height: 96px; fill: #fff; opacity: .92; }
  .kind { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #fff; opacity: .8; }
  h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.06; font-weight: 900; letter-spacing: -.03em; margin: 12px 0 14px; }
  .sub { margin: 0; color: #b3b3b3; font-size: 14px; }
  .sub b { color: #fff; font-weight: 600; }
  .note { margin: 10px 0 0; color: #8b8b8b; font-size: 13px; }
  .bar {
    display: grid; grid-template-columns: 28px 56px minmax(0,1fr) minmax(0,24%) 64px; gap: 16px;
    align-items: center; padding: 12px; margin-top: 12px;
    border-bottom: 1px solid rgba(255,255,255,.09);
    color: #b3b3b3; font-size: 12px; letter-spacing: .1em; text-transform: uppercase;
  }
  .bar .n { text-align: right; }
  .bar .clock { justify-self: end; }
  .bar svg { width: 15px; height: 15px; fill: #b3b3b3; }
  ol { list-style: none; margin: 0; padding: 12px 0 0; }
  .row {
    display: grid; grid-template-columns: 28px 56px minmax(0,1fr) minmax(0,24%) 64px; gap: 16px;
    align-items: center; padding: 8px 12px; border-radius: 6px;
  }
  .row:hover { background: rgba(255,255,255,.07); }
  .n { color: #b3b3b3; font-size: 15px; text-align: right; font-variant-numeric: tabular-nums; }
  .art { width: 56px; height: 56px; border-radius: 4px; object-fit: cover; background: #282828; display: block; }
  .art-ph {
    display: grid; place-items: center; font-weight: 800; font-size: 20px; color: #fff;
    background: linear-gradient(135deg, #3a3a3a, #1e1e1e);
  }
  .t { min-width: 0; display: block; }
  .title { display: block; font-size: 15px; font-weight: 500; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .artist { display: block; font-size: 13px; color: #b3b3b3; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .album { font-size: 13px; color: #b3b3b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .time { font-size: 13px; color: #b3b3b3; text-align: right; font-variant-numeric: tabular-nums; }
  .foot {
    margin: 28px 0 56px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.09);
    color: #6f6f6f; font-size: 12px;
  }
  @media (max-width: 720px) {
    .c-album, .c-time { display: none; }
    .bar, .row { grid-template-columns: 24px 48px minmax(0,1fr); }
    .art { width: 48px; height: 48px; }
    .art-big { width: 132px; height: 132px; }
    .art-big svg { width: 64px; height: 64px; }
  }
  @media print {
    body { background: #fff; color: #111; }
    .hero { background: #fff; }
    h1, .title { color: #111; }
    .kind, .sub, .note, .artist, .album, .time, .n, .foot { color: #555; }
    .row:hover { background: none; }
    .art-ph { background: #eee; color: #666; }
  }
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap hero-in">
      <div class="art-big">${GLYPHS[glyph] || GLYPHS['thumb-down']}</div>
      <div>
        <div class="kind">${escapeHtml(kind)}</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="sub"><b>${escapeHtml(songsWord(list.length))}</b>${escapeHtml(subTotal)} · обновлено ${stamp(date)}</p>
        ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
      </div>
    </div>
  </header>

  <main class="wrap">
    <div class="bar">
      <span class="n">#</span>
      <span></span>
      <span>Название</span>
      <span class="c-album">Альбом</span>
      <span class="clock c-time"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/><path d="M8 3.25a.75.75 0 0 1 .75.75v3.94l2.4 1.38a.75.75 0 0 1-.75 1.3l-3.15-1.81V4A.75.75 0 0 1 8 3.25z"/></svg></span>
    </div>
    <ol>
${rows}
    </ol>
    <p class="foot">Страница собрана в Spotidrome · ${stamp(date)}. Файл самодостаточен: открывается без интернета и без доступа к серверу.</p>
  </main>
</body>
</html>
`;
}

const GLYPHS = {
  'thumb-down': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3v11.35l-2.58 6.04A1 1 0 0 1 12.5 21 3.5 3.5 0 0 1 9 17.5V14H6.04a3 3 0 0 1-2.94-3.6l1.2-6A3 3 0 0 1 7.24 2H15a1 1 0 0 1 1 1zm2 0h1.5A1.5 1.5 0 0 1 21 4.5v8a1.5 1.5 0 0 1-1.5 1.5H18V3z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.7-9.6-9.2C.6 8 2.6 4.5 6.2 4.5c2 0 3.3 1.1 4.1 2.2.8-1.1 2.1-2.2 4.1-2.2 3.6 0 5.6 3.5 3.8 7.3C19.5 16.3 12 21 12 21z"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3v11.6a4 4 0 1 1-2-3.46V6.7l-8 1.7v8.9a4 4 0 1 1-2-3.46V6l12-3z"/></svg>',
};

/**
 * Собрать обложки в виде data-URI, чтобы страница была самодостаточной.
 *
 * Обложку берём из кэша (а если её там нет — качаем), потом превращаем
 * в base64: ссылка на сервер в файле бесполезна, её всё равно никто не откроет.
 *
 * @param {Array}    tracks  [{ id, coverArt, albumId }]
 * @param {object}   o       { size, lanes, alive, onProgress }
 * @returns {Promise<Map<string,string>>} id трека → data-URI
 */
export async function collectCovers(tracks, o = {}) {
  const { size = COVER_SIZE, alive = () => true, onProgress } = o || {};
  const lanes = Math.max(1, Math.min(8, Number(o.lanes) || LANES));
  const covers = new Map();
  const items = (Array.isArray(tracks) ? tracks : []).filter((t) => t && (t.coverArt || t.albumId));
  if (!items.length || typeof fetch === 'undefined') return covers;

  // кэш обложек тянет за собой клиент API — грузим его только когда он и правда нужен
  const { resolveCover, remoteCover } = await import('./covers.js');

  let done = 0;
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length && alive()) {
      const t = items[cursor++];
      const id = t.coverArt || t.albumId;
      const uri = await oneCover(resolveCover, remoteCover, id, size);
      if (uri) covers.set(String(t.id), uri);
      done += 1;
      onProgress?.({ done, total: items.length, covers: covers.size });
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, () => lane()));
  return covers;
}

async function oneCover(resolveCover, remoteCover, id, size) {
  const sources = [];
  try {
    const src = await resolveCover(id, size);
    if (src) sources.push(src);
  } catch { /* кэш недоступен — пробуем напрямую */ }
  try {
    const direct = remoteCover(id, size);
    if (direct) sources.push(direct);
  } catch { /* сервер не отдаёт — обойдёмся заглушкой */ }

  for (const src of sources) {
    if (!src) continue;
    if (/^data:image\//i.test(src)) return src;
    try {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size || !/^image\//.test(blob.type || '')) continue;
      return await blobToDataUri(blob);
    } catch { /* не вышло — берём следующий источник */ }
  }
  return null;
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
    fr.onerror = () => reject(fr.error || new Error('не прочитать картинку'));
    fr.readAsDataURL(blob);
  });
}

/** Сколько весит готовая страница — чтобы понимать, можно ли её слать мессенджером. */
export const htmlSize = (html) => (typeof TextEncoder !== 'undefined'
  ? new TextEncoder().encode(String(html)).length
  : String(html).length);

/** Подпись для строки состояния: «12 из 40 обложек». */
export const coversWord = (n) => plural(n, 'обложка', 'обложки', 'обложек');
