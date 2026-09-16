/*
 * Демо-история прослушиваний.
 *
 * Subsonic-сервер «что я слушал» не отдаёт, а на чистом демо страница
 * статистики была бы пустой. Поэтому в демо-режиме история один раз
 * засеивается правдоподобной выборкой: любимые исполнители, вечерний пик,
 * выходные плотнее, изредка — тихие дни.
 *
 * Всё детерминировано (зерно фиксировано): перезапуск не меняет цифры.
 * Реальная история пользователя этим не трогается: засев срабатывает только
 * когда история пуста (см. store.seedDemoPlays).
 */
import { toPlayEntry, PLAY_MAX } from './playHistory.js';

const DAY_MS = 86400000;
const KEY = 'spotidrome.demoPlaySeed';

/** Детерминированный псевдослучайный генератор (xorshift32). */
export function makeRnd(seed = 1) {
  let s = Math.abs(Math.trunc(seed)) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* Вес часа суток: ночью почти не слушаем, пик — вечер. Индекс = час. */
const HOUR_WEIGHTS = [
  2, 1, 1, 1, 1, 2, 4, 6, 7, 7, 8, 9,
  10, 10, 9, 9, 10, 12, 14, 15, 15, 13, 9, 5,
];

const pickWeighted = (items, weights, r) => {
  const total = items.reduce((acc, it, i) => acc + (weights[i] || 0), 0);
  if (total <= 0) return items[Math.floor(r() * items.length)];
  let x = r() * total;
  for (let i = 0; i < items.length; i++) {
    x -= (weights[i] || 0);
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
};

/**
 * Правдоподобная история по демо-библиотеке.
 * @param {Array} songs  треки (window.__api.mock.songs)
 * @returns {Array}      записи в формате playHistory
 */
export function buildDemoPlays(songs, { days = 78, now = Date.now(), seed = 20260916, perDay = 5 } = {}) {
  const pool = (songs || []).filter((s) => s && s.id && Number(s.duration) > 0);
  if (!pool.length) return [];

  const r = makeRnd(seed);

  /* у каждого исполнителя свой вес: двое-трое «любимых» забирают заметную долю */
  const artistKeys = [...new Set(pool.map((s) => s.artistId || (s.artist || '').toLowerCase()))];
  const artistWeight = new Map();
  artistKeys.forEach((k) => artistWeight.set(k, 0.35 + Math.pow(r(), 2.2) * 4.5));
  const favourites = [...artistWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  favourites.forEach(([k], i) => artistWeight.set(k, 6 - i * 1.6));      // 6 / 4.4 / 2.8
  const weights = pool.map((s) => artistWeight.get(s.artistId || (s.artist || '').toLowerCase()) || 1);

  /* сколько крутили каждый альбом — чтобы «топ альбомов» тоже был осмысленным */
  const albumBoost = new Map();
  [...new Set(pool.map((s) => s.albumId || s.album))].forEach((a) => albumBoost.set(a, 0.7 + Math.pow(r(), 3) * 3.5));
  pool.forEach((s, i) => { weights[i] *= albumBoost.get(s.albumId || s.album) || 1; });

  const used = new Set();
  const entries = [];

  for (let back = days - 1; back >= 0; back--) {
    const date = new Date(now - back * DAY_MS);
    const dow = (date.getDay() + 6) % 7;                       // 0 — понедельник
    const recency = 1 - back / days;
    const trend = 0.4 + 0.6 * Math.pow(recency, 1.15);         // к сегодняшнему дню слушаем больше
    const weekend = dow >= 5 ? 1.4 : dow === 0 ? 1.05 : 1;
    let n = Math.round(perDay * trend * weekend * (0.4 + r() * 1.3));
    if (r() < 0.1) n = 0;                                     // иногда день без музыки
    n = Math.max(0, Math.min(n, 14));

    for (let i = 0; i < n; i++) {
      let song = null;
      for (let attempt = 0; attempt < 8 && !song; attempt++) {
        const cand = pickWeighted(pool, weights, r);
        if (cand && !used.has(String(cand.id))) song = cand;
      }
      if (!song) {                                             // перебор по остаткам
        song = pool.find((s) => !used.has(String(s.id)));
        if (!song) break;
      }
      used.add(String(song.id));

      const hour = pickWeighted(HOUR_WEIGHTS.map((_, h) => h), HOUR_WEIGHTS, r);
      const when = new Date(date);
      when.setHours(hour, Math.floor(r() * 60), Math.floor(r() * 60), 0);
      const at = Math.min(when.getTime(), now - 60_000);
      entries.push(toPlayEntry(song, {
        at,
        context: r() < 0.35 ? { type: 'album', id: song.albumId, name: song.album } : null,
      }));
    }
  }

  return entries.sort((a, b) => a.at - b.at).slice(-PLAY_MAX);
}

/** Зерно: одно на установку, чтобы демо-история не пересобиралась при каждом запуске. */
export function demoPlaySeed() {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (Number.isFinite(saved) && saved > 0) return saved;
    const seed = 1 + Math.floor(Math.random() * 1e6);
    localStorage.setItem(KEY, String(seed));
    return seed;
  } catch {
    return 20260916;
  }
}

export default buildDemoPlays;
