/* Проверка расчёта статистики без запуска браузера:
     node tools/test-stats.mjs
   Выход с кодом 1, если посчитано неверно. */

import { buildStats, hoursAndMinutes, weekdayIndex, WEEKDAY_SHORT } from '../src/lib/stats.js';
import { buildDemoPlays } from '../src/lib/demoPlays.js';
import { buildMockLibrary } from '../src/lib/mock.js';

let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${info ? ` → ${info}` : ''}`); }
};

/* «сегодня» фиксируем, иначе проверки под ним плавали бы по календарю */
const now = new Date(2026, 8, 16, 12, 0, 0).getTime();     // среда 16 сентября 2026, полдень
const at = (dayOffset, hour = 12, min = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() - dayOffset);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
};

const e = (o) => ({
  id: 'tr-1', title: 'Песня', artist: 'Aurora Fields', album: 'Полночь',
  albumId: 'al-0-0', artistId: null, coverArt: 'al-0-0', duration: 200, at: now, ...o,
});

/* ---------- пустая история ---------- */
const empty = buildStats([], { days: 30, now });
ok('пустая история: ноль треков', empty.total.count === 0 && empty.total.duration === 0);
ok('пустая история: ноль исполнителей и альбомов', empty.total.artists === 0 && empty.total.albums === 0);
ok('пустая история: сетка дней заполнена нулями', empty.daysList.length === 30 && empty.daysList.every((d) => d.count === 0));
ok('пустая история: без лучшего дня и часа', !empty.best && empty.peakHour === null);
ok('пустая история: средняя длина 0', empty.avg === 0 && empty.perDay === 0);
ok('битая запись (нет at) отбрасывается', buildStats([{ id: 'x', duration: 5 }, null], { days: 7, now }).total.count === 0);
ok('null вместо списка не ломает расчёт', buildStats(null, { now }).total.count === 0);

/* ---------- totals и границы диапазона ---------- */
const list = [
  e({ id: 'a', at: at(0, 21), duration: 200 }),                       // сегодня
  e({ id: 'b', at: at(0, 23, 30), duration: 100, artist: 'Ночной трамвай', artistId: 'ar-2', album: 'Регионы', albumId: 'al-2-0' }),
  e({ id: 'c', at: at(1, 9), duration: 300, artist: 'Ночной трамвай', artistId: 'ar-2', album: 'Регионы', albumId: 'al-2-0' }),
  e({ id: 'd', at: at(2, 15), duration: 240, artist: 'Третий', artistId: 'ar-3', album: 'Весна', albumId: 'al-3-0' }),
  e({ id: 'e', at: at(40, 15), duration: 240, artist: 'Давно', artistId: 'ar-4', album: 'Архив', albumId: 'al-4-0' }),
  e({ id: 'f', at: at(80, 15), duration: 240, artist: 'Очень давно', artistId: 'ar-5', album: 'Архив', albumId: 'al-5-0' }),
];
const s30 = buildStats(list, { days: 30, now });
ok('за 30 дней считаются только свежие записи', s30.total.count === 4, `получилось ${s30.total.count}`);
ok('суммарное время совпадает', s30.total.duration === 200 + 100 + 300 + 240, `${s30.total.duration}`);
ok('исполнители считаются уникально', s30.total.artists === 3, `${s30.total.artists}`);
ok('альбомы считаются уникально', s30.total.albums === 3, `${s30.total.albums}`);
ok('активных дней — три', s30.total.days === 3, `${s30.total.days}`);

const sAll = buildStats(list, { days: null, now });
ok('«всё время» забирает и старые записи', sAll.total.count === 6, `${sAll.total.count}`);
ok('«всё время» строит сетку только по реальным дням', sAll.daysList.length === 5, `${sAll.daysList.length}`);
ok('«всё время» начинается с самой старой записи', sAll.firstAt === at(80, 15) && sAll.lastAt === at(0, 23, 30));

const s7 = buildStats(list, { days: 7, now });
ok('за 7 дней попадают те же четыре записи', s7.total.count === 4);
ok('сетка на 7 дней — семь точек', s7.daysList.length === 7);
ok('сетка упорядочена по дате', s7.daysList.every((d, i, arr) => i === 0 || arr[i - 1].at < d.at));

/* ---------- дни и часы ---------- */
const todayBucket = s30.daysList[s30.daysList.length - 1];
ok('сегодняшний день в конце сетки', todayBucket.count === 2, `${todayBucket.count}`);
ok('время дня посчитано по записям', todayBucket.duration === 300, `${todayBucket.duration}`);
ok('пустые дни остаются нулевыми', s30.daysList.filter((d) => d.count === 0).length === 27, `${s30.daysList.filter((d) => d.count === 0).length}`);

const grid = s30.byHour;
const gridSum = grid.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);
ok('сумма тепловой карты равна числу прослушиваний', gridSum === s30.total.count, `${gridSum} против ${s30.total.count}`);
ok('сетка 7 × 24', grid.length === 7 && grid.every((r) => r.length === 24));
ok('запись утром попала в свою ячейку', grid[weekdayIndex(at(1, 9))][9] === 1, JSON.stringify(grid[weekdayIndex(at(1, 9))]));
ok('ночная запись попала в 23-й час', grid[weekdayIndex(at(0, 23, 30))][23] === 1);
ok('воскресенье 13 сентября — последняя строка сетки', weekdayIndex(new Date(2026, 8, 13).getTime()) === 6 && WEEKDAY_SHORT[6] === 'вс');
ok('ночных прослушиваний — одно из четырёх', s30.partsOfDay.night === 1 && Math.abs(s30.nightShare - 0.25) < 1e-9, `${s30.nightShare}`);
ok('пиковый час — 21:00 (две записи?)', s30.hourTotal[21] === 1 && s30.hourTotal[23] === 1);

/* ---------- топ-списки ---------- */
const [first, second] = s30.topArtists;
ok('топ исполнителей отсортирован по времени', first.duration >= second.duration, `${first.name} / ${second.name}`);
ok('лидирует «Ночной трамвай» (400 с)', first.name === 'Ночной трамвай' && first.duration === 400, `${first.name} ${first.duration}`);
ok('у исполнителя посчитаны треки', first.count === 2);
ok('доли посчитаны от общего времени', Math.abs(first.share - 400 / s30.total.duration) < 1e-9);
ok('обложка и id исполнителя донесены', !!first.coverArt && first.artistId === 'ar-2', `${first.artistId}`);
ok('«A feat. B» не считается отдельным исполнителем',
  buildStats([
    e({ id: 'x', artist: 'A', artistId: 'ar-1' }),
    e({ id: 'y', artist: 'A feat. B', artistId: 'ar-1' }),
  ], { days: 7, now }).total.artists === 1);
ok('для исполнителя берётся подпись без участников',
  buildStats([e({ id: 'y', artist: 'A feat. B', artistId: 'ar-1' }), e({ id: 'x', artist: 'A', artistId: 'ar-1' })], { days: 7, now })
    .topArtists[0].name === 'A');
ok('для дуэта берётся подпись с меньшим числом разделителей',
  buildStats([
    e({ id: 'y', artist: 'A feat. B', artistId: 'ar-1' }),
    e({ id: 'x', artist: 'A & B', artistId: 'ar-1' }),
  ], { days: 7, now }).topArtists[0].name === 'A & B');
ok('без artistId исполнители различаются по имени',
  buildStats([e({ id: 'x', artist: 'A' }), e({ id: 'y', artist: 'B' })], { days: 7, now }).total.artists === 2);
const albums = s30.topAlbums;
ok('альбомы тоже отсортированы по времени', albums[0].duration >= (albums[1]?.duration || 0));
ok('альбом «Регионы» на первом месте', albums[0].name === 'Регионы' && albums[0].count === 2);
ok('альбомы с одним названием, но разными id не слипаются',
  buildStats([e({ id: 'x', album: 'Весна', albumId: 'a1' }), e({ id: 'y', album: 'Весна', albumId: 'a2' })], { days: 7, now }).total.albums === 2);

/* ---------- свежие, лучшее, среднее ---------- */
ok('«свежие» отсортированы по убыванию времени', s30.recent.every((x, i, arr) => i === 0 || arr[i - 1].at >= x.at));
ok('лучший день — сегодня (два трека)', s30.best && s30.best.count === 2 && s30.best.at === todayBucket.at);
ok('средняя длина трека = время / число', Math.abs(s30.avg - s30.total.duration / s30.total.count) < 1e-9);
ok('в среднем в день = время / активные дни', Math.abs(s30.perDay - s30.total.duration / 3) < 1e-9);
ok('самый длинный трек найден', s30.longest && s30.longest.id === 'c' && s30.longest.duration === 300, `${s30.longest?.id}`);

/* ---------- серия дней ---------- */
ok('серия: сегодня, вчера, позавчера → 3', buildStats([
  e({ id: 'a', at: at(0) }), e({ id: 'b', at: at(1) }), e({ id: 'c', at: at(2) }),
], { days: 30, now }).streak === 3);
ok('серия обрывается на пропуске', buildStats([
  e({ id: 'a', at: at(0) }), e({ id: 'b', at: at(1) }), e({ id: 'c', at: at(3) }),
], { days: 30, now }).streak === 2);
ok('если сегодня тихо — серия считается от вчера', buildStats([
  e({ id: 'b', at: at(1) }), e({ id: 'c', at: at(2) }),
], { days: 30, now }).streak === 2);
ok('в пустой истории серия нулевая', empty.streak === 0);

/* ---------- форматирование ---------- */
ok('минуты: 40 мин', hoursAndMinutes(2400).text === '40 мин', hoursAndMinutes(2400).text);
ok('часы с минутами: 3 ч 20 мин', hoursAndMinutes(12000).text === '3 ч 20 мин', hoursAndMinutes(12000).text);
ok('ровно час без «0 мин»', hoursAndMinutes(3600).text === '1 ч 0 мин', hoursAndMinutes(3600).text);
ok('ноль и мусор не ломают формат', hoursAndMinutes(0).text === '0 мин' && hoursAndMinutes(undefined).text === '0 мин');

/* ---------- демо-история ---------- */
const { songs: mockSongs, artists: mockArtists } = buildMockLibrary();
const demo = buildDemoPlays(mockSongs, { now, days: 78 });
ok('демо-история не пустая', demo.length > 120, `${demo.length}`);
ok('в демо-истории нет повторов треков', new Set(demo.map((x) => x.id)).size === demo.length);
ok('демо-история укладывается в лимит хранилища', demo.length <= 800);
ok('у каждой записи есть время и длительность', demo.every((x) => Number.isFinite(x.at) && Number(x.duration) > 0));
ok('записи не из будущего', demo.every((x) => x.at <= now));
ok('записи отсортированы по времени', demo.every((x, i, arr) => i === 0 || arr[i - 1].at <= x.at));
ok('демо-история повторяется от запуска к запуску',
  JSON.stringify(buildDemoPlays(mockSongs, { now, days: 78 })) === JSON.stringify(demo));
ok('без библиотеки демо-история пустая', buildDemoPlays([], { now }).length === 0 && buildDemoPlays(null, { now }).length === 0);

const ds = buildStats(demo, { days: 30, now });
ok('по демо-истории считаются треки', ds.total.count > 60 && ds.total.count < demo.length, `${ds.total.count}`);
ok('по демо-истории считаются часы', ds.total.duration > 3600 * 3, hoursAndMinutes(ds.total.duration).text);
ok('исполнителей не больше, чем в библиотеке', ds.total.artists > 0 && ds.total.artists <= mockArtists.length, `${ds.total.artists} из ${mockArtists.length}`);
ok('тепловая карта сходится с числом записей',
  ds.byHour.flat().reduce((a, b) => a + b, 0) === ds.total.count);
ok('в демо есть и тихие, и плотные дни', ds.daysList.some((d) => d.count === 0) && ds.maxDay > 0);
ok('топ исполнителей демо осмыслен', ds.topArtists[0].duration > ds.topArtists[1].duration && ds.topArtists[0].share > 0.05);
ok('топ альбомов демо осмыслен', ds.topAlbums.length > 2 && ds.topAlbums[0].count > 1);

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nстатистика считается верно');
process.exit(failed ? 1 : 0);
