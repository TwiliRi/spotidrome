/* HTML-страница со списком треков без запуска приложения:
     node tools/test-page-export.mjs
   Проверено: экранирование, обложки (data-URI и заглушка), строки списка,
   нумерация, длительности, самодостаточность файла (ни одной внешней ссылки).
   Выход 1 — если что-то работает неверно. */

import {
  escapeHtml, safeCover, initials, buildPlaylistHtml, pageFileName, collectCovers, htmlSize,
} from '../src/lib/pageExport.js';
import { songsWord } from '../src/lib/util.js';

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
const has = (name, hay, needle) => ok(name, String(hay).includes(needle), `нет «${needle}»`);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const track = (n, extra = {}) => ({
  id: `s${n}`, title: `Трек ${n}`, artist: `Исполнитель ${n}`, album: `Альбом ${n}`, duration: 187, ...extra,
});

/* ---------------- экранирование ---------------- */
eq('escape: амперсанд и кавычки', escapeHtml('A & B <c> "d" \'e\''), 'A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;');
eq('escape: пусто', escapeHtml(null), '');

/* ---------------- обложки ---------------- */
eq('обложка: data-URI пропускаем', safeCover(PNG), PNG);
eq('обложка: ссылку на сервер не пускаем', safeCover('https://example.com/a.png'), '');
eq('обложка: javascript: не пускаем', safeCover('javascript:alert(1)'), '');
eq('обложка: незакодированный svg не пускаем', safeCover('data:image/svg+xml,<svg onload=alert(1)>'), '');
eq('обложка: закодированный svg пускаем (в <img> он безопасен)',
  safeCover('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E'),
  'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E');
eq('заглушка: два слова', initials('Paper Boats'), 'PB');
eq('заглушка: одно слово', initials('Gravity'), 'GR');
eq('заглушка: пусто', initials(''), '♪');

/* ---------------- страница ---------------- */
{
  const html = buildPlaylistHtml([track(1), track(2)], { date: new Date(2026, 8, 13, 10, 30) });
  ok('страница: это целый документ', html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>'));
  has('страница: заголовок', html, '<title>Исключённые треки — Spotidrome</title>');
  has('страница: крупный заголовок в шапке', html, '<h1>Исключённые треки</h1>');
  has('страница: сколько треков', html, `<b>${songsWord(2)}</b>`);
  has('страница: дата', html, 'обновлено 13.09.2026');
  has('страница: названия треков', html, 'Трек 1');
  has('страница: исполнители', html, 'Исполнитель 2');
  has('страница: альбомы', html, 'Альбом 1');
  has('страница: длительность', html, '3:07');
  has('страница: нумерация', html, '<span class="n">1</span>');
  ok('страница: вторая строка — под номером 2', html.includes('<span class="n">2</span>'));
  ok('страница: без обложек — заглушки с инициалами', html.includes('class="art art-ph"') && html.includes('>А1<'));
  ok('страница: общая длительность в шапке', /<b>2 трека<\/b> · 6 мин/.test(html), html.match(/<p class="sub">.*?<\/p>/)?.[0]);
}

{
  const html = buildPlaylistHtml([{ ...track(1), cover: PNG }, { ...track(2), cover: 'http://server/a.png' }]);
  ok('страница: обложка вклеена в файл', html.includes(`<img class="art" src="${PNG}"`));
  eq('страница: чужая ссылка в обложку не попала', (html.match(/src="http/g) || []).length, 0);
  ok('страница: без обложки — заглушка', html.includes('class="art art-ph"'));
}

{
  // названия приходят из тегов: скрипт в названии не должен стать скриптом
  const evil = { id: 'x', title: '<script>alert(1)</script>', artist: '"><img src=x onerror=alert(1)>', album: '', duration: 60 };
  const html = buildPlaylistHtml([evil]);
  ok('страница: скрипт в названии обезврежен',
    html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !html.includes('<script'));
  ok('страница: кавычки в исполнителе не рвут разметку',
    html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img src=x'));
  ok('страница: своих скриптов на странице нет', !/<script/i.test(html));
}

{
  const html = buildPlaylistHtml([]);
  has('страница: пустой список — ноль треков', html, songsWord(0));
  ok('страница: пустой список — строк нет', !html.includes('<li class="row">'));
  has('страница: пустой список — шапка на месте', html, '<h1>Исключённые треки</h1>');
}

{
  // файл должен открываться без интернета: ни ссылок, ни шрифтов, ни скриптов
  const html = buildPlaylistHtml([{ ...track(1), cover: PNG }]);
  eq('самодостаточность: ни одной внешней ссылки', (html.match(/https?:\/\//g) || []).length, 0);
  ok('самодостаточность: адрес сервера в файл не утек', !html.includes('http://') && !html.includes('https://'));
  ok('самодостаточность: нет link/font', !/<link|@import|fonts\.google/i.test(html));
  ok('самодостаточность: нет script', !/<script/i.test(html));
  ok('самодостаточность: стили внутри', html.includes('<style>') && html.includes('</style>'));
  ok('самодостаточность: есть вьюпорт для телефона', html.includes('name="viewport"'));
  ok('размер: страница считается', htmlSize(html) > 1000);
}

/* ---------------- имя файла и обложки ---------------- */
eq('имя файла: латиница и дата',
  pageFileName('disliked', new Date(2026, 8, 13)), 'spotidrome-disliked-2026-09-13.html');
eq('обложки: пустой список — ничего не качаем', (await collectCovers([])).size, 0);
eq('обложки: нет id обложки — ничего не качаем', (await collectCovers([{ id: 'a', title: 'T' }])).size, 0);

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nHTML-страница собирается верно');
process.exit(failed ? 1 : 0);
