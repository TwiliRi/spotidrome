/**
 * Кэш обложек.
 *
 * Зачем: Subsonic отдаёт картинки по авторизованному URL, у которого раньше
 * менялась соль на каждый рендер — браузер не мог закэшировать ничего.
 * Теперь URL стабильный (api.coverUrl → authParams(stable)), а поверх него:
 *
 *   • память  — LRU из уже полученных src, чтобы скролл был мгновенным;
 *   • диск    — в Electron картинки складываются в userData/covers и отдаются
 *               по схеме cover:// (переживают перезапуск и работают офлайн);
 *   • браузер — Cache Storage (spotidrome-covers-v1) + blob-URL.
 */
import { useEffect, useState } from 'react';
import api from './api.js';

const CACHE_NAME = 'spotidrome-covers-v1';
const MEM_MAX = 500;

const desktop = typeof window !== 'undefined' ? window.desktop : null;
const mem = new Map();          // key -> src
const inflight = new Map();     // key -> Promise<src>

function memGet(key) {
  if (!mem.has(key)) return null;
  const v = mem.get(key);
  mem.delete(key); mem.set(key, v);   // LRU-подъём
  return v;
}

function memSet(key, src) {
  mem.set(key, src);
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    const val = mem.get(oldest);
    mem.delete(oldest);
    if (typeof val === 'string' && val.startsWith('blob:')) URL.revokeObjectURL(val);
  }
}

/**
 * Работает ли дисковый кэш десктопа. Проверяем один раз за сессию:
 * если схема cover:// вдруг не отдаёт файл, молча уходим на прямые URL,
 * чтобы обложки никогда не пропадали целиком.
 */
let desktopCacheOk = null;
async function verifyLocal(url) {
  try { const r = await fetch(url); return r.ok; } catch { return false; }
}

let cachePromise;
function openCache() {
  if (typeof caches === 'undefined') return Promise.resolve(null);
  if (!cachePromise) cachePromise = caches.open(CACHE_NAME).catch(() => null);
  return cachePromise;
}

const cacheRequest = (key) => `${location.origin}/__cover/${key}`;

/** Прямой (некэшированный) адрес обложки — запасной вариант, если кэш подвёл */
export function remoteCover(id, size = 300) {
  return id ? api.coverUrl(id, size) : null;
}

/** Забыть запись: вызывается, когда <img> не смог отрисовать кэшированный src */
export function invalidateCover(id, size = 300) {
  if (!id) return;
  const key = api.coverKey(id, size);
  const val = mem.get(key);
  if (typeof val === 'string' && val.startsWith('blob:')) URL.revokeObjectURL(val);
  mem.delete(key);
  inflight.delete(key);
  openCache().then((c) => c && c.delete(cacheRequest(key)).catch(() => {})).catch(() => {});
}

/** Уже готовый src без похода в кэш (для первого рендера без мигания) */
export function peekCover(id, size = 300) {
  if (!id) return null;
  if (api.demo) return api.coverUrl(id, size);
  return memGet(api.coverKey(id, size));
}

/** Достаёт обложку из кэша, при промахе — качает и кладёт в кэш */
export async function resolveCover(id, size = 300) {
  if (!id) return null;
  const remote = api.coverUrl(id, size);
  if (api.demo || !remote || remote.startsWith('data:')) return remote;

  const key = api.coverKey(id, size);
  const hit = memGet(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      if (desktop?.coverGet && desktopCacheOk !== false) {
        const r = await desktop.coverGet({ key, url: remote });
        if (r?.url) {
          if (desktopCacheOk === null) desktopCacheOk = await verifyLocal(r.url);
          if (desktopCacheOk) return r.url;
        }
      } else if (!desktop) {
        const cache = await openCache();
        if (cache) {
          const req = cacheRequest(key);
          let res = await cache.match(req);
          if (!res) {
            const net = await fetch(remote, { mode: 'cors', credentials: 'omit' });
            if (net.ok) { await cache.put(req, net.clone()).catch(() => {}); res = net; }
          }
          if (res) return URL.createObjectURL(await res.blob());
        }
      }
    } catch { /* сеть/квота — просто отдадим прямой URL */ }
    return remote;
  })();

  inflight.set(key, task);
  try {
    const src = await task;
    memSet(key, src);
    return src;
  } finally {
    inflight.delete(key);
  }
}

/** Подгружает обложки заранее (например, для следующих треков очереди) */
export function prefetchCovers(items, size = 300) {
  (items || []).slice(0, 30).forEach((it) => {
    const id = typeof it === 'string' ? it : (it?.coverArt || it?.albumId || it?.id);
    if (id) resolveCover(id, size).catch(() => {});
  });
}

export async function coverCacheStats() {
  if (desktop?.coverStats) return desktop.coverStats();
  try {
    const cache = await openCache();
    if (!cache) return { count: 0, bytes: 0, memory: mem.size };
    const keys = await cache.keys();
    let bytes = 0;
    for (const k of keys.slice(0, 400)) {
      const r = await cache.match(k);
      if (!r) continue;                                  // запись испарилась — считаем дальше
      const len = Number(r.headers.get('content-length') || 0);
      if (len) bytes += len;
      else bytes += (await r.clone().blob()).size;
    }
    return { count: keys.length, bytes, memory: mem.size };
  } catch { return { count: 0, bytes: 0, memory: mem.size }; }
}

export async function clearCoverCache() {
  mem.forEach((v) => { if (typeof v === 'string' && v.startsWith('blob:')) URL.revokeObjectURL(v); });
  mem.clear();
  inflight.clear();
  if (desktop?.coverClear) return desktop.coverClear();
  try { await caches.delete(CACHE_NAME); cachePromise = null; return true; } catch { return false; }
}

/** Хук: отдаёт src обложки, при промахе кэша — после загрузки */
export function useCoverSrc(id, size = 300) {
  const [src, setSrc] = useState(() => peekCover(id, size));

  useEffect(() => {
    if (!id) { setSrc(null); return undefined; }
    const ready = peekCover(id, size);
    if (ready) { setSrc(ready); return undefined; }
    let alive = true;
    setSrc(null);
    resolveCover(id, size).then((u) => { if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
  }, [id, size]);

  return src;
}

export default {
  resolveCover, useCoverSrc, prefetchCovers, coverCacheStats,
  clearCoverCache, peekCover, remoteCover, invalidateCover,
};
