/*
 * Заблокированные исполнители.
 *
 * Список живёт в настройках (settings.bannedArtists — [{ id, name, at }]),
 * а сопоставление трека со списком — здесь, чтобы не плодить одну и ту же
 * проверку в пяти местах (очередь, AutoDJ, случайный трек, списки, радио).
 *
 * Сравниваем по двум ключам: нормализованное имя и id. Имя в приоритете —
 * у трека из другого альбома-сборника artistId может указывать не на того
 * человека, поэтому id проверяем как дополнение, а не вместо имени.
 */
import { artistList } from './artists.js';

export const artistKey = (name) => String(name || '').trim().toLowerCase();

/** Ключи списка: имена в нижнем регистре + `id:<id>`. */
export function bannedKeys(list) {
  const out = new Set();
  (Array.isArray(list) ? list : []).forEach((a) => {
    if (!a) return;
    if (a.name) out.add(artistKey(a.name));
    if (a.id) out.add(`id:${a.id}`);
  });
  return out;
}

/** Попал ли исполнитель (строка или { id, name }) в список. */
export function isBannedArtist(keys, entry) {
  if (!keys || !keys.size) return false;
  if (typeof entry === 'string') return keys.has(artistKey(entry));
  if (!entry) return false;
  if (entry.id && keys.has(`id:${entry.id}`)) return true;
  return !!entry.name && keys.has(artistKey(entry.name));
}

/**
 * Есть ли у трека заблокированный исполнитель.
 * Смотрим по очереди: artistId трека, всех исполнителей из подписи
 * («A feat. B» — банят любого из двоих) и, наконец, подпись целиком
 * («Simon & Garfunkel» могли забанить как одно имя, а разбор режет его).
 */
export function trackHasBannedArtist(keys, track) {
  if (!keys || !keys.size || !track) return false;
  if (track.artistId && keys.has(`id:${track.artistId}`)) return true;

  const list = artistList(track);
  for (const a of list) if (isBannedArtist(keys, a)) return true;

  const whole = String(track.displayArtist || track.artist || '').trim();
  return !!whole && keys.has(artistKey(whole));
}

/** Отфильтровать список треков: убрать всё, где есть заблокированный исполнитель. */
export function filterBannedTracks(keys, list) {
  if (!keys || !keys.size || !Array.isArray(list)) return list || [];
  return list.filter((t) => !trackHasBannedArtist(keys, t));
}
