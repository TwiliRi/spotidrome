/**
 * Из какой музыкальной папки (библиотеки Navidrome) взят трек.
 *
 * Subsonic не отдаёт номер папки ни в ответе о треке, ни в ответе об альбоме —
 * только список самих папок (getMusicFolders). Поэтому соответствие
 * «альбом → папка» собираем сами: перебираем альбомы каждой папки по отдельности
 * (getAlbumList2 с musicFolderId) и запоминаем, где что лежит.
 *
 * Индекс необязательный: если его нет (сервер не отдал папки, оборвалась сеть,
 * одна папка на весь сервер), плеер просто не показывает метку — музыка при
 * этом играет как обычно.
 */

const CACHE_KEY = 'spotidrome.folder-index.v1';
const PAGE = 500;          // размер страницы getAlbumList2
const MAX_PAGES = 80;      // потолок: 40 000 альбомов на папку, чтобы не долбить сервер
const MAX_CACHE = 15000;   // больше этого в localStorage не пишем

/** Пустой индекс: «ничего не знаем». */
export const EMPTY_INDEX = { map: new Map(), single: null, ready: false, albums: 0 };

function sameFolders(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((f, i) => String(f.id) === String(b[i].id) && f.name === b[i].name);
}

/**
 * Ключ кэша: индекс привязан и к серверу, и к набору папок. Изменилось что-то
 * одно (другой сервер, переименовали папку) — старый кэш выбрасываем.
 */
export function folderIndexKey(api) {
  if (!api || api.demo) return 'demo';
  const host = String(api.creds?.url || '').replace(/\/+$/, '');
  return `${host}|${api.creds?.user || ''}`;
}

/**
 * Собрать индекс. При одной папке на сервере перебирать альбомы незачем:
 * любой трек и так из неё — запоминаем это как `single`.
 */
export async function buildAlbumFolderIndex(api, folders) {
  if (!api || !Array.isArray(folders) || folders.length === 0) return EMPTY_INDEX;
  if (folders.length === 1) return { map: new Map(), single: folders[0], ready: true, albums: 0 };

  const map = new Map();
  let albums = 0;

  for (const folder of folders) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let list = [];
      try {
        list = await api.albumList('alphabeticalByName', PAGE, page * PAGE, { musicFolderId: folder.id });
      } catch {
        break;                       // папка недоступна — остальные всё равно соберём
      }
      if (!Array.isArray(list) || list.length === 0) break;
      for (const al of list) {
        if (al && al.id != null) map.set(String(al.id), folder);
      }
      albums += list.length;
      if (list.length < PAGE) break; // последняя страница
    }
  }

  if (map.size === 0) return EMPTY_INDEX;
  return { map, single: null, ready: true, albums };
}

/** Папка конкретного трека (или null, если определить не удалось). */
export function folderOfSong(song, index) {
  if (!song || !index) return null;
  if (song.albumId != null) {
    const hit = index.map.get(String(song.albumId));
    if (hit) return hit;
  }
  return index.single || null;
}

/* ---------------- кэш в localStorage ----------------
   Перебор фонотеки — это десятки запросов, повторять их при каждом запуске
   незачем: сохраняем пары «альбом → номер папки» компактным списком. */

export function readFolderCache(key, folders) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!raw || raw.key !== key || !sameFolders(raw.folders, folders)) return null;
    const map = new Map();
    for (const pair of raw.pairs || []) {
      const folder = folders[pair[1]];
      if (folder && pair[0] != null) map.set(String(pair[0]), folder);
    }
    if (map.size === 0 && folders.length > 1) return null;
    return {
      map,
      single: folders.length === 1 ? folders[0] : null,
      ready: true,
      albums: map.size,
    };
  } catch {
    return null;
  }
}

export function writeFolderCache(key, folders, index) {
  if (!index || index.single || index.map.size === 0) return;   // одну папку кэшировать нечего
  if (index.map.size > MAX_CACHE) return;
  try {
    const order = new Map(folders.map((f, i) => [String(f.id), i]));
    const pairs = [];
    index.map.forEach((folder, albumId) => {
      const i = order.get(String(folder.id));
      if (i != null) pairs.push([albumId, i]);
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      key,
      folders: folders.map(({ id, name }) => ({ id, name })),
      pairs,
      at: Date.now(),
    }));
  } catch { /* переполненное хранилище — не беда, индекс соберётся заново */ }
}

export function dropFolderCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* нечего чистить */ }
}
