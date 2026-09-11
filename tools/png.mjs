/* Минимальный разбор PNG для автотестов: считаем яркость кадра по областям.
   Нужен, чтобы проверять WebGL-сцены не «на глаз»: чёрный экран, плоский фон
   или пропавшее свечение видно по числам. Только 8 бит на канал, RGB/RGBA. */
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  let pos = 8;                       // пропускаем сигнатуру PNG
  let w = 0, h = 0, color = 6;
  const chunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      color = data[9];               // 2 — RGB, 6 — RGBA
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const out = new Uint8Array(w * h * bpp);
  const stride = w * bpp;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { w, h, bpp, data: out };
}

/** Средняя яркость прямоугольника (0…255). Доли — от размеров кадра. */
export function brightness(img, { x = 0, y = 0, w = 1, h = 1 } = {}) {
  const x0 = Math.max(0, Math.floor(x * img.w));
  const y0 = Math.max(0, Math.floor(y * img.h));
  const x1 = Math.min(img.w, Math.ceil((x + w) * img.w));
  const y1 = Math.min(img.h, Math.ceil((y + h) * img.h));
  let sum = 0;
  let n = 0;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * img.w + px) * img.bpp;
      sum += (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114);
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/** Насколько кадр «живой»: разброс яркости по всему изображению. */
export function contrast(img) {
  let sum = 0;
  let sum2 = 0;
  const n = img.w * img.h;
  for (let i = 0; i < n; i++) {
    const p = i * img.bpp;
    const v = img.data[p] * 0.299 + img.data[p + 1] * 0.587 + img.data[p + 2] * 0.114;
    sum += v; sum2 += v * v;
  }
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), max: 0 };
}
