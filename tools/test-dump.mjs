/* Выгрузка списка треков в .txt без запуска приложения:
     node tools/test-dump.mjs
   Проверено: строка трека, сортировка, отбрасывание повторов, обход альбомов
   страницами (в том числе отмена и падение одного альбома), готовый текст.
   Выход 1 — если что-то работает неверно. */

import {
  trackLine, sortTracks, dedupeTracks, collectAllTracks, tracksToText, dumpFileName,
} from '../src/lib/trackDump.js';

let failed = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}\n     получено: ${a}\n     ожидалось: ${b}`); }
};
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};

const song = (id, artist, title, extra = {}) => ({ id, artist, title, album: 'A', duration: 100, ...extra });

/* ---------------- строка трека ---------------- */
eq('строка: исполнитель — название', trackLine(song(1, 'Radiohead', 'Creep')), 'Radiohead — Creep');
eq('строка: без исполнителя — одно название', trackLine(song(2, '', 'Untitled')), 'Untitled');
eq('строка: без названия — пусто', trackLine(song(3, 'X', '  ')), '');
eq('строка: лишние пробелы схлопываются', trackLine(song(4, 'A  B', 'C   D')), 'A B — C D');

/* ---------------- повторы ---------------- */
eq('повторы: по id', dedupeTracks([song(1, 'A', 'T'), song(1, 'A', 'T')]).length, 1);
eq('повторы: разные id — оба', dedupeTracks([song(1, 'A', 'T'), song(2, 'A', 'T')]).length, 2);
eq('повторы: без id — по содержимому',
  dedupeTracks([song(null, 'A', 'T'), song(undefined, 'A', 'T')]).length, 1);
eq('повторы: пустые названия выброшены',
  dedupeTracks([song(1, 'A', ''), song(2, 'A', 'T')]).length, 1);

/* ---------------- сортировка ---------------- */
const names = (list) => sortTracks(list).map(trackLine);
eq('сортировка: по исполнителю, без регистра (ё и регистр не ломают порядок)',
  names([song(1, 'Бетховен', 'К Элизе'), song(2, 'ангел', 'Песня'), song(3, 'Ёлка', 'Ёлка')]),
  ['ангел — Песня', 'Бетховен — К Элизе', 'Ёлка — Ёлка']);
eq('сортировка: латиница после кириллицы — как в русской локали',
  names([song(1, 'Bach', 'Air'), song(2, 'Бетховен', 'К Элизе')]),
  ['Бетховен — К Элизе', 'Bach — Air']);
eq('сортировка: один исполнитель — по названию',
  names([song(1, 'A', 'Яблоко'), song(2, 'A', 'апельсин'), song(3, 'A', 'Банан')]),
  ['A — апельсин', 'A — Банан', 'A — Яблоко']);
eq('сортировка: числа по-человечески',
  names([song(1, 'A', 'Track 10'), song(2, 'A', 'Track 2')]),
  ['A — Track 2', 'A — Track 10']);

/* ---------------- обход альбомов ---------------- */
/* Фейк сервера: отдаёт ровно столько альбомов, сколько попросили (но не
   больше, чем есть), — как настоящий. Страница в 500 альбомов закрывается
   коротким ответом, поэтому многопроходный обход проверяем на 1200 альбомах:
   первые две страницы полные, третья короткая. */
const apiOf = (albums, songsByAlbum) => {
  const calls = [];
  return {
    calls,
    albumList: async (type, size, offset) => {
      calls.push({ type, size, offset });
      return albums.slice(offset, offset + size);
    },
    getAlbum: async (id) => {
      if (songsByAlbum[id] === 'boom') throw new Error('сервер упал');
      return { album: { id }, songs: songsByAlbum[id] || [] };
    },
  };
};

{
  // 1200 альбомов: три прохода, на четвёртый не идём
  const albums = Array.from({ length: 1200 }, (_, i) => ({ id: `a${i}` }));
  const api = apiOf(albums, {
    a0: [song('s1', 'A', 'Один')],
    a1: [song('s2', 'B', 'Два')],
    a2: [song('s3', 'C', 'Три')],
  });
  const progress = [];
  const res = await collectAllTracks(api, { onProgress: (p) => progress.push(p) });
  eq('обход: все альбомы со всех страниц', res.albums, 1200);
  eq('обход: страницы запрашиваются по смещению', api.calls.map((c) => c.offset), [0, 500, 1000]);
  ok('обход: просим по алфавиту — между страницами ничего не перескакивает',
    api.calls.every((c) => c.type === 'alphabeticalByName'));
  eq('обход: собрали треки всех альбомов', res.songs.map((s) => s.title), ['Один', 'Два', 'Три']);
  ok('обход: счётчик дошёл до конца',
    progress.length === 1200 && progress[1199].done === 1200 && progress[1199].albums === 1200);
  ok('обход: счётчик треков растёт', progress[0].tracks === 1 && progress[1199].tracks === 3);
}

{
  // короткая первая страница = она же последняя: второго запроса нет
  const api = apiOf([{ id: 'a1' }], { a1: [song('s1', 'A', 'Один')] });
  const res = await collectAllTracks(api);
  eq('обход: одна страница — один запрос', api.calls.length, 1);
  eq('обход: альбомы с единственной страницы', res.albums, 1);
}

{
  // один и тот же трек в двух альбомах (сборник) — в списке один раз
  const api = apiOf([{ id: 'x' }, { id: 'y' }], {
    x: [song('s1', 'A', 'Дубль'), song('s2', 'A', 'Второй')],
    y: [song('s1', 'A', 'Дубль'), song('s3', 'B', 'Третий')],
  });
  const res = await collectAllTracks(api);
  eq('обход: повтор между альбомами убран', res.songs.map((s) => s.title), ['Дубль', 'Второй', 'Третий']);
}

{
  // альбом, который сервер не отдал, не роняет всю выгрузку
  const api = apiOf([{ id: 'ok' }, { id: 'bad' }, { id: 'ok2' }], {
    ok: [song('s1', 'A', 'Живой')],
    bad: 'boom',
    ok2: [song('s2', 'B', 'Тоже живой')],
  });
  const res = await collectAllTracks(api);
  eq('обход: упавший альбом пропущен', res.songs.map((s) => s.title), ['Живой', 'Тоже живой']);
}

{
  // отмена на переборе альбомов: дальше страниц не идём
  let alive = true;
  const albums = Array.from({ length: 1200 }, (_, i) => ({ id: `a${i}` }));
  const api = apiOf(albums, {});
  const p = collectAllTracks(api, { alive: () => alive });
  alive = false;
  const res = await p;
  ok('обход: отмена останавливает перебор страниц', res.stopped === true && res.songs.length === 0);
  ok('обход: после отмены сервер больше не дёргают', api.calls.length === 1, `запросов ${api.calls.length}`);
}

{
  // отмена посреди альбомов: собрали не всё, но сказали, что остановились
  let alive = true;
  const albums = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}` }));
  const songs = {};
  albums.forEach((a) => { songs[a.id] = [song(`${a.id}s`, 'A', a.id)]; });
  const api = apiOf(albums, songs);
  const p = collectAllTracks(api, { alive: () => alive, onProgress: ({ done }) => { if (done >= 3) alive = false; } });
  const res = await p;
  ok('обход: отмена посреди альбомов', res.stopped === true && res.songs.length > 0 && res.songs.length < 40,
    `собрано ${res.songs.length}`);
}

/* ---------------- готовый текст ---------------- */
{
  const when = new Date(2026, 8, 13, 7, 20);
  const text = tracksToText([song(1, 'B', 'Второй'), song(2, 'A', 'Первый')], { server: 'демо', date: when });
  const lines = text.split('\n');
  eq('текст: шапка — что это и сколько', lines[0], '# Spotidrome · список треков: 2');
  eq('текст: шапка — когда и откуда', lines[1], '# 13.09.2026 07:20 · демо');
  eq('текст: после шапки пустая строка', lines[2], '');
  eq('текст: треки отсортированы', lines.slice(3), ['A — Первый', 'B — Второй', '']);
  ok('текст: заканчивается переводом строки', text.endsWith('\n'));
}
eq('текст: пустой список — только шапка',
  tracksToText([], { date: new Date(2026, 0, 2, 3, 4) }),
  '# Spotidrome · список треков: 0\n# 02.01.2026 03:04\n\n');
eq('текст: без сервера — без « · »',
  tracksToText([song(1, 'A', 'T')], { date: new Date(2026, 0, 2, 3, 4) }).split('\n')[1],
  '# 02.01.2026 03:04');
ok('имя файла: латиница и дата', /^spotidrome-tracks-\d{4}-\d{2}-\d{2}\.txt$/.test(dumpFileName(new Date(2026, 8, 13))),
  dumpFileName(new Date(2026, 8, 13)));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВыгрузка списка треков считается верно');
process.exit(failed ? 1 : 0);
