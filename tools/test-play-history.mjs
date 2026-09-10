/* Проверка истории прослушиваний (чистая логика, без браузера):
     node tools/test-play-history.mjs
   Выход 1 — если что-то работает неверно. */

import {
  pushPlay, dropPlay, clearPlays, sanitizePlays, buildDayRows, tracksOf, withinDays,
  statsFor, playedAgo, listenTime, dayLabel, dayKey, toPlayEntry,
  PLAY_MAX, MIN_LISTEN_SEC, DAY_MS,
} from '../src/lib/playHistory.js';

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

const T = (id, over = {}) => ({ id, title: `t${id}`, artist: 'A', album: 'B', albumId: `al${id}`, duration: 200, ...over });
const NOW = new Date('2026-05-20T15:30:00').getTime();

/* --- константы --- */
ok('порог прослушивания — десятки секунд', MIN_LISTEN_SEC >= 10 && MIN_LISTEN_SEC <= 40, String(MIN_LISTEN_SEC));
ok('разумный потолок истории', PLAY_MAX >= 200 && PLAY_MAX <= 5000, String(PLAY_MAX));

/* --- запись --- */
let h = [];
h = pushPlay(h, T('1'), { at: NOW, context: 'Альбом · B' });
eq('одна запись сверху', h.map((x) => x.id), ['1']);
eq('время и источник сохранены', [h[0].at, h[0].context], [NOW, 'Альбом · B']);

h = pushPlay(h, T('2'), { at: NOW + 1000 });
eq('новые сверху', h.map((x) => x.id), ['2', '1']);

h = pushPlay(h, T('2'), { at: NOW + 60000 });
eq('повтор того же трека не дублирует', h.map((x) => x.id), ['2', '1']);
eq('но время обновляется', h[0].at, NOW + 60000);

h = pushPlay(h, T('1'), { at: NOW + 90000 });
eq('трек уехал наверх', h.map((x) => x.id), ['1', '2']);

eq('пустой трек игнорируется', pushPlay(h, null, {}), h);
eq('без id игнорируется', pushPlay(h, { title: 'x' }, {}), h);

/* compact entry: только нужные поля */
const entry = toPlayEntry({ id: '9', title: 'Песня', artist: 'Арт', album: 'Алб', albumId: 'a1', coverArt: 'c1', duration: 210.7, extra: 'мусор', tracks: [1, 2, 3] }, { at: NOW });
eq('в запись не попадает мусор', Object.keys(entry).sort(), ['album', 'albumId', 'artist', 'artistId', 'at', 'context', 'coverArt', 'duration', 'id', 'title']);
eq('обложка берётся из albumId, если своей нет', toPlayEntry({ id: '1', albumId: 'a1' }).coverArt, 'a1');
eq('длительность округляется до числа', typeof entry.duration, 'number');

/* --- потолок --- */
let big = [];
for (let i = 0; i < PLAY_MAX + 50; i++) big = pushPlay(big, T(String(i)), { at: NOW + i * 1000 });
eq('история не растёт бесконечно', big.length, PLAY_MAX);
eq('старые вытесняются', big[0].id, String(PLAY_MAX + 49));

/* --- удаление и очистка --- */
let d = pushPlay(pushPlay([], T('a'), { at: 1000 }), T('b'), { at: 2000 });
eq('dropPlay убирает запись по метке', dropPlay(d, 1000).map((x) => x.id), ['b']);
eq('dropPlay по несуществующему времени ничего не меняет', dropPlay(d, 777) === d, true);
eq('clearPlays обнуляет', clearPlays(d), []);

/* --- чистка того, что пришло с диска --- */
eq('sanitize: мусор не проходит', sanitizePlays('нет'), []);
eq('sanitize: остаются только записи с id и временем', sanitizePlays([{ id: 'a', at: 1 }, { at: 5 }, {}, null]).map((x) => x.id), ['a']);
eq('sanitize: сортировка по свежести', sanitizePlays([{ id: 'a', at: 100 }, { id: 'b', at: 900 }]).map((x) => x.id), ['b', 'a']);
const cleaned = sanitizePlays([{ id: 12, at: '500', title: 42, duration: 'abc' }]);
eq('sanitize: типы приводятся', [cleaned[0].id, cleaned[0].at, cleaned[0].title, cleaned[0].duration], ['12', 500, '42', 0]);
eq('sanitize: ceiling', sanitizePlays(Array.from({ length: PLAY_MAX + 5 }, (_, i) => ({ id: String(i), at: i + 1 }))).length, PLAY_MAX);

/* --- дни --- */
eq('dayKey локальный', dayKey(NOW), '2026-05-20');
eq('dayLabel сегодня', dayLabel(NOW, NOW), 'Сегодня');
eq('dayLabel вчера', dayLabel(NOW - DAY_MS, NOW), 'Вчера');
eq('dayLabel позавчера — с датой', /^1[89] мая$/.test(dayLabel(NOW - 2 * DAY_MS, NOW)), true, dayLabel(NOW - 2 * DAY_MS, NOW));
ok('dayLabel в другом году — с годом', /2025/.test(dayLabel(NOW - 400 * DAY_MS, NOW)), dayLabel(NOW - 400 * DAY_MS, NOW));

/* --- диапазоны --- */
const many = [
  { id: 'a', at: NOW, duration: 100 },
  { id: 'b', at: NOW - DAY_MS, duration: 200 },
  { id: 'c', at: NOW - 3 * DAY_MS, duration: 300 },
  { id: 'd', at: NOW - 40 * DAY_MS, duration: 400 },
];
eq('withinDays(1) — только сегодня', withinDays(many, 1, NOW).map((x) => x.id), ['a']);
eq('withinDays(7) — четыре дня внутри недели', withinDays(many, 7, NOW).map((x) => x.id), ['a', 'b', 'c']);
eq('withinDays(null) — всё', withinDays(many, null, NOW).length, 4);

/* --- строки с заголовками дней --- */
const rows = buildDayRows(many, { days: 7, now: NOW });
eq('строки: 3 заголовка + 3 трека', rows.length, 6);
eq('строки чередуются', rows.map((r) => r.kind), ['day', 'track', 'day', 'track', 'day', 'track']);
eq('в заголовке число треков', rows[0].count, 1);
eq('первый день — сегодня', rows[0].label, 'Сегодня');
eq('последний день — позавчера', rows[4].label !== 'Сегодня' && rows[4].label !== 'Вчера', true);
eq('заголовок суммирует длительность дня', buildDayRows([{ id: 'x', at: NOW, duration: 100 }, { id: 'y', at: NOW, duration: 50 }])[0].duration, 150);
eq('пустая история — пустые строки', buildDayRows([], { days: 7, now: NOW }), []);
eq('история без now тоже работает', buildDayRows([{ id: 'q', at: Date.now(), duration: 1 }]).length, 2);
eq('в заголовке лежат треки дня', buildDayRows(many, { days: 1, now: NOW })[0].items.map((x) => x.id), ['a']);
eq('заголовок knows сколько треков', buildDayRows(many, { days: 7, now: NOW })[0].items.length === buildDayRows(many, { days: 7, now: NOW })[0].count, true);
eq('трек помнит свой день', buildDayRows(many, { days: 1, now: NOW })[1].day, dayKey(NOW));
eq('tracksOf отдаёт только треки', tracksOf(buildDayRows(many, { days: 7, now: NOW })).map((x) => x.id), ['a', 'b', 'c']);
eq('tracksOf про пустоту', tracksOf([]), []);

/* --- статистика --- */
eq('statsFor считает', statsFor([{ id: 'a', duration: 60 }, { id: 'a', duration: 60 }, { id: 'b', duration: 30 }]), { count: 3, unique: 2, duration: 150, artists: 0 });
eq('statsFor про пустой список', statsFor([]), { count: 0, unique: 0, duration: 0, artists: 0 });

/* --- подписи --- */
eq('playedAgo: минуты', playedAgo(NOW - 5 * 60000, NOW), '5 мин назад');
eq('playedAgo: только что', playedAgo(NOW - 2000, NOW), 'только что');
eq('playedAgo: часы сегодня', playedAgo(NOW - 3 * 3600000, NOW), '3 ч назад');
eq('playedAgo: вчера', playedAgo(NOW - DAY_MS - 60000, NOW), 'вчера');
eq('playedAgo: 10 дней — счётчик дней', playedAgo(NOW - 10 * DAY_MS, NOW), '10 дн. назад');
ok('playedAgo: больше месяца — дата', /^\d+\s+[а-яё]+$/i.test(playedAgo(NOW - 60 * DAY_MS, NOW)), playedAgo(NOW - 60 * DAY_MS, NOW));
eq('listenTime: часы', listenTime(3720), '1 ч 2 мин');
eq('listenTime: минуты', listenTime(180), '3 мин');
eq('listenTime: пусто', listenTime(0), 'меньше минуты');

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nвсе проверки истории прослушиваний пройдены');
process.exit(failed ? 1 : 0);
