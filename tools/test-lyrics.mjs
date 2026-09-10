/* Быстрая проверка парсера LRC и матчинга LRCLIB без запуска приложения:
     node tools/test-lyrics.mjs
   Выход с кодом 1 — если что-то из разборов работает неверно. */

import { parseLrc, cleanTitle, cleanArtist, similarity, trackKey, fromLrclib } from '../src/lib/lyrics.js';

let failed = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}\n     получено: ${a}\n     ожидалось: ${b}`); }
};
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${info}`); }
};

/* --- метки времени --- */
const basic = parseLrc(`[ti:Creep]
[ar:Radiohead]
[offset:+500]
[00:19.16] When you were here before
[00:24.06] Couldn't look you in the eye
[00:27.13]
[01:00.300] три цифры = миллисекунды
[02:36] секунды без долей
[00:19.16][00:40.00] две метки в одной строке`);

// 19.16+0.5=19660 | 24.06+0.5=24560 | 27.13+0.5=27630 | 40.00+0.5=40500
// 01:00.300 (три цифры = миллисекунды) → 60800 | 02:36 → 156500
eq('метки отсортированы, offset +500 мс применён',
  basic.map((l) => l.start), [19660, 19660, 24560, 27630, 40500, 60800, 156500]);
eq('текст первой строки', basic[0].text, 'When you were here before');
eq('пустая строка-пауза сохранена', basic.find((l) => l.start === 27630)?.text, '');
eq('служебные теги не попадают в текст', basic.filter((l) => l.text.includes('[')).length, 0);
eq('двойная метка даёт две строки с одним текстом',
  basic.filter((l) => l.text === 'две метки в одной строке').map((l) => l.start), [19660, 40500]);

/* --- расширенный LRC с пословной синхронизацией --- */
const ext = parseLrc('[00:01.20]<00:01.20>Hello<00:01.90> brave<00:02.50> world');
eq('пословные метки → words', ext[0]?.words, [
  { start: 1200, text: 'Hello' },
  { start: 1900, text: 'brave' },
  { start: 2500, text: 'world' },
]);
eq('строка собирается из слов', ext[0]?.text, 'Hello brave world');
eq('старт строки = старт первого слова', ext[0]?.start, 1200);

/* --- чистка названий --- */
eq('cleanTitle', ['Bohemian Rhapsody (Official Video)', 'Creep - 2011 Remaster', 'Свет [Lyrics Video]', 'Song (Live at Wembley)']
  .map(cleanTitle), ['Bohemian Rhapsody', 'Creep', 'Свет', 'Song']);
eq('cleanArtist', ['Queen feat. David Bowie', 'Пользователь vs. Другой', 'AC/DC'].map(cleanArtist),
  ['Queen', 'Пользователь', 'AC/DC']);
eq('название без изменений не теряет буквы', cleanTitle('Yesterday'), 'Yesterday');
ok('ключ кэша стабильен', trackKey({ title: 'Creep (Official Video)', artist: 'Radiohead', duration: 235.4 })
  === trackKey({ title: 'creep', artist: 'RADIOHEAD', duration: 235 }));

/* --- матчинг --- */
ok('похожие тексты похожи', similarity('is this the real life just fantasy', 'Is this the real life?\nIs this just fantasy?') > 0.8);
ok('разные тексты не похожи', similarity('creep weirdo belong here', 'woman doja cat') < 0.2);

/* --- из ответа LRCLIB --- */
const shaped = fromLrclib({
  id: 1, trackName: 'Creep', artistName: 'Radiohead', duration: 236,
  syncedLyrics: '[00:19.16]line one\n[00:24.06]line two',
  plainLyrics: 'line one\nline two',
});
eq('synced приоритетнее plain', { synced: shaped.synced, source: shaped.source, url: shaped.url },
  { synced: true, source: 'lrclib', url: 'https://lrclib.net/track/1' });
eq('plain-only тоже пригоден', fromLrclib({ id: 2, plainLyrics: 'a\nb' }).synced, false);
eq('инструментал помечается', fromLrclib({ id: 3, instrumental: true }).instrumental, true);
ok('пустой ответ → null', fromLrclib({ id: 4, plainLyrics: '   ', syncedLyrics: '' }) === null);
ok('null → null', fromLrclib(null) === null);

console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
