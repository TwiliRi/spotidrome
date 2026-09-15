/* HTML-страница одного трека — чтобы можно было скинуть её человеку:
   звук вклеен внутрь, текст песни внизу, выглядит как страница Spotify.
   Файл самодостаточен: стили внутри, обложка и звук — data-URI, ни одного
   внешнего шрифта или скрипта. У того, кому скинули, доступа к Navidrome
   нет, поэтому ссылок на сервер в файле быть не должно. */

import { escapeHtml, safeCover, initials, htmlSize } from './pageExport.js';
import { fmt } from './util.js';

/* ---------------- имя файла ---------------- */

const RUS = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** «Гравитация — Города» → «gravitatsiya-goroda»: имя файла должно быть латиницей. */
export function slug(value, max = 40) {
  const s = String(value || '')
    .toLowerCase()
    .replace(/[а-яё]/g, (c) => RUS[c] || '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/, '');
}

const fileDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** spotidrome-ispolnitel-nazvanie-2026-09-13.html */
export function trackPageName(track, d = new Date()) {
  const parts = [track?.artist, track?.title].map((s) => slug(s)).filter(Boolean);
  return `spotidrome-${(parts.join('-') || 'track').slice(0, 60)}-${fileDate(d)}.html`;
}

/* ---------------- цвет под обложку (как в Spotify) ---------------- */

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Тот же цвет, но темнее/светлее: из него собираем градиент шапки. */
export function shade(hex, k, min = 0) {
  const rgb = parseHex(hex);
  if (!rgb) return '#2f2f2f';
  const [r, g, b] = rgb.map((v) => (k >= 1 ? clamp(v + (255 - v) * (k - 1)) : Math.max(min, clamp(v * k))));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/* ---------------- короткий звук для демо-библиотеки ---------------- */

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Длина звука-заглушки: столько, чтобы в неё попала хотя бы первая строка
 * текста песни (в демо-библиотеке текст разложен по длительности трека) —
 * иначе синхронную подсветку просто не на чем показать.
 */
export const demoToneSeconds = (track) => {
  const d = Number(track?.duration) || 200;
  return Math.min(40, Math.max(12, Math.round(d * 0.15)));
};

/**
 * В демо-библиотеке настоящего звука нет (плеер просто считает секунды),
 * поэтому в страницу кладём мягкий тон — страница всё равно играет
 * и видно, как работает синхронный текст.
 * @param {number|object} seconds сколько секунд (или сам трек)
 */
export function demoAudio(seconds = 8) {
  const secs = typeof seconds === 'number' ? seconds : demoToneSeconds(seconds);
  const rate = 8000;
  const n = Math.max(1, Math.floor(rate * secs));
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const tag = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.4, (secs - t) / 0.6);
    const v = (Math.sin(2 * Math.PI * 220 * t) * 0.5 + Math.sin(2 * Math.PI * 330 * t) * 0.3 + Math.sin(2 * Math.PI * 440 * t) * 0.2)
      * 0.25 * Math.max(0, fade) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 1.5 * t));
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true);
  }
  return { mime: 'audio/wav', b64: b64(new Uint8Array(buf)) };
}

/* ---------------- страница ---------------- */

const GLYPH_PLAY = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.74l-11-6.86A1 1 0 0 0 8 5.14Z" fill="currentColor"/></svg>';
const GLYPH_VOL_HIGH = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11.6 3.4a1 1 0 0 0-1.63-.78L5.98 6H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2.98l3.99 3.38a1 1 0 0 0 1.63-.77V3.4Z" fill="currentColor"/><path d="M15.4 7.2a1 1 0 0 1 1.4.16 6.6 6.6 0 0 1 0 8.78 1 1 0 1 1-1.53-1.28 4.6 4.6 0 0 0 0-6.22 1 1 0 0 1 .13-1.44Z" fill="currentColor"/><path d="M18.1 4.1a1 1 0 0 1 1.41.13 10.1 10.1 0 0 1 0 13.54 1 1 0 1 1-1.54-1.28 8.1 8.1 0 0 0 0-10.98 1 1 0 0 1 .13-1.41Z" fill="currentColor"/></svg>';
const GLYPH_VOL_LOW = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11.6 3.4a1 1 0 0 0-1.63-.78L5.98 6H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2.98l3.99 3.38a1 1 0 0 0 1.63-.77V3.4Z" fill="currentColor"/><path d="M15.4 7.2a1 1 0 0 1 1.4.16 6.6 6.6 0 0 1 0 8.78 1 1 0 1 1-1.53-1.28 4.6 4.6 0 0 0 0-6.22 1 1 0 0 1 .13-1.44Z" fill="currentColor"/></svg>';
const GLYPH_VOL_MUTE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11.6 3.4a1 1 0 0 0-1.63-.78L5.98 6H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2.98l3.99 3.38a1 1 0 0 0 1.63-.77V3.4Z" fill="currentColor"/><path d="M16.3 9.3a1 1 0 0 1 1.4 0l1.8 1.79 1.8-1.8a1 1 0 0 1 1.4 1.42L20.9 13l1.8 1.8a1 1 0 0 1-1.4 1.4l-1.8-1.78-1.8 1.8a1 1 0 0 1-1.4-1.42l1.78-1.8-1.8-1.79a1 1 0 0 1 0-1.41Z" fill="currentColor"/></svg>';
const GLYPH_PAUSE = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor"/></svg>';

/**
 * Готовый документ.
 * @param {object} track  { title, artist, album, year, duration }
 * @param {object} o      { cover, audio:{mime,b64}, lyrics:{synced,lines}, accent, date, note }
 */
export function buildTrackPageHtml(track, o = {}) {
  const { cover = '', audio = null, lyrics = null, accent = '#2f6f4f', date = new Date(), note = '', volume = 10 } = o ?? {};
  const t = track || {};
  const title = escapeHtml(t.title || 'Без названия');
  const artist = escapeHtml(t.artist || 'Неизвестный исполнитель');
  const album = escapeHtml(t.album || '');
  const year = Number(t.year) > 0 ? String(Number(t.year)) : '';
  const dur = fmt(Number(t.duration) || 0);
  const art = safeCover(cover);
  const from = shade(accent, 1.05);
  const to = shade(accent, 0.35, 14);
  const stamp = escapeHtml(date.toLocaleString('ru-RU', { dateStyle: 'long' }));
  const lines = Array.isArray(lyrics?.lines) ? lyrics.lines.filter((l) => l && String(l.text || '').trim() !== '') : [];
  const synced = !!lyrics?.synced && lines.some((l) => l.start != null);
  const hasAudio = !!audio?.b64;
  // громкость по умолчанию: страницу открывают там, где тихо, не надо орать
  const volPct = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
  const volGlyph = volPct <= 0 ? GLYPH_VOL_MUTE : volPct < 50 ? GLYPH_VOL_LOW : GLYPH_VOL_HIGH;

  const bodyLines = lines.length
    ? lines.map((l) => {
      const time = synced && l.start != null ? ` data-t="${(Number(l.start) / 1000).toFixed(2)}"` : '';
      return `        <p class="l${synced ? '' : ' plain'}"${time}>${escapeHtml(l.text)}</p>`;
    }).join('\n')
    : `        <p class="empty">Текст песни не найден.</p>`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${artist} · Spotidrome</title>
<style>
  :root { --green: #1ed760; --fg: #fff; --dim: #a7a7a7; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #000; color: var(--fg);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 24px; }
  .hero { background: linear-gradient(180deg, ${from} 0%, ${to} 100%); padding: 40px 0 24px; }
  .hero .wrap { display: flex; align-items: flex-end; gap: 24px; }
  .art-big {
    flex: 0 0 auto; width: 232px; height: 232px; border-radius: 6px; overflow: hidden;
    background: #282828; box-shadow: 0 8px 40px rgba(0,0,0,.5); display: grid; place-items: center;
  }
  .art-big img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .art-ph { width: 100%; height: 100%; display: grid; place-items: center; background: #3a3a3a;
    font-size: 64px; font-weight: 700; color: #fff; opacity: .8; letter-spacing: .02em; }
  .kind { font-size: 12px; text-transform: uppercase; letter-spacing: .12em; opacity: .85; margin-bottom: 8px; }
  h1 { margin: 0 0 12px; font-size: clamp(30px, 6vw, 64px); line-height: 1.05; font-weight: 900; letter-spacing: -.03em; }
  .sub { margin: 0; font-size: 15px; color: rgba(255,255,255,.9); }
  .sub b { font-weight: 700; }
  main { padding: 24px 0 8px; }
  .playrow { display: none; align-items: center; gap: 16px; margin: 8px 0 4px; }
  .play {
    flex: 0 0 auto; width: 56px; height: 56px; border: 0; border-radius: 50%; background: var(--green);
    color: #000; display: grid; place-items: center; cursor: pointer; transition: transform .12s, background .12s;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
  }
  .play:hover { transform: scale(1.05); background: #1fdf64; }
  .play:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .bar { flex: 1 1 auto; height: 6px; border-radius: 3px; background: #4a4a4a; cursor: pointer; position: relative; }
  .fill { width: 0; height: 100%; border-radius: 3px; background: #fff; position: relative; }
  .fill::after {
    content: ""; position: absolute; right: -6px; top: 50%; margin-top: -6px;
    width: 12px; height: 12px; border-radius: 50%; background: #fff; opacity: 0; transition: opacity .12s;
  }
  .bar:hover .fill { background: var(--green); }
  .bar:hover .fill::after { opacity: 1; }
  .time { flex: 0 0 auto; min-width: 96px; text-align: right; font-size: 13px; color: var(--dim); font-variant-numeric: tabular-nums; }
  .vol { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; width: 142px; }
  .vol-btn {
    border: 0; background: none; color: var(--dim); padding: 0; cursor: pointer;
    display: grid; place-items: center; transition: color .12s;
  }
  .vol-btn:hover { color: #fff; }
  .vol-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 3px; }
  .vbar { flex: 0 0 auto; width: 104px; }
  .vbar:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .hint { margin: 6px 0 0; font-size: 13px; color: var(--dim); }
  audio { display: block; width: 100%; margin: 16px 0; }
  .lyrics { margin-top: 32px; }
  .lyrics h2 { font-size: 20px; margin: 0 0 14px; }
  .lines { max-height: 58vh; overflow-y: auto; padding-right: 8px; scrollbar-width: thin; }
  .l { margin: 0 0 10px; font-size: 24px; font-weight: 700; line-height: 1.28; letter-spacing: -.01em; color: #7d7d7d; transition: color .25s; }
  .l.plain { font-size: 18px; font-weight: 500; color: #e6e6e6; }
  .l.empty { font-size: 16px; font-weight: 400; color: var(--dim); }
  .synced .l.on { color: #fff; }
  footer { margin: 40px 0 0; padding-top: 16px; border-top: 1px solid #282828; font-size: 12px; color: var(--dim); }
  @media (max-width: 720px) {
    .hero .wrap { flex-direction: column; align-items: flex-start; gap: 16px; }
    .art-big { width: 168px; height: 168px; }
    .l { font-size: 20px; }
    .time { min-width: 76px; }
    .vol { width: 96px; }
    .vbar { width: 62px; }
  }
  @media print {
    body { background: #fff; color: #000; }
    .hero { background: #fff !important; color: #000; }
    .sub { color: #333; }
    .playrow, audio { display: none !important; }
    .l { color: #111; } .l.plain { color: #222; }
    footer { color: #555; border-top-color: #ddd; }
  }
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <div class="art-big">${art ? `<img alt="" src="${art}">` : `<div class="art-ph">${escapeHtml(initials(t.album || t.title || '?'))}</div>`}</div>
      <div>
        <div class="kind">Трек</div>
        <h1>${title}</h1>
        <p class="sub"><b>${artist}</b>${album ? ` · ${album}` : ''}${year ? ` · ${year}` : ''}${dur && dur !== '0:00' ? ` · ${dur}` : ''}</p>
      </div>
    </div>
  </header>

  <main class="wrap">
${hasAudio ? `    <div class="playrow" id="playrow">
      <button class="play" id="pb" type="button" aria-label="Играть">${GLYPH_PLAY}</button>
      <div class="bar" id="bar"><div class="fill" id="fill"></div></div>
      <div class="time"><span id="t">0:00</span> / <span id="d">${dur || '--:--'}</span></div>
      <div class="vol">
        <button class="vol-btn" id="mute" type="button" aria-label="${volPct > 0 ? 'Выключить звук' : 'Включить звук'}">${volGlyph}</button>
        <div class="bar vbar" id="vbar" role="slider" tabindex="0" aria-label="Громкость"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="${volPct}"><div class="fill" id="vfill" style="width:${volPct}%"></div></div>
      </div>
    </div>
    <audio id="audio" controls preload="metadata" src="data:${audio.mime};base64,${audio.b64}"></audio>
    <p class="hint">Звук встроен в файл: страница играет без интернета и без доступа к фонотеке.</p>` : `    <p class="hint">Звук в файл не попал — слышать страницу не получится, но текст и обложка на месте.</p>`}
${note ? `    <p class="hint">${escapeHtml(note)}</p>` : ''}

    <section class="lyrics${synced ? ' synced' : ''}">
      <h2>Текст песни</h2>
      <div class="lines" id="lines">
${bodyLines}
      </div>
    </section>

    <footer>Страница собрана в Spotidrome · ${stamp}</footer>
  </main>

<script>
(function () {
  var a = document.getElementById('audio');
  var row = document.getElementById('playrow');
  if (!a || !row) return;                       // звука нет — страница просто текст
  // свой плеер вместо родного: без JS остаются стандартные controllers
  a.removeAttribute('controls');
  a.style.display = 'none';
  row.style.display = 'flex';

  var pb = document.getElementById('pb');
  var bar = document.getElementById('bar');
  var fill = document.getElementById('fill');
  var cur = document.getElementById('t');
  var durEl = document.getElementById('d');
  var box = document.getElementById('lines');
  var lines = [].slice.call(box.querySelectorAll('.l[data-t]'));
  var last = -1;

  function f(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function paint() {
    var p = a.paused;
    pb.innerHTML = p
      ? '${GLYPH_PLAY.replace(/'/g, "\\'")}'
      : '${GLYPH_PAUSE.replace(/'/g, "\\'")}';
    pb.setAttribute('aria-label', p ? 'Играть' : 'Пауза');
  }
  pb.onclick = function () { a.paused ? a.play() : a.pause(); };
  a.onplay = paint; a.onpause = paint; a.onended = paint;
  a.onloadedmetadata = function () { if (a.duration && isFinite(a.duration)) durEl.textContent = f(a.duration); };
  a.ontimeupdate = function () {
    cur.textContent = f(a.currentTime);
    fill.style.width = ((a.currentTime / (a.duration || 1)) * 100) + '%';
    var k = -1;
    for (var i = 0; i < lines.length; i++) { if (parseFloat(lines[i].getAttribute('data-t')) <= a.currentTime + 0.15) k = i; else break; }
    if (k === last) return;
    last = k;
    for (var i = 0; i < lines.length; i++) lines[i].classList.toggle('on', i === k);
    var el = lines[k];
    if (el && box.scrollHeight > box.clientHeight) {
      box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
    }
  };
  bar.onclick = function (e) {
    if (!a.duration) return;
    var r = bar.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
  };

  /* громкость: ползунок + кнопка «без звука», по умолчанию ${volPct}% */
  var muteBtn = document.getElementById('mute');
  var vbar = document.getElementById('vbar');
  var vfill = document.getElementById('vfill');
  var vol = Math.max(0, Math.min(1, ${volPct} / 100));
  var lastVol = vol > 0 ? vol : 0.1;            // куда вернуться после выключения

  function setVol(v) {
    vol = Math.max(0, Math.min(1, v));
    if (vol > 0) lastVol = vol;
    a.volume = vol;
    a.muted = vol === 0;
    vfill.style.width = (vol * 100) + '%';
    vbar.setAttribute('aria-valuenow', Math.round(vol * 100));
    muteBtn.innerHTML = vol <= 0
      ? '${GLYPH_VOL_MUTE.replace(/'/g, "\\'")}'
      : (vol < 0.5 ? '${GLYPH_VOL_LOW.replace(/'/g, "\\'")}' : '${GLYPH_VOL_HIGH.replace(/'/g, "\\'")}');
    muteBtn.setAttribute('aria-label', vol > 0 ? 'Выключить звук' : 'Включить звук');
  }
  muteBtn.onclick = function () { setVol(vol > 0 ? 0 : lastVol); };

  function byPointer(e) {
    var r = vbar.getBoundingClientRect();
    setVol((e.clientX - r.left) / r.width);
  }
  var dragging = false;
  vbar.addEventListener('pointerdown', function (e) { dragging = true; byPointer(e); e.preventDefault(); });
  document.addEventListener('pointermove', function (e) { if (dragging) byPointer(e); });
  document.addEventListener('pointerup', function () { dragging = false; });
  vbar.addEventListener('keydown', function (e) {
    var step = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 0.05
      : (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? -0.05 : 0;
    if (e.key === 'Home') { setVol(0); return e.preventDefault(); }
    if (e.key === 'End') { setVol(1); return e.preventDefault(); }
    if (!step) return;
    setVol(vol + step);
    e.preventDefault();
  });
  setVol(vol);
  paint();
})();
</script>
</body>
</html>`;
}

export { htmlSize };

/* всё ниже — уже с сетью и файлами, подгружается только по клику */

/**
 * Тянем звук трека и превращаем его в data-URI.
 * Порядок: офлайн-кэш → сеть (fetch) → десктоп (main-процесс, где CORS не помеха).
 * @returns {Promise<{mime:string,b64:string}|null>}
 */
export async function collectTrackAudio(src, o = {}) {
  const { alive, onProgress, maxBytes = 150 * 1024 * 1024, demo, track } = o ?? {};
  if (demo) return demoAudio(track);
  const url = String(src || '');
  if (!url) return null;

  const toDataUri = async (blob) => {
    if (blob.size > maxBytes) throw new Error('слишком большой файл');
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('не прочитать файл'));
      fr.readAsDataURL(blob);
    });
  };
  const split = (uri) => {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(uri);
    return m ? { mime: m[1], b64: m[2] } : null;
  };

  // 1. обычный fetch — сработает на офлайн-схеме и на сервере с CORS
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    if (total > maxBytes) throw new Error('слишком большой файл');
    if (!res.body) return split(await toDataUri(await res.blob()));
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (alive && !alive()) return null;
      chunks.push(value);
      loaded += value?.length || 0;
      if (loaded > maxBytes) throw new Error('слишком большой файл');
      onProgress?.({ loaded, total });
    }
    const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
    return split(await toDataUri(blob));
  } catch { /* пробуем десктоп */ }

  // 2. десктоп: в main-процессе запрос идёт мимо CORS
  const desktop = typeof window !== 'undefined' ? window.desktop : null;
  if (desktop?.audioBase64 && /^https?:/i.test(url)) {
    try {
      const got = await desktop.audioBase64({ url, maxBytes });
      if (got?.ok && got.base64) return { mime: got.mime || 'audio/mpeg', b64: got.base64 };
    } catch { /* нет так нет */ }
  }
  return null;
}

/** Обложка трека — тоже вклеиваем, иначе у получателя она не откроется. */
export async function collectTrackCover(track, o = {}) {
  if (!track) return '';
  const { collectCovers } = await import('./pageExport.js');
  const map = await collectCovers([track], { size: 300, lanes: 1, ...o });
  return map.get(track.id) || '';
}

/** Текст песни: сначала то, что уже лежит в кэше приложения, потом сеть. */
export async function collectTrackLyrics(track, o = {}) {
  if (!track) return null;
  const api = (await import('./api.js')).default;
  const got = await api.getLyrics(track, { lrclib: o.allowNet !== false }).catch(() => null);
  const lines = (got?.lines || []).filter((l) => l && String(l.text || '').trim() !== '');
  if (!lines.length) return null;
  return { synced: !!got.synced, lines };
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;

/**
 * Собрать и сохранить страницу трека.
 * @param {object} track
 * @param {object} o { src, accent, allowNet, alive, onProgress }
 * @returns {Promise<{ok:boolean, path?:string, name?:string, size?:number, audio?:boolean, canceled?:boolean}>}
 */
export async function shareTrackPage(track, o = {}) {
  if (!track) return { ok: false };
  const { src = '', accent = '#2f6f4f', allowNet = true, alive, onProgress } = o ?? {};
  const api = (await import('./api.js')).default;
  const { saveTextFile } = await import('./saveFile.js');

  onProgress?.({ stage: 'cover' });
  const cover = await collectTrackCover(track, { alive }).catch(() => '');
  if (alive && !alive()) return { ok: false, canceled: true };

  onProgress?.({ stage: 'audio' });
  const audio = await collectTrackAudio(src, { alive, demo: api.demo, onProgress, track }).catch(() => null);
  if (alive && !alive()) return { ok: false, canceled: true };

  onProgress?.({ stage: 'lyrics' });
  const lyrics = await collectTrackLyrics(track, { allowNet }).catch(() => null);
  if (alive && !alive()) return { ok: false, canceled: true };

  onProgress?.({ stage: 'file' });
  // вес файла известен заранее: звук и обложка лежат в нём как есть
  const weight = (audio?.b64?.length || 0) + (cover?.length || 0) + 4096;
  const html = buildTrackPageHtml(track, {
    cover, audio, lyrics, accent,
    note: audio ? `Звук внутри: файл весит около ${mb(weight)}.` : '',
  });
  const name = trackPageName(track);
  const saved = await saveTextFile(name, html, { ext: 'html', title: 'Сохранить страницу трека' }).catch(() => null);
  if (!saved || saved.canceled) return { ok: false, canceled: true };
  return { ok: true, path: saved.path || name, name, size: htmlSize(html), audio: !!audio, lyrics: !!lyrics, cover: !!cover };
}
