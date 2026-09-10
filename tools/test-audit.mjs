/* Регрессии после сплошного аудита кодовой базы.
     node tools/test-audit.mjs
   Проверено: форматирование длительностей и размеров, очистка HTML из
   Last.fm, разбор ответа сервера при правке плейлиста, разбор LRC не трогали.
   Выход 1 — если что-то работает неверно. */

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

const util = await import('../src/lib/util.js');
const { fmt, fmtLong, bytes, stripHtml, decodeEntities, plural, songsWord } = util;

/* ---------- fmt: часы, минуты, секунды ---------- */
eq('fmt: обычная длительность', fmt(187), '3:07');
eq('fmt: ноль', fmt(0), '0:00');
eq('fmt: ровно минута', fmt(60), '1:00');
eq('fmt: больше часа — показываем часы', fmt(4532), '1:15:32');
eq('fmt: 10 часов', fmt(36000 + 65), '10:01:05');
eq('fmt: дробная', fmt(187.9), '3:07');
eq('fmt: мусор → 0:00', fmt(NaN), '0:00');
eq('fmt: отрицательная → 0:00', fmt(-42), '0:00');

/* ---------- fmtLong: «60 мин» быть не должно ---------- */
eq('fmtLong: 39 минут', fmtLong(39 * 60), '39 мин');
eq('fmtLong: округление не даёт 60 мин', fmtLong(59.7 * 60), '1 ч 0 мин');
eq('fmtLong: час с минутами', fmtLong(3661), '1 ч 1 мин');
eq('fmtLong: два часа', fmtLong(7320), '2 ч 2 мин');
eq('fmtLong: пусто', fmtLong(0), '');
eq('fmtLong: отрицательное → пусто', fmtLong(-10), '');

/* ---------- bytes: петабайты и гадость ---------- */
eq('bytes: байты', bytes(512), '512 Б');
eq('bytes: килобайты', bytes(2048), '2.0 КБ');
eq('bytes: гигабайты', bytes(3 * 1024 ** 3), '3.0 ГБ');
eq('bytes: терабайты', bytes(2.5 * 1024 ** 4), '2.5 ТБ');
eq('bytes: петабайты', bytes(4 * 1024 ** 5), '4.0 ПБ');
ok('bytes: нет undefined на больших числах', !String(bytes(1024 ** 7)).includes('undefined'));
eq('bytes: отрицательное → 0 Б', bytes(-1000), '0 Б');
eq('bytes: NaN → 0 Б', bytes(NaN), '0 Б');
eq('bytes: строка', bytes('2048'), '2.0 КБ');

/* ---------- склонения ---------- */
eq('plural: 1 трек', songsWord(1), '1 трек');
eq('plural: 2 трека', songsWord(2), '2 трека');
eq('plural: 5 треков', songsWord(5), '5 треков');
eq('plural: 11 треков', songsWord(11), '11 треков');
eq('plural: 21 трек', songsWord(21), '21 трек');

/* ---------- HTML из сервера превращаем в безопасный текст ---------- */
eq('stripHtml: теги вырезаны', stripHtml('<p>Одна <b>группа</b></p>'), 'Одна группа');
eq('stripHtml: скрипт удаён целиком', stripHtml('а<script>alert(1)</script>б'), 'а б');
ok('stripHtml: обработчики не попадают в DOM', !/onerror/i.test(stripHtml('<img src=x onerror=alert(1)>')),
  stripHtml('<img src=x onerror=alert(1)>'));
eq('stripHtml: <br> → перевод строки', stripHtml('раз<br>два'), 'раз\nдва');
eq('stripHtml: &amp; разворачивается', stripHtml('Tom &amp; Jerry'), 'Tom & Jerry');
eq('stripHtml: пустой ввод', stripHtml(''), '');
eq('stripHtml: undefined', stripHtml(undefined), '');
eq('decodeEntities: числовые ссылки', decodeEntities('&#1040;&#x410;&nbsp;x'), 'АА x');
eq('decodeEntities: непонятное остаётся как есть', decodeEntities('&nbspx; &amp'), '&nbspx; &amp');
ok('stripHtml: не ломается на битом теге', stripHtml('a < b и c > d').length > 0);

/* ---------- api: ошибка сервера при правке плейлиста не должна выглядеть успехом ---------- */
const realFetch = globalThis.fetch;
const api = (await import('../src/lib/api.js')).default;
api.configure({ url: 'https://music.example.com', username: 'u', password: 'p' });

const jsonResponse = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  text: async () => JSON.stringify(obj),
  json: async () => obj,
});

let lastUrl = '';
globalThis.fetch = async (url) => {
  lastUrl = String(url);
  return jsonResponse({ 'subsonic-response': { status: 'failed', error: { code: 0, message: 'playlist not found' } } });
};
let threw = null;
try { await api.updatePlaylist('12', { songIdToAdd: ['1', '2'] }); } catch (e) { threw = e; }
ok('updatePlaylist: сервер ответил failed → бросаем ошибку', !!threw && /playlist not found/.test(threw.message), threw?.message);
ok('updatePlaylist: повторяющиеся songIdToAdd сохранены', (lastUrl.match(/songIdToAdd=/g) || []).length === 2, lastUrl);
ok('updatePlaylist: параметры авторизации на месте', /[?&]u=u&/.test(lastUrl) && /[&]t=[0-9a-f]{32}&/.test(lastUrl), lastUrl);

globalThis.fetch = async () => jsonResponse({ 'subsonic-response': { status: 'ok' } });
const good = await api.updatePlaylist('12', { name: 'Новое имя' });
eq('updatePlaylist: успешный ответ проходит', good.status, 'ok');

globalThis.fetch = async () => jsonResponse({}, 500);
threw = null;
try { await api.updatePlaylist('12', { name: 'x' }); } catch (e) { threw = e; }
ok('updatePlaylist: HTTP 500 → ошибка', !!threw && /500/.test(threw.message), threw?.message);

globalThis.fetch = async () => jsonResponse({ 'subsonic-response': { status: 'failed', error: { code: 40 } } });
threw = null;
try { await api.call('getAlbum', { id: '1' }); } catch (e) { threw = e; }
ok('call: code 40 → «Неверный логин или пароль»', /Неверный логин/.test(threw?.message || ''), threw?.message);

// «висящий» сервер больше не блокирует интерфейс навсегда
globalThis.fetch = async (url, init) => new Promise((resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});
threw = null;
try { await api.call('ping', {}, { timeout: 1200 }); } catch (e) { threw = e; }
ok('call: таймаут прерывает бесконечное ожидание', /не ответил за/.test(threw?.message || ''), threw?.message);

globalThis.fetch = realFetch;

/* ---------- AutoDJ: кандидаты не должны повторять очередь и дизлайки ---------- */
const { pickAutoDj } = await import('../src/lib/autodj.js');
const mk = (n, artist, genre) => Array.from({ length: n }, (_, i) => ({ id: `${genre || 'g'}${artist}${i}`, title: `t${i}`, artist, genre }));
const fakeApi = {
  getSimilarSongs: async () => mk(6, 'Same'),
  getSongsByGenre: async () => mk(6, 'Other', 'rock'),
  getRandomSongs: async (n) => mk(n, 'Random'),
  getStarred: async () => ({ songs: mk(4, 'Star') }),
  getTopSongs: async () => mk(4, 'Star'),
  getArtistInfo: async () => ({ similarArtist: [] }),
};
const picked = await pickAutoDj({ api: fakeApi, mode: 'mix', seed: { id: 'seed', artist: 'Same', genre: 'rock' }, need: 4, exclude: new Set(['gSame0']) });
eq('autodj: исключаем уже стоящее в очереди', picked.some((t) => t.id === 'gSame0'), false);
eq('autodj: берём ровно столько, сколько просят', picked.length, 4);
eq('autodj: без дублей', new Set(picked.map((t) => t.id)).size, picked.length);
const rnd = await pickAutoDj({ api: fakeApi, mode: 'random', seed: null, need: 3, exclude: new Set() });
eq('autodj: режим «случайно» работает без затравки', rnd.length, 3);

/* ---------- indexById: строки таблицы ≠ порядок в плейлисте ---------- */
const { indexById } = util;
eq('indexById: по объекту', indexById([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { id: 'b' }), 1);
eq('indexById: по id', indexById([{ id: 'a' }, { id: 'b' }], 'b'), 1);
eq('indexById: нет такого', indexById([{ id: 'a' }], { id: 'zz' }), -1);
eq('indexById: списка нет', indexById(null, { id: 'a' }), -1);
eq('indexById: дырки в списке', indexById([null, { id: 'a' }], { id: 'a' }), 1);
eq('indexById: item без id', indexById([{ id: 'a' }], {}), -1);

/* ---------- виртуализация и «Недавнее»: структурные гарантии ----------
   Проверяем не логику (она покрыта своими тестами), а то, что легко
   незаметно сломать правкой: откуда берётся высота строки, что список
   действительно отдаёт react-window, и что историю не теряет персист. */

const fs = await import('node:fs');
const { readFileSync } = fs;
const path0 = (await import('node:path')).default;
const { fileURLToPath } = await import('node:url');
const root = path0.resolve(path0.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path0.join(root, rel), 'utf8');

const pkg = JSON.parse(src('package.json'));
ok('react-window в зависимостях (не в dev)', typeof pkg.dependencies?.['react-window'] === 'string', JSON.stringify(pkg.dependencies?.['react-window']));
ok('виртуализатор — из react-window, а не самописный', /from 'react-window'/.test(src('src/components/VList.jsx')));

const tl = src('src/components/TrackList.jsx');
ok('TrackList виртуализирует длинные списки', /VIRTUAL_FROM/.test(tl) && /<VList/.test(tl));
ok('порог не занижен (короткие списки остаются обычными)', /VIRTUAL_FROM = (\d+)/.test(tl) && Number(tl.match(/VIRTUAL_FROM = (\d+)/)[1]) >= 30, tl.match(/VIRTUAL_FROM = (\d+)/)?.[1]);
ok('высота строки берётся из той же таблицы, что и CSS', /DENSITY\[ui\.density\]/.test(tl) && /rowHeight=\{rowHeight\}/.test(tl));
const layout = src('src/lib/uiLayout.js');
for (const [k, v] of [['compact', 40], ['normal', 56], ['cozy', 68]]) {
  const re = new RegExp(`${k}: \\{ row: ${v}`);
  ok(`плотность ${k} = ${v}px (CSS и список меряют одно)`, re.test(layout));
}
ok('строки списка живут на --row-h', /--row-h/.test(layout) && /\.track-row \{ height: var\(--row-h/.test(src('src/styles.css')));

const store = src('src/state/store.js');
ok('история прослушиваний уходит в savePersisted', /savePersisted\(\{ credentials, settings, offlineMeta, searchHistory, playHistory \}\)/.test(store));
ok('persistNow включает playHistory', /const \{[^}]*playHistory[^}]*\} = state;/.test(store));
ok('logout не оставляет чужую историю', /playHistory: \[\],/.test(store));
ok('прослушивание засчитывается не сразу', /MIN_LISTEN_SEC/.test(store));
ok('на «ended» трек тоже попадает в историю', /markPlayed\(\)/.test(store));

const ph = src('src/lib/playHistory.js');
ok('история ограничена сверху', /PLAY_MAX = (\d+)/.test(ph) && Number(ph.match(/PLAY_MAX = (\d+)/)[1]) >= 200, ph.match(/PLAY_MAX = (\d+)/)?.[1]);
ok('дней-фильтров хватает (1 / 7 / 30 / всё)', /withinDays/.test(ph) && /buildDayRows/.test(ph));

const recent = src('src/pages/Recent.jsx');
ok('«Недавнее» — отдельная страница со своим списком', /buildDayRows/.test(recent) && /VList/.test(recent));
ok('роут /recent зарегистрирован', /path="\/recent"/.test(src('src/App.jsx')));
ok('пункт в медиатеке есть', /'\/recent'/.test(src('src/components/Sidebar.jsx')));
ok('в настройках можно отключить память', /rememberPlays/.test(src('src/components/Modals.jsx')));

/* ---------- «N N запросов»: plural() уже включает число ---------- */
const walk = (dir) => fs.readdirSync(path0.join(root, dir), { withFileTypes: true }).flatMap((d) => {
  const rel = `${dir}/${d.name}`;
  return d.isDirectory() ? walk(rel) : (/\.(jsx?|css)$/.test(d.name) ? [rel] : []);
});
const doubled = walk('src').filter((rel) => /\$\{[^}]*\.length\} *\$\{plural\(/.test(readFileSync(path0.join(root, rel), 'utf8')));
eq('нигде не дублируется счётчик перед plural()', doubled, []);
ok('в заголовках дней число берётся из songsWord', !/\{r\.count\} \{songsWord/.test(src('src/pages/Recent.jsx')));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки аудита прошли.');
process.exit(failed ? 1 : 0);
