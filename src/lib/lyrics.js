/* Тексты песен.

   Первый источник — сам сервер Navidrome/Subsonic (OpenSubsonic getLyricsBySongId,
   legacy getLyrics): он отдаёт то, что лежит в тегах трека или в .lrc рядом с файлом.
   Но на большинстве серверов текстов нет вообще, поэтому включаем второй источник —
   открытую базу LRCLIB (https://lrclib.net): там тексты уже синхронизированы с треком.

   Здесь: парсер LRC (включая расширенные отметки слов <mm:ss.xx>), матчинг
   названия/артиста, вежливый лимит запросов (LRCLIB просит не чаще одного запроса
   в секунду), обработка 429/Retry-After и кэш, чтобы тексты появлялись мгновенно.

   Формат результата совпадает с тем, что отдаёт api.getLyrics:
     { synced: bool, lines: [{ start: ms|null, text, words? }], source, url } */

const BASE = 'https://lrclib.net';
const MIN_INTERVAL = 1050;   // пауза между запросами к LRCLIB, мс
const TIMEOUT = 9000;        // сколько ждём ответ
const DISK_KEY = 'spotidrome-lyrics';
const DISK_MAX = 80;         // сколько треков держать в кэше на диске
const NEG_TTL = 1000 * 60 * 60 * 24 * 4;   // «не нашли» переспрашиваем через 4 дня

/* ---------------- текстовые утилиты ---------------- */

export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BRACKETS = /\s*[\[(][^\])]{0,80}[\])]/g;
const TAIL_NOISE = /\s*(?:[-–—|:.]\s*)?(?:official\s*(?:music\s*)?(?:video|audio|visuali[sz]er)?|lyrics?(?:\s*(?:video|lyrics))?|visuali[sz]er|explicit|clean(?:\s*version)?|remaster(?:ed)?(?:\s*\d{4})?|\d{4}\s*(?:version|remaster(?:ed)?)|(?:live\s*)?(?:version|take)\s*\d*)\s*$/gi;

/** «Bohemian Rhapsody (Official Video) [2011 Remaster]» → «Bohemian Rhapsody» */
export function cleanTitle(t) {
  const raw = String(t || '').trim();
  let s = raw.replace(BRACKETS, ' ');
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TAIL_NOISE, '').trim();
    if (next === s.trim()) break;
    s = next;
  }
  s = s.replace(/\s{2,}/g, ' ').replace(/[,.;:\-–—]\s*$/, '').trim();
  return s || raw;
}

/** «Queen ft. David Bowie» / «Queen feat. X» → «Queen» */
export function cleanArtist(a) {
  const raw = String(a || '').trim();
  let s = raw
    .replace(/\s*(?:\bfeat\.?|\bft\.?|\bvs\.?|\bversus\b|\bv\.\s|\bwith\s)\s+.*$/i, '')
    .replace(BRACKETS, ' ')
    .replace(/\s*&\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s || raw;
}

const wordsOf = (s) => new Set(normText(s).split(' ').filter(Boolean));

/** близость двух строк по набору слов, 0…1 */
export function similarity(a, b) {
  const A = wordsOf(a), B = wordsOf(b);
  if (!A.size || !B.size) return normText(a) === normText(b) ? 1 : 0;
  let same = 0;
  A.forEach((w) => { if (B.has(w)) same++; });
  return same / Math.max(A.size, B.size);
}

/* ---------------- парсер LRC ---------------- */

const LEAD_STAMP = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const META_TAG = /^\s*\[[a-z]{2,10}:[^\]]*\]/i;
const WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const OFFSET_TAG = /\[offset:\s*([+-]?\d+)\s*\]/i;

function toMs(min, sec, frac) {
  const f = String(frac ?? '');
  const part = f.length >= 3 ? Number(f.slice(0, 3)) : f.length === 2 ? Number(f) * 10 : f.length === 1 ? Number(f) * 100 : 0;
  return (Number(min) || 0) * 60000 + (Number(sec) || 0) * 1000 + (Number.isFinite(part) ? part : 0);
}

/** разбор расширенной строки со словами: «<00:12.10>Word<00:12.90>here» */
function parseWords(body) {
  if (body.indexOf('<') < 0) return null;
  const marks = [];
  WORD.lastIndex = 0;
  const plain = body.replace(WORD, (_, a, b, c) => { marks.push(toMs(a, b, c)); return '\u0000'; });
  if (!marks.length) return null;
  const segs = plain.split('\u0000');
  const words = marks.map((start, i) => ({ start, text: String(segs[i + 1] ?? '').trim() }));
  const lead = String(segs[0] || '').trim();
  if (lead) words[0] = { ...words[0], text: `${lead} ${words[0].text}`.trim() };
  const joined = words.map((w) => w.text).join(' ').trim();
  if (!joined || joined.length < body.replace(WORD, '').replace(/\s+/g, ' ').trim().length * 0.5) return null;
  return words.filter((w) => w.text).length ? words : null;
}

/**
 * LRC → [{ start, text, words? }]. Поддержка: несколько меток в начале строки,
 * [мм:сс], [мм:сс.мс], тег [offset:±мс], пустые строки-паузы, служебные теги.
 * Строки без метки времени игнорируются (для «несинхронного» текста есть свой путь).
 */
export function parseLrc(lrc) {
  const src = String(lrc || '');
  if (!src.trim()) return [];
  const global = OFFSET_TAG.exec(src);
  const shift = global ? Number(global[1]) || 0 : 0;
  const out = [];
  for (const rawLine of src.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    out.push(...oneLine(rawLine, shift));
  }
  out.sort((a, b) => a.start - b.start);
  // строки, начавшиеся в одну и ту же миллисекунду, дублировать не нужно
  return out.filter((l, i) => i === 0 || l.start !== out[i - 1].start || l.text !== out[i - 1].text);
}

/** одна строка LRC → 0…N строк текста (по числу меток времени в начале) */
function oneLine(line, shift) {
  let rest = String(line).replace(/\r$/, '');
  const stamps = [];
  for (;;) {
    // служебные теги вида [ti:…], [ar:…], [offset:…] просто пропускаем
    const meta = META_TAG.exec(rest);
    if (meta && !LEAD_STAMP.test(rest)) { rest = rest.slice(meta[0].length); continue; }
    const m = LEAD_STAMP.exec(rest);
    if (!m) break;
    stamps.push(toMs(m[1], m[2], m[3]));
    rest = rest.slice(m.index + m[0].length);
  }
  if (!stamps.length) return [];
  const text = rest.replace(/\s+/g, ' ').trim();
  if (!text) return stamps.map((start) => ({ start: Math.max(0, start + shift), text: '' }));
  const words = parseWords(text);
  const body = words ? words.map((w) => w.text).join(' ').trim() : text;
  return stamps.map((start) => {
    const row = { start: Math.max(0, start + shift), text: body };
    if (words) row.words = words.map((w) => ({ start: Math.max(0, w.start + shift), text: w.text }));
    return row;
  });
}

/** обычный текст (без таймкодов) → строки без start */
export function plainToLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((t) => ({ start: null, text: t.replace(/\s+$/, '') }));
}

/* ---------------- лимит запросов к LRCLIB ---------------- */

let chain = Promise.resolve();
let lastAt = 0;
let blockedUntil = 0;
let stats = { sent: 0, hits: 0, misses: 0, waits: 0, lastError: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const lrclibStats = () => ({ ...stats, paused: Math.max(0, blockedUntil - Date.now()) });

function schedule(fn) {
  const run = async () => {
    const now = Date.now();
    const wait = Math.max(0, Math.max(blockedUntil - now, lastAt + MIN_INTERVAL - now));
    if (wait > 0) { stats.waits++; await sleep(wait); }
    lastAt = Date.now();
    return fn();
  };
  chain = chain.then(run, run);
  return chain;
}

const RETRIES = 2;   // сколько раз всего пробуем (1 + повторы при 429/5xx)

async function requestOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  stats.sent++;
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 404) { stats.misses++; return null; }          // просто «нет в базе»
    if (res.status === 429 || res.status === 503 || res.status >= 500) {
      const ra = Number(res.headers?.get?.('retry-after')) || 2;
      blockedUntil = Math.max(blockedUntil, Date.now() + Math.min(30, Math.max(1, ra)) * 1000);
      const err = new Error(res.status === 429 ? 'LRCLIB: слишком часто, пауза' : 'LRCLIB: сервер занят');
      err.retryable = true;
      throw err;
    }
    if (!res.ok) throw Object.assign(new Error(`LRCLIB: HTTP ${res.status}`), { retryable: false });
    const json = await res.json();
    if (!json || (typeof json === 'object' && !Array.isArray(json) && !Object.keys(json).length)) return null;
    return json;
  } catch (e) {
    stats.lastError = e?.name === 'AbortError' ? 'LRCLIB: таймаут запроса' : String(e?.message || e);
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { retryable: e?.retryable !== false });
  } finally {
    clearTimeout(timer);
  }
}

/** запрос через общий лимитер, с одним повтором при 429/503/таймауте */
async function request(path, params) {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  let lastErr = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await schedule(() => requestOnce(url));
    } catch (e) {
      lastErr = e;
      if (e?.retryable === false || attempt === RETRIES - 1) break;
      await sleep(Math.min(8000, 1600 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('LRCLIB: запрос не выполнен');
}

/* ---------------- результат LRCLIB → формат плеера ---------------- */

const hasSync = (r) => !!(r && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim());
const hasPlain = (r) => !!(r && typeof r.plainLyrics === 'string' && r.plainLyrics.trim());

export function fromLrclib(r) {
  if (!r) return null;
  if (hasSync(r)) {
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length) {
      return {
        synced: true,
        lines,
        source: 'lrclib',
        url: r.id ? `${BASE}/track/${r.id}` : `${BASE}`,
        meta: { id: r.id, artist: r.artistName, title: r.trackName, album: r.albumName, duration: r.duration, count: lines.length },
      };
    }
  }
  if (hasPlain(r)) {
    return {
      synced: false,
      lines: plainToLines(r.plainLyrics),
      source: 'lrclib',
      url: r.id ? `${BASE}/track/${r.id}` : BASE,
      meta: { id: r.id, artist: r.artistName, title: r.trackName, album: r.albumName, duration: r.duration },
    };
  }
  if (r.instrumental) return { synced: false, lines: [], source: 'lrclib', instrumental: true, url: r.id ? `${BASE}/track/${r.id}` : BASE };
  return null;
}

/* ---------------- подбор лучшего совпадения из /api/search ---------------- */

function score(r, q) {
  if (!hasSync(r) && !hasPlain(r)) return -1;
  const ts = similarity(r.trackName, q.track_name);
  const as = similarity(r.artistName, q.artist_name);
  if (ts < 0.5 || as < 0.45) return -1;
  let s = hasSync(r) ? 7 : 1.5;
  s += ts * 3 + as * 2;
  if (q.album_name && similarity(r.albumName, q.album_name) > 0.5) s += 1;
  if (q.duration && r.duration) s -= Math.min(4, Math.abs(r.duration - q.duration) / 10);
  return s;
}

function pickBest(list, q) {
  let best = null, bestScore = 0;
  for (const r of list || []) {
    const s = score(r, q);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

/* ---------------- кэш ---------------- */

const mem = new Map();     // key → { at, lyrics | none }
let diskLoaded = false;

function loadDisk() {
  if (diskLoaded) return;
  diskLoaded = true;
  let raw = null;
  try { raw = globalThis.localStorage?.getItem(DISK_KEY); } catch { return; }
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj || {})) {
      if (!v || typeof v !== 'object') continue;
      if (!v.lyrics && !v.none) continue;
      if (v.none && Date.now() - (v.at || 0) > NEG_TTL) continue;
      mem.set(k, { at: v.at || 0, lyrics: v.lyrics || null, none: !!v.none });
    }
  } catch { /* повреждённый кэш просто игнорируем */ }
}

let saveTimer = null;
function saveDisk() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const obj = {};
    [...mem.entries()]
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, DISK_MAX)
      .forEach(([k, v]) => { obj[k] = { at: v.at, lyrics: v.lyrics || null, none: !!v.none }; });
    try { globalThis.localStorage?.setItem(DISK_KEY, JSON.stringify(obj)); } catch {}
  }, 800);
}

export function trackKey(song) {
  const title = cleanTitle(song?.title);
  const artist = cleanArtist(song?.artist);
  const dur = Math.round(Number(song?.duration) || 0);
  return `l:${normText(artist)}|${normText(title)}|${dur}`;
}

/** есть ли уже готовый текст в кэше (для предзагрузки) */
export function peekLyrics(song) {
  if (!song) return null;
  loadDisk();
  const hit = mem.get(trackKey(song));
  if (!hit || hit.none) return null;
  return hit.lyrics || null;
}

export function putLyrics(song, lyrics) {
  if (!song) return;
  loadDisk();
  mem.set(trackKey(song), { at: Date.now(), lyrics: lyrics || null, none: !lyrics });
  saveDisk();
}

export function clearLyricsCache() {
  mem.clear();
  try { globalThis.localStorage?.removeItem(DISK_KEY); } catch {}
  return true;
}

/* ---------------- главный вход ---------------- */

/**
 * Ищем текст трека в LRCLIB.
 * @param {object} song { title, artist, album, duration }
 * @param {{ force?: boolean, light?: boolean }} opts
 *        force — обойти кэш; light — минимум запросов (для предзагрузки соседних треков)
 * @returns {Promise<null | { synced, lines, source, url }>}
 */
export async function lrclibLyrics(song, opts = {}) {
  if (!song) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  loadDisk();

  const key = trackKey(song);
  const cached = mem.get(key);
  if (!opts.force && cached && Date.now() - (cached.at || 0) < (cached.none ? NEG_TTL : Infinity)) {
    return cached.lyrics || null;
  }

  const title = cleanTitle(song.title);
  const rawTitle = String(song.title || '').trim();
  const artist = cleanArtist(song.artist);
  if (!title || !artist) return null;
  const album = cleanTitle(song.album || '');
  const duration = Math.round(Number(song.duration) || 0) || undefined;

  const q = { artist_name: artist, track_name: title, album_name: album, duration };
  // сначала точный запрос, потом — без альбома/длительности (они в Navidrome часто «другие»)
  const gets = [];
  gets.push({ artist_name: artist, track_name: title, ...(album ? { album_name: album } : {}), ...(duration ? { duration: String(duration) } : {}) });
  if (album || duration) gets.push({ artist_name: artist, track_name: title });
  if (normText(rawTitle) !== normText(title)) gets.push({ artist_name: artist, track_name: rawTitle });
  if (opts.light) gets.length = 1;

  let found = null;
  let instrumental = false;
  let errored = false;

  // 1) /api/get — точное совпадение, лучший вариант отдаёт сам сервис
  for (const params of gets) {
    if (found) break;
    let r = null;
    try { r = await request('/api/get', params); }
    catch { errored = true; continue; }
    if (!r) continue;
    if (r.instrumental && !hasPlain(r) && !hasSync(r)) instrumental = true;
    found = fromLrclib(r);
  }

  // 2) /api/search — список вариантов, выбираем самый близкий по названию/артисту/длине
  if (!found) {
    let list = null;
    try {
      list = await request('/api/search', duration && !opts.light
        ? { artist_name: artist, track_name: title, duration: String(duration) }
        : { artist_name: artist, track_name: title });
    } catch { errored = true; }
    const arr = Array.isArray(list) ? list : [];
    found = fromLrclib(pickBest(arr, q));
    if (!found && !opts.light && arr.length) {
      try {
        const loose = await request('/api/search', { q: `${artist} ${title}` });
        found = fromLrclib(pickBest(Array.isArray(loose) ? loose : [], q));
      } catch { errored = true; }
    }
  }

  if (found) {
    stats.hits++;
    mem.set(key, { at: Date.now(), lyrics: found, none: false });
    saveDisk();
    return found;
  }
  if (instrumental && !errored) {
    const res = { synced: false, lines: [], source: 'lrclib', instrumental: true, url: BASE };
    mem.set(key, { at: Date.now(), lyrics: res, none: false });
    saveDisk();
    return res;
  }
  // «не нашли» кэшируем только когда запросы реально прошли (иначе сети нет — спросим позже)
  if (!errored) { stats.misses++; mem.set(key, { at: Date.now(), lyrics: null, none: true }); saveDisk(); }
  return null;
}

/**
 * Есть ли смысл искать синхронный текст в LRCLIB вместо локального несинхронного:
 * сравниваем сами тексты, чтобы не подсовывать чужие слова.
 */
export function sameLyrics(a, b) {
  const ta = (a || []).map((l) => l.text).join(' ');
  const tb = (b || []).map((l) => l.text).join(' ');
  if (!ta.trim() || !tb.trim()) return false;
  return similarity(ta, tb) > 0.3;
}

export default { lrclibLyrics, parseLrc, clearLyricsCache, peekLyrics, lrclibStats };
