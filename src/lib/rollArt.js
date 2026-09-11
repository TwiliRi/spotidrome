/**
 * Реальные обложки для 3D-сцены броска.
 *
 * Раньше в туннеле и вокруг дыры летали абстракции, нарисованные на ходу, —
 * выглядело как заглушка. Теперь сцена получает настоящие обложки фонотеки,
 * причём в первую очередь те, что уже лежат в кэше: они появляются в кадре без
 * единого запроса к серверу.
 *
 * Откуда берём:
 *   1. обложки треков, из которых идёт выбор (их присылает getRandomSongs);
 *   2. если их мало — случайные альбомы библиотеки;
 *   3. если и это не удалось — сцена остаётся на рисованных заготовках.
 *
 * Картинки отдаются по мере готовности: сцена подменяет ими заготовки прямо
 * в полёте, поэтому ждать, пока загрузятся все, не нужно.
 */

import api from './api';
import { peekCover, resolveCover } from './covers';

/** Тот же размер, что в списках, — так мы попадаем в уже заполненный кэш. */
export const ART_SIZE = 300;

function pickId(item) {
  if (!item) return null;
  if (typeof item === 'string') return item;
  return item.coverArt || item.albumId || null;
}

async function candidateIds(pool, limit) {
  const ids = [];
  const seen = new Set();
  for (const item of pool || []) {
    const id = pickId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) return ids;
  }
  try {
    const albums = await api.albumList('random', Math.max(12, limit - ids.length));
    for (const al of albums || []) {
      const id = pickId(al);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= limit) break;
    }
  } catch {
    /* библиотека недоступна — обойдёмся тем, что уже есть в пуле */
  }
  return ids;
}

function decodeImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    // WebGL не примет картинку с чужого домена без CORS — спрашиваем заранее,
    // а если сервер не разрешил, просто пропускаем такую обложку
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Набрать настоящих обложек и отдавать их в сцену по одной.
 * @returns {Promise<number>} сколько обложек удалось загрузить
 */
export async function loadRollArt({ pool = [], limit = 26, onImage, alive = () => true } = {}) {
  const ids = await candidateIds(pool, limit);
  if (!ids.length) return 0;

  /* Сначала уже закэшированные: они есть в памяти или на диске, поэтому
     попадают в сцену мгновенно, пока остальные ещё в пути. */
  const warm = [];
  const cold = [];
  ids.forEach((id) => (peekCover(id, ART_SIZE) ? warm : cold).push(id));
  const queue = [...warm, ...cold];

  let done = 0;
  let cursor = 0;
  const lane = async () => {
    while (cursor < queue.length && alive()) {
      const id = queue[cursor++];
      const src = peekCover(id, ART_SIZE) || await resolveCover(id, ART_SIZE).catch(() => null);
      if (!src || !alive()) continue;
      const img = await decodeImage(src);
      if (!img || !alive()) continue;
      done += 1;
      try { onImage?.(img); } catch { /* сцена уже закрылась — не беда */ }
    }
  };

  // по 5 в полёте: не душим сервер и не держим десятки запросов одновременно
  await Promise.all([lane(), lane(), lane(), lane(), lane()]);
  return done;
}
