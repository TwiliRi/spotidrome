/* Проверки html-страницы одного трека (без браузера):
     node tools/test-track-page.mjs
   Смотрим разметку, экранирование, вклейку звука и обложки, самодостаточность. */

import {
  slug, trackPageName, shade, demoAudio, buildTrackPageHtml,
} from '../src/lib/trackPage.js';

let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info ? `→ ${info}` : ''}`); }
};
const eq = (name, got, want) => ok(name, got === want, `получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`);
const has = (name, hay, needle) => ok(name, hay.includes(needle), `нет ${JSON.stringify(needle).slice(0, 60)}`);

const TRACK = {
  id: 's1', title: 'Города', artist: 'Гравитация', album: 'Небо', year: 2019,
  duration: 214, coverArt: 'al-1',
};

/* ---------------- имя файла ---------------- */
eq('slug: кириллица в латиницу', slug('Гравитация'), 'gravitatsiya');
eq('slug: пробелы и мусор', slug('Neon Kassette!! (live)'), 'neon-kassette-live');
eq('slug: пусто', slug(''), '');
eq('slug: только символы', slug('???'), '');
ok('slug: режет по длине', slug('очень длинное название трека которое не влезет в имя файла', 12).length <= 12);
ok('имя файла: латиница + дата',
  /^spotidrome-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/.test(trackPageName(TRACK, new Date(2026, 8, 13))),
  trackPageName(TRACK, new Date(2026, 8, 13)));
ok('имя файла: без кириллицы', !/[а-яё]/i.test(trackPageName(TRACK)));
eq('имя файла: трек без тегов всё равно называется', trackPageName({}, new Date(2026, 8, 13)), 'spotidrome-track-2026-09-13.html');

/* ---------------- цвет шапки ---------------- */
eq('shade: темнее', shade('#808080', 0.5), '#404040');
eq('shade: светлее', shade('#000000', 2), '#ffffff');
eq('shade: мусор → запасной цвет', shade('не цвет', 1), '#2f2f2f');
ok('shade: короткая запись цвета', shade('#abc', 1).length === 7);

/* ---------------- звук-заглушка для демо ---------------- */
const tone = demoAudio(1);
eq('демозвук: wav', tone.mime, 'audio/wav');
ok('демозвук: это base64', /^[A-Za-z0-9+/=]+$/.test(tone.b64));
const wav = Buffer.from(tone.b64, 'base64');
eq('демозвук: RIFF', wav.subarray(0, 4).toString('ascii'), 'RIFF');
eq('демозвук: WAVE', wav.subarray(8, 12).toString('ascii'), 'WAVE');
ok('демозвук: длина как у wav 8 кГц', wav.length === 44 + 8000 * 2, `${wav.length}`);

/* ---------------- страница ---------------- */
const audio = { mime: 'audio/mpeg', b64: 'AAAA' };
const lyrics = { synced: true, lines: [{ start: 0, text: 'первая' }, { start: 1500, text: 'вторая' }, { start: null, text: '' }] };

const html = buildTrackPageHtml(TRACK, { cover: 'data:image/png;base64,iVBORw0KGgo=', audio, lyrics, accent: '#7a1f2b', date: new Date(2026, 8, 13) });

ok('страница: целый документ', html.startsWith('<!doctype html>') && html.trimEnd().endsWith('</html>'));
has('страница: заголовок окна', html, '<title>Города — Гравитация · Spotidrome</title>');
has('страница: название трека', html, '<h1>Города</h1>');
has('страница: исполнитель', html, '<b>Гравитация</b>');
has('страница: альбом и год', html, 'Гравитация</b> · Небо · 2019 · 3:34');
has('страница: надпись «Трек»', html, '<div class="kind">Трек</div>');
has('страница: обложка вклеена', html, '<img alt="" src="data:image/png;base64,iVBORw0KGgo=">');
has('страница: звук вклеен', html, `<audio id="audio" controls preload="metadata" src="data:audio/mpeg;base64,AAAA">`);
has('страница: есть свой плеер', html, '<div class="playrow" id="playrow">');
has('страница: подсказка про встроенный звук', html, 'Звук встроен в файл');

has('текст: строка с таймкодом', html, '<p class="l" data-t="1.50">вторая</p>');
ok('текст: пустая строка выброшена', !html.includes('data-t=""'));
has('текст: блок помечен как синхронный', html, '<section class="lyrics synced">');

/* обложки нет — рисуем заглушку с инициалами */
const noCover = buildTrackPageHtml(TRACK, { audio });
has('без обложки: заглушка', noCover, '<div class="art-ph">');
ok('без обложки: внешней ссылки на картинку нет', !/src="https?:/.test(noCover));

/* текста нет — не молчим */
const noLyrics = buildTrackPageHtml(TRACK, { audio });
has('без текста: понятная надпись', noLyrics, 'Текст песни не найден.');
ok('без текста: блок не синхронный', !noLyrics.includes('lyrics synced'));

/* текста нет, но он не синхронный — просто колонка */
const plain = buildTrackPageHtml(TRACK, { audio, lyrics: { synced: false, lines: [{ start: null, text: 'просто слова' }] } });
has('обычный текст: без таймкодов', plain, '<p class="l plain">просто слова</p>');
ok('обычный текст: data-t не нужен', !plain.includes('data-t='));

/* звук не выкачался — страница всё равно полезна */
const noAudio = buildTrackPageHtml(TRACK, { lyrics });
ok('без звука: тега audio нет', !noAudio.includes('<audio'));
has('без звука: честно пишем про это', noAudio, 'Звук в файл не попал');
ok('без звука: плеер не рисуем', !noAudio.includes('id="playrow"'));

/* ---------------- громкость ---------------- */
has('громкость: ползунок в плеере', html, 'id="vbar"');
has('громкость: кнопка «без звука»', html, 'class="vol-btn" id="mute"');
eq('громкость: по умолчанию 10 процентов', /aria-valuenow="(\d+)"/.exec(html)?.[1], '10');
has('громкость: заливка сразу на 10%', html, 'id="vfill" style="width:10%"');
ok('громкость: в скрипте та же цифра', /var vol = Math\.max\(0, Math\.min\(1, 10 \/ 100\)\)/.test(html));
ok('громкость: ползунок доступен с клавиатуры', /id="vbar" role="slider" tabindex="0"/.test(html));
ok('громкость: можно вытянуть и перетаскиванием', html.includes('pointerdown') && html.includes('pointermove'));
ok('громкость: стрелки двигают на 5 процентов', html.includes('0.05'));
ok('громкость: печатать страницу ползунок не мешает', /@media print[\s\S]*\.playrow, audio \{ display: none/.test(html));
ok('без звука: громкость не рисуем', !noAudio.includes('id="vbar"'));

const loud = buildTrackPageHtml(TRACK, { audio, volume: 65 });
eq('громкость: своё значение тоже принимаем', /aria-valuenow="(\d+)"/.exec(loud)?.[1], '65');
const silent = buildTrackPageHtml(TRACK, { audio, volume: 0 });
eq('громкость: ноль — это тишина, а не 10', /aria-valuenow="(\d+)"/.exec(silent)?.[1], '0');
const junk = buildTrackPageHtml(TRACK, { audio, volume: 'много' });
eq('громкость: чушь в настройке → 0, а не NaN', /aria-valuenow="(\d+)"/.exec(junk)?.[1], '0');

/* градиент шапки берём из обложки, как в Spotify */
const dark = buildTrackPageHtml(TRACK, { audio, accent: '#1db954' });
ok('шапка: градиент из цвета обложки', /linear-gradient\(180deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)/.test(dark),
  dark.match(/linear-gradient\([^)]*\)/)?.[0] || '');
ok('шапка: цвет действительно из обложки', dark.includes(shade('#1db954', 1.05)) && dark.includes(shade('#1db954', 0.35, 14)));

/* ---------------- безопасность ---------------- */
const evil = buildTrackPageHtml(
  { ...TRACK, title: '</h1><script>alert(1)</script>', artist: '"><img src=x onerror=alert(1)>', album: '<b>жирный</b>' },
  { audio, cover: 'https://злой.пример/картинка.png', lyrics: { synced: true, lines: [{ start: 0, text: '<script>alert(2)</script>' }] } },
);
has('опасное название: только текст', evil, '&lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
ok('опасное название: тега не появилось', !evil.includes('<script>alert(1)'));
has('опасный исполнитель: кавычки закрыты', evil, '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
ok('опасный исполнитель: img не ожил', !evil.includes('<img src=x'));
ok('опасная обложка: чужая ссылка выброшена', !evil.includes('https://злой.пример'));
has('опасная обложка: заглушка вместо неё', evil, '<div class="art-ph">');
ok('опасный текст: в разметке он текстом', evil.includes('&lt;script&gt;alert(2)&lt;/script&gt;') && !evil.includes('<script>alert(2)'));

/* ---------------- самодостаточность ---------------- */
const full = buildTrackPageHtml(TRACK, { cover: 'data:image/png;base64,iVBORw0KGgo=', audio, lyrics, date: new Date(2026, 8, 13) });
eq('самодостаточность: ни одной внешней ссылки', (full.match(/https?:\/\//g) || []).length, 0);
ok('самодостаточность: нет link', !/<link/i.test(full));
ok('самодостаточность: нет @import', !/@import/i.test(full));
ok('самодостаточность: нет чужих шрифтов', !/fonts\.|@font-face/i.test(full));
eq('самодостаточность: ровно один встроенный скрипт', (full.match(/<script/g) || []).length, 1);
ok('самодостаточность: скрипт без src', !/<script[^>]+src=/i.test(full));
ok('самодостаточность: стили внутри', /<style>[\s\S]*body\s*\{/.test(full));
has('самодостаточность: есть вьюпорт', full, 'name="viewport"');
has('страница: подвал с датой', full, 'Страница собрана в Spotidrome');
ok('страница: печать не испортит вид', full.includes('@media print'));

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nСтраница трека собирается верно');
process.exit(failed ? 1 : 0);
