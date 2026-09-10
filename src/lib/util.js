import { useEffect, useState } from 'react';

/** Длительность трека: «3:07», а для длинных записей — «1:15:04». */
export const fmt = (sec) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (!h) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
};

/** Длительность словами: «1 ч 5 мин». Округляем минуты так, чтобы не было «60 мин». */
export const fmtLong = (sec) => {
  if (!sec || !isFinite(sec) || sec < 0) return '';
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
};

export const plural = (n, one, few, many) => {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
};

export const songsWord = (n) => plural(n, 'трек', 'трека', 'треков');
export const albumsWord = (n) => plural(n, 'альбом', 'альбома', 'альбомов');

export const bytes = (b) => {
  const n = Number(b);
  if (!isFinite(n) || n <= 0) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];
  const i = Math.max(0, Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

/* доминантный цвет обложки считаем один раз на изображение: иначе каждая
   страница с той же обложкой заново декодирует картинку и гоняет canvas */
const colorCache = new Map();          // src → цвет (или NO_COLOR, если цвета нет)
const NO_COLOR = Symbol('no-color');

export function useDominantColor(src, fallback = '#2f2f2f') {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    let alive = true;
    if (!src) { setColor(fallback); return; }
    const cached = colorCache.get(src);
    if (cached !== undefined) {
      setColor(cached === NO_COLOR ? fallback : cached);
      return () => { alive = false; };
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const size = 24;
        c.width = size; c.height = size;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const d = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const rr = d[i], gg = d[i + 1], bb = d[i + 2];
          const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
          const lum = (max + min) / 2;
          if (lum < 18 || lum > 245) continue;
          const weight = 1 + (max - min) / 255;
          r += rr * weight; g += gg * weight; b += bb * weight; n += weight;
        }
        if (!n) { colorCache.set(src, NO_COLOR); if (alive) setColor(fallback); return; }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        // приглушаем и затемняем, как в Spotify
        const mix = (v) => Math.round(v * 0.62 + 18);
        const hex = `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
        colorCache.set(src, hex);
        if (alive) setColor(hex);
      } catch {
        colorCache.set(src, NO_COLOR);            // canvas не дал пиксели (CORS) — не повторяем
        if (alive) setColor(fallback);
      }
    };
    img.onerror = () => { colorCache.set(src, NO_COLOR); if (alive) setColor(fallback); };
    img.src = src;
    return () => { alive = false; };
  }, [src, fallback]);
  return color;
}

/** Индекс элемента по id. Строки таблицы могут быть отфильтрованы (исключённые
 *  треки), поэтому позиция строки ≠ порядку в плейлисте на сервере. */
export function indexById(list, item) {
  if (!Array.isArray(list)) return -1;
  const id = (typeof item === 'string' || typeof item === 'number') ? item : item?.id;
  if (id == null) return -1;
  return list.findIndex((x) => x?.id === id);
}

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
};

/* ---------------- текст с сервера (биографии, аннотации) ----------------
   Navidrome отдаёт описания из Last.fm готовым HTML. Вставлять его через
   dangerouslySetInnerHTML нельзя — внутри может быть что угодно. Превращаем
   в безопасный текст: теги вырезаем, сущности разворачиваем, абзацы бережём. */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®',
  deg: '°', middot: '·', bull: '•', sect: '§', times: '×',
};

/** разворачивает `&amp;`, `&#1040;`, `&#x410;`; остальное оставляет как есть */
export function decodeEntities(s) {
  return String(s || '').replace(/&(#[xX]?[0-9a-fA-F]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,10});/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X'
        ? parseInt(g.slice(2), 16)
        : parseInt(g.slice(1), 10);
      if (!isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED_ENTITIES[g.toLowerCase()] ?? m;
  });
}

/** HTML → плоский текст с переводами строк (для показа в <p>, без innerHTML) */
export function stripHtml(html) {
  const out = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(out)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
