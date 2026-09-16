/*
 * Статистика прослушиваний.
 *
 * Считаем по локальной истории (src/lib/playHistory.js): Subsonic-сервер
 * «что я слушал» не отдаёт, а история у нас всё равно полнее — она пишется
 * и офлайн, и в демо-режиме.
 *
 * Здесь только чистые функции: без React и без стора, чтобы цифры можно было
 * проверить без браузера (tools/test-stats.mjs).
 */
import { dayKey } from './playHistory.js';

export const DAY_MS = 86400000;
export const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const RANGES = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: null, label: 'Всё время' },
];

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Номер дня недели: 0 — понедельник (в JS воскресенье = 0). */
export const weekdayIndex = (t) => (new Date(t).getDay() + 6) % 7;

const lower = (s) => String(s || '').trim().toLowerCase();

/* «A feat. B», «A, B», «A & B» — составная подпись. Для имени исполнителя
   предпочитаем вариант с наименьшим числом разделителей: «Sable & Sons»
   лучше, чем «Sable & Sons feat. Yeat». */
const STRONG_SEP = /\s(?:feat\.?|ft\.?|vs\.?|with)\s/i;      // «A feat. B» — явный гость
const WEAK_SEP = /\s(?:&|x)\s|(?:,\s*\S)/i;                   // «A & B», «A, B» — соавторство
const compoundScore = (name) => (STRONG_SEP.test(name) ? 2 : 0) + (WEAK_SEP.test(name) ? 1 : 0);

/** Ключ исполнителя: id важнее подписи, иначе «A feat. B» считался бы отдельным. */
export const artistGroupKey = (it) => {
  const id = it?.artistId ? String(it.artistId) : '';
  return id ? `id:${id}` : `n:${lower(it?.artist)}`;
};

/**
 * @param {Array}  list  записи истории ([{ id, title, artist, album, duration, at, … }])
 * @param {object} o
 * @param {number|null} o.days  сколько последних дней считать (null — всё)
 * @param {number} o.now        «сегодня» (нужно для тестов)
 */
export function buildStats(list, { days = 30, now = Date.now() } = {}) {
  const all = (list || []).filter((x) => x && Number.isFinite(Number(x.at)));
  const from = days ? startOfDay(now) - (days - 1) * DAY_MS : null;
  const items = from == null ? all : all.filter((x) => x.at >= from);

  const artists = new Map();
  const albums = new Map();
  const byDay = new Map();
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const hourTotal = new Array(24).fill(0);

  let duration = 0;
  let night = 0;
  let morning = 0;
  let day_ = 0;
  let evening = 0;

  /* пустые дни диапазона нужны, чтобы график не «схлопывался» к ненулевым */
  if (days) {
    for (let i = 0; i < days; i++) {
      const at = startOfDay(now) - (days - 1 - i) * DAY_MS;
      byDay.set(dayKey(at), { key: dayKey(at), at, count: 0, duration: 0 });
    }
  }

  for (const it of items) {
    const dur = Number(it.duration) || 0;
    duration += dur;

    const h = new Date(it.at).getHours();
    grid[weekdayIndex(it.at)][h] += 1;
    hourTotal[h] += 1;
    if (h >= 23 || h < 5) night += 1;
    else if (h < 12) morning += 1;
    else if (h < 18) day_ += 1;
    else evening += 1;

    const k = dayKey(it.at);
    const day = byDay.get(k) || { key: k, at: startOfDay(it.at), count: 0, duration: 0 };
    day.count += 1;
    day.duration += dur;
    byDay.set(k, day);

    const aName = String(it.artist || '').trim() || 'Неизвестный исполнитель';
    const aKey = artistGroupKey(it);
    const a = artists.get(aKey) || {
      key: aKey, name: aName, artistId: it.artistId || null,
      coverArt: it.coverArt || it.albumId || null, count: 0, duration: 0,
    };
    if (compoundScore(aName) < compoundScore(a.name)) a.name = aName;
    a.count += 1;
    a.duration += dur;
    if (!a.artistId && it.artistId) a.artistId = it.artistId;
    artists.set(aKey, a);

    const alName = String(it.album || '').trim() || 'Без альбома';
    const alKey = `${lower(alName)}||${it.albumId || ''}`;
    const al = albums.get(alKey) || {
      key: alKey, name: alName, albumId: it.albumId || null, artist: aName,
      coverArt: it.coverArt || it.albumId || null, count: 0, duration: 0,
    };
    al.count += 1;
    al.duration += dur;
    albums.set(alKey, al);
  }

  const byDur = (a, b) => (b.duration - a.duration) || (b.count - a.count) || a.name.localeCompare(b.name);
  const dayList = [...byDay.values()].sort((a, b) => a.at - b.at);

  const topArtists = [...artists.values()].sort(byDur).slice(0, 8)
    .map((a) => ({ ...a, share: duration ? a.duration / duration : 0 }));
  const topAlbums = [...albums.values()].sort(byDur).slice(0, 8)
    .map((a) => ({ ...a, share: duration ? a.duration / duration : 0 }));

  /* самые свежие — тем и интереснее «что играло последним» */
  const recent = [...items].sort((a, b) => b.at - a.at).slice(0, 10);

  const best = dayList.reduce((acc, d) => ((d.count > (acc?.count || 0)) ? d : acc), null);
  let peakHour = 0;
  for (let h = 1; h < 24; h++) if (hourTotal[h] > hourTotal[peakHour]) peakHour = h;

  /* серия дней подряд с прослушиваниями, считая от сегодня или от вчера */
  const active = new Set(items.map((x) => dayKey(x.at)));
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const at = startOfDay(now) - i * DAY_MS;
    if (active.has(dayKey(at))) streak += 1;
    else if (i > 0) break;                       // сегодня может быть ещё пусто
    else if (active.size === 0) break;
  }

  const activeDays = dayList.filter((d) => d.count > 0).length;
  const longest = items.reduce((acc, x) => ((Number(x.duration) || 0) > (Number(acc?.duration) || 0) ? x : acc), null);

  return {
    days,
    from,
    now,
    items,                              // записи диапазона (те же ссылки, что и в истории)
    total: {
      count: items.length,
      duration,
      artists: artists.size,
      albums: albums.size,
      days: activeDays,
    },
    daysList: dayList,
    byHour: grid,
    hourTotal,
    topArtists,
    topAlbums,
    recent,
    best: best && best.count ? best : null,
    peakHour: items.length ? peakHour : null,
    partsOfDay: { night, morning, day: day_, evening },
    nightShare: items.length ? night / items.length : 0,
    avg: items.length ? duration / items.length : 0,
    perDay: activeDays ? duration / activeDays : 0,
    streak,
    longest,
    firstAt: items.length ? Math.min(...items.map((x) => x.at)) : null,
    lastAt: items.length ? Math.max(...items.map((x) => x.at)) : null,
    maxDay: dayList.reduce((m, d) => Math.max(m, d.duration), 0),
    maxHour: hourTotal.reduce((m, v) => Math.max(m, v), 0),
  };
}

/** Часы и минуты: «12 ч 40 мин». */
export function hoursAndMinutes(sec) {
  const min = Math.round((Number(sec) || 0) / 60);
  const h = Math.floor(min / 60);
  if (!h) return { h: 0, m: min, text: `${min} мин` };
  return { h, m: min % 60, text: `${h} ч ${min % 60} мин` };
}

/** «13 сентября» / «13 сентября 2024» — для подписей под графиком. */
export function shortDate(at, now = Date.now()) {
  const d = new Date(at);
  const md = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d);
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${md} ${d.getFullYear()}`;
}

/** Подпись часа: «в 21:00», «ночью», «утром»… */
export function partOfDayName(hour) {
  if (hour == null) return '—';
  if (hour >= 23 || hour < 5) return 'ночью';
  if (hour < 12) return 'утром';
  if (hour < 18) return 'днём';
  return 'вечером';
}

export default buildStats;
