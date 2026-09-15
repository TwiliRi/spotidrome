/**
 * Выгрузка имён всех треков фонотеки в текстовый файл.
 *
 * Subsonic не умеет отдать «все треки разом»: есть только списки альбомов
 * страницами (getAlbumList2) и содержимое одного альбома (getAlbum). Поэтому
 * список собираем в два прохода — сначала все альбомы страницами, потом
 * содержимое каждого, по несколько альбомов одновременно, чтобы большая
 * фонотека не выгружалась час.
 *
 * Повторы отбрасываем по id: один и тот же трек может лежать в нескольких
 * альбомах (сборники, переиздания), а в списке он нужен один раз.
 */

const ALBUM_PAGE = 500;     // сколько альбомов запрашиваем за раз
const MAX_PAGES = 200;      // потолок: 100 000 альбомов, чтобы не долбить сервер вслепую
const LANES = 5;            // столько альбомов опрашиваем одновременно

/** Ключ повтора: по id, а если его нет — по содержимому. */
const keyOf = (s) => (s?.id != null
  ? `id:${s.id}`
  : `${String(s?.artist || '')}|${String(s?.title || '')}|${String(s?.album || '')}|${s?.duration || 0}`);

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** «Исполнитель — Название»; без исполнителя — просто название. */
export function trackLine(song) {
  const title = clean(song?.title);
  const artist = clean(song?.artist);
  if (!title) return '';
  return artist ? `${artist} — ${title}` : title;
}

/** Сортировка по исполнителю, затем по названию: без регистра, числа по-человечески. */
const collator = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator('ru', { sensitivity: 'base', numeric: true })
  : { compare: (a, b) => String(a).localeCompare(String(b)) };

export function sortTracks(songs) {
  return [...songs].sort((a, b) => {
    const A = clean(a?.artist), B = clean(b?.artist);
    const byArtist = collator.compare(A, B);
    if (byArtist) return byArtist;
    return collator.compare(clean(a?.title), clean(b?.title));
  });
}

/** Убрать повторы (сохраняя порядок) и выбросить всё без названия. */
export function dedupeTracks(songs) {
  const seen = new Set();
  const out = [];
  for (const s of songs || []) {
    if (!clean(s?.title)) continue;
    const k = keyOf(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fileDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Имя файла: только латиница и цифры — так оно не спотыкается ни на одной файловой системе. */
export const dumpFileName = (d = new Date()) => `spotidrome-tracks-${fileDate(d)}.txt`;

/**
 * Весь список треков фонотеки.
 *
 * @param {object}   api                 клиент Subsonic
 * @param {object}   o
 * @param {Function} o.onProgress        ({ albums, done, tracks }) — для счётчика в интерфейсе
 * @param {Function} o.alive             () => boolean — false прерывает сбор
 * @returns {Promise<{songs:Array, albums:number, stopped:boolean}>}
 */
export async function collectAllTracks(api, { onProgress, alive = () => true } = {}) {
  const albums = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let list = [];
    try {
      // порядок не важен — перед записью всё равно сортируем; по алфавиту
      // сервер отдаёт стабильно, без сюрпризов между страницами
      list = await api.albumList('alphabeticalByName', ALBUM_PAGE, page * ALBUM_PAGE);
    } catch {
      break;                                   // сервер отвалился — пишем то, что успели
    }
    if (!Array.isArray(list) || !list.length) break;
    for (const a of list) if (a?.id != null) albums.push(a);
    if (list.length < ALBUM_PAGE) break;       // короткая страница — это последняя
    if (!alive()) return { songs: [], albums: albums.length, stopped: true };
  }

  const seen = new Set();
  const songs = [];
  let done = 0;
  let cursor = 0;

  const lane = async () => {
    while (cursor < albums.length && alive()) {
      const al = albums[cursor++];
      let got = [];
      try {
        const r = await api.getAlbum(al.id);
        got = Array.isArray(r?.songs) ? r.songs : [];
      } catch {
        got = [];                              // альбом не отдался — остальные всё равно соберём
      }
      for (const s of got) {
        if (!clean(s?.title)) continue;
        const k = keyOf(s);
        if (seen.has(k)) continue;
        seen.add(k);
        songs.push(s);
      }
      done += 1;
      onProgress?.({ albums: albums.length, done, tracks: songs.length });
    }
  };

  await Promise.all(Array.from({ length: Math.min(LANES, albums.length || 1) }, () => lane()));
  return { songs, albums: albums.length, stopped: !alive() };
}

/**
 * Готовый текст файла: две служебные строки и список «Исполнитель — Название».
 *
 * @param {Array}  songs
 * @param {object} o  { server, date }
 */
export function tracksToText(songs, { server = '', date = new Date() } = {}) {
  const list = sortTracks(dedupeTracks(songs));
  const lines = list.map(trackLine).filter(Boolean);
  const where = server ? ` · ${server}` : '';
  const head = [
    `# Spotidrome · список треков: ${lines.length}`,
    `# ${stamp(date)}${where}`,
    '',
  ];
  return `${head.join('\n')}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}
