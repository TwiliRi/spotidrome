/**
 * AutoDJ — бесконечная очередь.
 *
 * Navidrome (как и любой Subsonic-сервер) не умеет «радио» на стороне сервера,
 * поэтому логика живёт в клиенте: берём затравку (текущий трек), просим у сервера
 * похожие/жанровые/случайные треки и дописываем их в хвост очереди, пока впереди
 * не наберётся buffer штук.
 */

import { artistList } from './artists.js';

export const AUTODJ_MODES = [
  { id: 'mix', name: 'Микс', hint: 'Похожие + жанр + случайные — как «Радио» в Spotify' },
  { id: 'similar', name: 'Похожие', hint: 'getSimilarSongs2 по текущему треку' },
  { id: 'artist', name: 'Исполнитель', hint: 'Хиты текущего артиста и близких к нему' },
  { id: 'genre', name: 'Жанр', hint: 'Треки того же жанра' },
  { id: 'starred', name: 'Любимое', hint: 'Случайное из отмеченных сердечком' },
  { id: 'random', name: 'Случайно', hint: 'Полностью случайно из библиотеки' },
];

export const modeName = (id) => AUTODJ_MODES.find((m) => m.id === id)?.name || 'Микс';

const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
};

const safe = async (p, fallback = []) => { try { return (await p) || fallback; } catch { return fallback; } };

/* ---------------- источники кандидатов ---------------- */

async function fromSimilar(api, seed, want) {
  if (!seed) return [];
  let list = await safe(api.getSimilarSongs(seed.id, Math.max(30, want * 6)));
  if (list.length < want && seed.artistId) {
    // fallback: похожие исполнители из getArtistInfo2 → их топ-треки
    const info = await safe(api.getArtistInfo(seed.artistId), {});
    const similar = Array.isArray(info.similarArtist) ? info.similarArtist
      : info.similarArtist ? [info.similarArtist] : [];
    for (const a of shuffle(similar).slice(0, 4)) {
      list = list.concat(await safe(api.getTopSongs(a.name, 10)));
      if (list.length >= want * 4) break;
    }
  }
  return list;
}

async function fromArtist(api, seed, want) {
  if (!seed?.artist) return [];
  const top = await safe(api.getTopSongs(artistList(seed)[0]?.name || seed.artist, Math.max(20, want * 4)));
  if (top.length >= want) return top;
  return top.concat(await fromSimilar(api, seed, want));
}

async function fromGenre(api, seed, want) {
  if (!seed?.genre) return [];
  return shuffle(await safe(api.getSongsByGenre(seed.genre, Math.max(60, want * 10))));
}

async function fromStarred(api, _seed, want) {
  const st = await safe(api.getStarred(), { songs: [] });
  return shuffle(st.songs || []).slice(0, Math.max(want * 4, 20));
}

async function fromRandom(api, _seed, want) {
  return safe(api.getRandomSongs(Math.max(30, want * 6)));
}

const SOURCES = { similar: fromSimilar, artist: fromArtist, genre: fromGenre, starred: fromStarred, random: fromRandom };

/* ---------------- отбор ---------------- */

/**
 * @param {object}   o
 * @param {object}   o.api      клиент Subsonic
 * @param {string}   o.mode     один из AUTODJ_MODES
 * @param {object?}  o.seed     текущий трек (затравка)
 * @param {number}   o.need     сколько треков нужно
 * @param {Set}      o.exclude  id, которые брать нельзя (очередь + недавние)
 * @returns {Promise<Array>} треки
 */
export async function pickAutoDj({ api, mode = 'mix', seed = null, need = 5, exclude = new Set() }) {
  const want = Math.max(1, need);
  let pool = [];

  if (mode === 'mix') {
    const [sim, gen, rnd] = await Promise.all([
      fromSimilar(api, seed, want),
      fromGenre(api, seed, want),
      fromRandom(api, seed, Math.ceil(want / 2)),
    ]);
    // 50% похожих, 30% по жанру, 20% случайных — «знакомое + открытия»
    pool = [
      ...shuffle(sim).slice(0, want * 3),
      ...shuffle(gen).slice(0, Math.ceil(want * 1.5)),
      ...shuffle(rnd).slice(0, Math.ceil(want)),
    ];
  } else {
    pool = await (SOURCES[mode] || fromRandom)(api, seed, want);
  }

  // без затравки любой «зависимый от трека» режим вырождается в случайный
  if (!pool.length && mode !== 'random') pool = await fromRandom(api, seed, want);

  const seen = new Set();
  const out = [];
  const artistCount = new Map();
  const seedArtist = (seed?.artist || '').toLowerCase();
  const limitPerArtist = mode === 'artist' ? want : Math.max(2, Math.ceil(want / 2));

  for (const t of shuffle(pool)) {
    if (!t?.id || seen.has(t.id) || exclude.has(t.id)) continue;
    const a = (t.artist || '').toLowerCase();
    const used = artistCount.get(a) || 0;
    // не залипаем на одном исполнителе (кроме режима «Исполнитель»)
    if (used >= limitPerArtist) continue;
    if (mode === 'mix' && a && a === seedArtist && used >= 1) continue;
    seen.add(t.id);
    artistCount.set(a, used + 1);
    out.push(t);
    if (out.length >= want) break;
  }

  // если фильтры оказались слишком строгими — добираем чем есть
  if (out.length < want) {
    for (const t of pool) {
      if (out.length >= want) break;
      if (!t?.id || seen.has(t.id) || exclude.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export default pickAutoDj;
