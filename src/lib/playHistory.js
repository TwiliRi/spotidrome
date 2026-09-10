/* История прослушиваний.

   Subsonic API не отдаёт «что я слушал» (scrobble — только запись), поэтому
   история живёт локально в клиенте: треки пишутся, когда их реально слушали,
   и переживают перезапуск. Заодно это работает офлайн и без сервера.

   Здесь только чистые функции — без React и без стора, чтобы логику можно было
   проверить офлайн (tools/test-play-history.mjs). */

export const PLAY_MAX = 800;            // сколько записей хранить
export const MIN_LISTEN_SEC = 20;       // столько слушали — считается прослушиванием

/** Нормализуем трек к компактному виду: в конфиг не должно уехать лишнего. */
export function toPlayEntry(track, { at = Date.now(), context = null } = {}) {
  return {
    id: String(track.id),
    title: track.title || '',
    artist: track.artist || '',
    album: track.album || '',
    albumId: track.albumId || null,
    artistId: track.artistId || null,
    coverArt: track.coverArt || track.albumId || null,
    duration: Number(track.duration) || 0,
    at: Number(at) || Date.now(),
    context: context ? String(context) : null,   // откуда запустили: «Альбом · …»
  };
}

/**
 * Добавить прослушивание. Тот же трек не дублируется: история «недавнее», а не
 * журнал, поэтому свежая запись поднимается наверх, а прежняя убирается
 * (перетустил ползунок, повтор трека, промотка вперёд-назад).
 */
export function pushPlay(list, track, opts = {}) {
  if (!track?.id) return list || [];
  const entry = toPlayEntry(track, opts);
  const prev = (list || []).filter((x) => x && x.id !== entry.id);
  return [entry, ...prev].slice(0, PLAY_MAX);
}

/** Убрать запись (крестик в списке). */
export function dropPlay(list, at) {
  const prev = list || [];
  const next = prev.filter((x) => x.at !== at);
  return next.length === prev.length ? prev : next;
}

export function clearPlays() { return []; }

/** То, что пришло с диска, могло быть испорчено или записано другой версией. */
export function sanitizePlays(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of list) {
    if (!it || !it.id || !Number.isFinite(Number(it.at)) || Number(it.at) <= 0) continue;
    out.push({
      id: String(it.id),
      title: String(it.title || ''),
      artist: String(it.artist || ''),
      album: String(it.album || ''),
      albumId: it.albumId != null ? String(it.albumId) : null,
      artistId: it.artistId != null ? String(it.artistId) : null,
      coverArt: it.coverArt != null ? String(it.coverArt) : (it.albumId != null ? String(it.albumId) : null),
      duration: Number(it.duration) || 0,
      at: Number(it.at),
      context: it.context ? String(it.context) : null,
    });
    if (out.length >= PLAY_MAX) break;
  }
  return out.sort((a, b) => b.at - a.at);
}

/* ---------------- дни и диапазоны ---------------- */

export const DAY_MS = 86400000;

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** lokal'ный ключ дня «ГГГГ-ММ-ДД» */
export function dayKey(at) {
  const d = new Date(at);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** «Сегодня» / «Вчера» / «12 мая» / «12 мая 2023» */
export function dayLabel(at, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  const d = new Date(at);
  const md = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${md} ${d.getFullYear()}`;
}

/** Оставить только последние N дней (null — всё). */
export function withinDays(list, days, now = Date.now()) {
  const arr = list || [];
  if (!days) return arr;
  const from = startOfDay(now) - (days - 1) * DAY_MS;
  return arr.filter((x) => x.at >= from);
}

/**
 * Плоские строки для списка: заголовок дня + треки этого дня.
 * Один плоский массив нужен, чтобы список можно было виртуализировать;
 * в заголовок кладём и сам список дня — по нему играет «весь день».
 */
export function buildDayRows(list, { days = null, now = Date.now() } = {}) {
  const items = withinDays(list, days, now);
  const rows = [];
  let cur = null;
  for (const item of items) {
    const key = dayKey(item.at);
    if (!cur || cur.key !== key) {
      cur = { kind: 'day', key, label: dayLabel(item.at, now), count: 0, duration: 0, items: [] };
      rows.push(cur);
    }
    cur.count += 1;
    cur.duration += item.duration || 0;
    cur.items.push(item);
    rows.push({ kind: 'track', item, day: key });
  }
  return rows;
}

/** Только треки строк (без заголовков дней) — по ним играем и перемешиваем. */
export function tracksOf(rows) {
  return (rows || []).filter((r) => r.kind === 'track').map((r) => r.item);
}

export function statsFor(list) {
  const arr = list || [];
  const unique = new Set(arr.map((x) => x.id));
  return {
    count: arr.length,
    unique: unique.size,
    duration: arr.reduce((s, x) => s + (x.duration || 0), 0),
    artists: new Set(arr.map((x) => (x.artist || '').toLowerCase()).filter(Boolean)).size,
  };
}

/** «сколько назад» — короткая подпись у строки истории */
export function playedAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'только что';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24 && startOfDay(at) === startOfDay(now)) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  if (d < 30) return `${d} дн. назад`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(at));
}

/** Часы/минуты прослушанного — для шапки экрана. */
export function listenTime(sec) {
  const min = Math.round((sec || 0) / 60);
  if (!min) return 'меньше минуты';
  const h = Math.floor(min / 60);
  return h ? `${h} ч ${min % 60} мин` : `${min} мин`;
}

export default { pushPlay, dropPlay, clearPlays, sanitizePlays, buildDayRows, tracksOf, withinDays, statsFor, playedAgo, listenTime, dayLabel, dayKey };
