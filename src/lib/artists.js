/* Несколько исполнителей у одного трека/альбома.
 *
 * Источники, по убыванию надёжности:
 *   1. OpenSubsonic-поля `artists` / `albumArtists` / `participants.artist` — массив { id, name };
 *   2. строка `displayArtist` / `artist` — разбираем по разделителям.
 *
 * У имён, полученных разбором строки, нет id: их разрешаем через поиск на сервере
 * (с кэшем). Разделители вроде «&» опасны — «Simon & Garfunkel» это один коллектив,
 * а «Yeat & Summrs» это двое, поэтому такие случаи проверяются на сервере:
 * если вся строка целиком есть в списке исполнителей — не разрезаем.
 */
import api from './api.js';

/* Безопасные разделители: внутри имени практически не встречаются. */
const SAFE = String.raw`,|;|/|\||·|•`;
/* Явное участие: «feat.», «ft.», «with», «vs» — почти всегда несколько человек. */
const STRONG = String.raw`\bfeat\.|\bfeat\b|\bft\.|\bft\b|\bfeaturing\b|\bwith\b|\bvs\.|\bvs\b`;
/* Спорные: часто входят в само название («Simon & Garfunkel», «Море и Небо»).
 * По ним режем, только если такого исполнителя целиком нет в библиотеке. */
const WEAK = String.raw`&|\+|×|\bx\b|\bX\b|\bи\b|\band\b`;

const SEP_RE = new RegExp(`(\\s*(?:${SAFE}|${STRONG}|${WEAK})\\s*)`, 'gi');
const SAFE_RE = new RegExp(`(\\s*(?:${SAFE})\\s*)`, 'gi');
const STRONG_RE = new RegExp(`(\\s*(?:${STRONG})\\s*)`, 'gi');
const WEAK_RE = new RegExp(`(\\s*(?:${WEAK})\\s*)`, 'gi');
const HAS_WEAK = new RegExp(`(?:${WEAK})`, 'i');

const clean = (s) => String(s || '').trim();
const key = (s) => clean(s).toLowerCase();

function fromServer(item) {
  const raw =
    (Array.isArray(item?.artists) && item.artists) ||
    (Array.isArray(item?.albumArtists) && item.albumArtists) ||
    (Array.isArray(item?.participants?.artist) && item.participants.artist) ||
    (Array.isArray(item?.participants?.albumartist) && item.participants.albumartist) ||
    null;
  if (!raw) return null;
  const out = [];
  const seen = new Set();
  raw.forEach((a) => {
    const name = clean(a?.name);
    if (!name || seen.has(key(name))) return;
    seen.add(key(name));
    out.push({ id: a?.id || null, name });
  });
  return out.length ? out : null;
}

/** Разбор строки «A feat. B, C» на токены с сохранением исходных разделителей. */
export function splitArtistString(str, re = SEP_RE) {
  const s = clean(str);
  if (!s) return [];
  const chunks = s.split(re);
  const tokens = [];
  chunks.forEach((piece, i) => {
    if (i % 2) tokens.push({ type: 'sep', text: piece });
    else if (clean(piece)) tokens.push({ type: 'artist', name: clean(piece) });
  });
  while (tokens.length && tokens[tokens.length - 1].type === 'sep') tokens.pop();
  while (tokens.length && tokens[0].type === 'sep') tokens.shift();
  return tokens;
}

/** Разложить исходную надпись («A feat. B») по известным именам, сохранив
 *  союзы и знаки препинания как есть. null, если строка не подходит. */
function tokensFromDisplay(display, list) {
  const str = clean(display);
  if (!str || !list.length) return null;
  const lower = str.toLowerCase();
  const spans = [];
  for (const a of list) {
    const at = lower.indexOf(key(a.name));
    if (at < 0) return null;                     // имени нет в надписи — не рискуем
    spans.push({ start: at, end: at + a.name.length, a });
  }
  spans.sort((x, y) => x.start - y.start);
  for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) return null;

  const tokens = [];
  let pos = 0;
  spans.forEach((sp) => {
    if (sp.start > pos) tokens.push({ type: 'sep', text: str.slice(pos, sp.start) });
    tokens.push({ type: 'artist', id: sp.a.id, name: str.slice(sp.start, sp.end) });
    pos = sp.end;
  });
  if (pos < str.length && str.slice(pos).trim()) tokens.push({ type: 'sep', text: str.slice(pos) });
  return tokens;
}

const displayOf = (item) => clean(item?.displayArtist || item?.artist || item?.name);
const single = (name, id) => [{ type: 'artist', id: id || null, name }];

/**
 * Мгновенные токены для отрисовки (без обращений к серверу):
 * [{type:'artist', id, name} | {type:'sep', text}]
 */
export function artistTokens(item) {
  if (!item) return [];
  const display = displayOf(item);
  const server = fromServer(item);
  if (server) return tokensFromDisplay(display, server) || joinTokens(server);

  const cached = tokenCache.get(cacheKey(item));
  if (cached) return cached.map((t) => ({ ...t }));

  const tokens = splitArtistString(display);
  const people = tokens.filter((t) => t.type === 'artist');
  if (people.length <= 1) {
    if (people[0]) people[0].id = item.artistId || null;
    return tokens;
  }
  // Несколько имён: id из объекта не раздаём — он может указывать на любого из них
  // (Navidrome, например, кладёт туда исполнителя альбома). Разрешим по именам.
  return tokens;
}

function joinTokens(list) {
  const tokens = [];
  list.forEach((a, i) => {
    if (i) tokens.push({ type: 'sep', text: ', ' });
    tokens.push({ type: 'artist', id: a.id, name: a.name });
  });
  return tokens;
}

/** Плоский список исполнителей без разделителей. */
export function artistList(item) {
  return artistTokens(item).filter((t) => t.type === 'artist').map((t) => ({ id: t.id || null, name: t.name }));
}

/** У трека реально несколько исполнителей? */
export function hasManyArtists(item) {
  return artistList(item).length > 1;
}

/* ---------- разрешение имён в id ---------- */

const idCache = new Map();      // имя (lowercase) → id | null
const idInflight = new Map();
const nameCache = new Map();    // id → имя исполнителя
const tokenCache = new Map();   // ключ трека → готовые токены
const tokenInflight = new Map();

const cacheKey = (item) => `${item?.artistId || ''}|${key(displayOf(item))}`;

/** Точное совпадение имени: используется для проверки «а это не один коллектив?». */
async function searchArtist(name, strict) {
  const k = key(name);
  if (!k) return null;
  try {
    const r = await api.search(name, { songCount: 0, albumCount: 0, artistCount: 12 });
    const list = r.artists || [];
    const exact = list.find((a) => key(a.name) === k);
    if (exact) return exact.id;
    if (strict) return null;
    const loose = list.find((a) => key(a.name).startsWith(k)) || list.find((a) => key(a.name).includes(k));
    return loose?.id || null;
  } catch {
    return null;
  }
}

export async function resolveArtistId(name, strict = false) {
  const k = key(name);
  if (!k) return null;
  if (!strict && idCache.has(k)) return idCache.get(k);
  if (!strict && idInflight.has(k)) return idInflight.get(k);

  const p = (async () => {
    const id = await searchArtist(name, strict);
    if (!strict) { idCache.set(k, id); idInflight.delete(k); }
    return id;
  })();

  if (!strict) idInflight.set(k, p);
  return p;
}

/** Имя исполнителя по его id (нужно, чтобы понять, кому принадлежит artistId). */
async function artistNameOf(id) {
  if (!id) return null;
  if (nameCache.has(id)) return nameCache.get(id);
  let name = null;
  try {
    const a = await api.getArtist(id);
    name = clean(a?.artist?.name) || null;
  } catch { /* нет такого артиста */ }
  nameCache.set(id, name);
  if (name) idCache.set(key(name), id);
  return name;
}

/** Заранее подсказать id (например, со страницы артиста). */
export function rememberArtist(name, id) {
  const k = key(name);
  if (k && id) idCache.set(k, id);
}

/** Разложить один кусок подписи: сначала по «feat./with/vs», затем — по спорным
 *  разделителям, но только если такого исполнителя целиком нет в библиотеке. */
async function expandPart(part, item) {
  const out = [];
  for (const t of splitArtistString(part.name, STRONG_RE)) {
    if (t.type === 'sep' || !HAS_WEAK.test(t.name)) { out.push(t); continue; }

    // «Sable & Sons» — это один коллектив?
    const own = await artistNameOf(item.artistId);
    if (own && key(own) === key(t.name)) { out.push({ ...t, id: item.artistId }); continue; }
    const wholeId = await resolveArtistId(t.name, true);
    if (wholeId) { out.push({ ...t, id: wholeId }); continue; }

    // нет такого — значит «Yeat & Summrs», режем
    const sub = splitArtistString(t.name, WEAK_RE);
    if (sub.filter((x) => x.type === 'artist').length > 1) out.push(...sub);
    else out.push(t);
  }
  return out.length ? out : [part];
}

/**
 * Полное разрешение: раздаёт id каждому исполнителю и, если строку разрезал
 * «опасный» разделитель, проверяет на сервере, не является ли она именем
 * одного-единственного коллектива.
 */
export async function resolveArtistTokens(item) {
  if (!item) return [];
  const server = fromServer(item);
  const display = displayOf(item);
  if (server) return tokensFromDisplay(display, server) || joinTokens(server);
  if (!display) return [];

  const ck = cacheKey(item);
  if (tokenCache.has(ck)) return tokenCache.get(ck).map((t) => ({ ...t }));
  if (tokenInflight.has(ck)) return (await tokenInflight.get(ck)).map((t) => ({ ...t }));

  const job = (async () => {
    const out = [];
    // 1) знаки препинания → 2) «feat./with/vs» → 3) спорные «&», «x», «и» с проверкой
    for (const part of splitArtistString(display, SAFE_RE)) {
      if (part.type === 'sep') { out.push(part); continue; }
      out.push(...await expandPart(part, item));
    }

    const people = out.filter((t) => t.type === 'artist');

    if (people.length === 1) {
      const only = people[0];
      only.id = item.artistId || only.id || await resolveArtistId(only.name);
      return out;
    }

    // несколько исполнителей: artistId может указывать на любого из них
    // (Navidrome кладёт туда исполнителя альбома), поэтому ищем каждого по имени
    await Promise.all(people.map(async (t) => {
      if (!t.id) t.id = await resolveArtistId(t.name);
    }));

    // никого не нашли, но id у трека есть — надёжнее оставить одной ссылкой
    if (people.every((t) => !t.id) && item.artistId) return single(display, item.artistId);
    return out;
  })();

  tokenInflight.set(ck, job);
  const result = await job;
  tokenCache.set(ck, result);
  tokenInflight.delete(ck);
  return result.map((t) => ({ ...t }));
}

/** Список исполнителей с гарантированными id (для контекстного меню). */
export async function resolveArtistList(item) {
  return (await resolveArtistTokens(item)).filter((t) => t.type === 'artist')
    .map((t) => ({ id: t.id || null, name: t.name }));
}
