/* Проверка истории поиска (чистая логика, без браузера):
     node tools/test-search-history.mjs
   Выход 1 — если что-то работает неверно. */

import {
  pushHistory, dropHistory, filterHistory, timeAgo, normalizeQuery, HISTORY_MAX, MIN_QUERY,
} from '../src/lib/searchHistory.js';

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

/* --- нормализация --- */
eq('схлопываем пробелы, режем крайние', normalizeQuery('  queen   b   ') , 'queen b');

/* --- добавление --- */
let h = [];
h = pushHistory(h, 'queen');
h = pushHistory(h, 'кино');
eq('новые сверху', h.map((x) => x.q), ['кино', 'queen']);
ok('у записи есть метка времени', typeof h[0].at === 'number' && h[0].at <= Date.now());

h = pushHistory(h, '  QUEEN  ');
eq('повтор поднимается наверх и не дублируется (регистр/пробелы игнорируются)',
  h.map((x) => x.q), ['QUEEN', 'кино']);
ok('у поднятого повтора обновилось время', h[0].at >= h[1].at);
eq('длина не выросла', h.length, 2);

h = pushHistory(h, '');
h = pushHistory(h, '   ');
eq('пустой запрос не попадает в историю', h.length, 2);
h = pushHistory(h, 'a'.repeat(MIN_QUERY - 1));
eq(`короче ${MIN_QUERY} символов не запоминаем`, h.length, 2);

/* --- потолок --- */
let big = [];
for (let i = 0; i < HISTORY_MAX + 7; i++) big = pushHistory(big, `запрос ${i}`);
eq('длина ограничена', big.length, HISTORY_MAX);
eq('старые отсекаются с хвоста', big[0].q, `запрос ${HISTORY_MAX + 6}`);
eq('самый старый — последний оставшийся', big[HISTORY_MAX - 1].q, 'запрос 7');
ok('порядок не сломан', big.map((x) => x.q).join('|').includes('запрос 9|запрос 8|запрос 7'));

/* --- удаление --- */
eq('удаление по тексту (без учёта регистра)', dropHistory(big, 'ЗАПРОС 10').map((x) => x.q).includes('запрос 10'), false);
eq('исходный список не мутируется', big.length, HISTORY_MAX);
eq('удаление несуществующего — список тот же', dropHistory(big, 'нет такого').length, HISTORY_MAX);

/* --- подсказки по вводу --- */
const list = [{ q: 'queen', at: 1 }, { q: 'radio head', at: 2 }, { q: 'queen live', at: 3 }];
eq('фильтр: совпадения первыми, порядок сохранения внутри групп', filterHistory(list, 'quee').map((x) => x.q), ['queen', 'queen live', 'radio head']);
eq('пустое поле показывает всю историю', filterHistory(list, '').length, 3);
eq('если совпадений нет — показываем историю целиком', filterHistory(list, 'zzz').map((x) => x.q), ['queen', 'radio head', 'queen live']);
eq('сломанный список не роняет', filterHistory(null, 'a'), []);

/* --- «сколько назад» --- */
const now = Date.now();
const ago = (sec) => timeAgo(now - sec * 1000, now);
eq('меньше минуты → только что', ago(20), 'только что');
eq('1 минута', ago(60), '1 минуту назад');
eq('2 минуты', ago(120), '2 минуты назад');
eq('5 минут', ago(5 * 60), '5 минут назад');
eq('минут: 11 → минут', ago(11 * 60), '11 минут назад');
eq('1 час', ago(3600), '1 час назад');
eq('2 часа', ago(2 * 3600), '2 часа назад');
eq('5 часов', ago(5 * 3600), '5 часов назад');
eq('вчера', ago(26 * 3600), 'вчера');
eq('позавчера', ago(50 * 3600), 'позавчера');
eq('4 дня', ago(4 * 86400), '4 дня назад');
eq('9 дней → недель', ago(9 * 86400), '1 неделю назад');
eq('3 недели', ago(22 * 86400), '3 недели назад');
eq('2 месяца', ago(70 * 86400), '2 месяца назад');
eq('2 года', ago(750 * 86400), '2 года назад');
eq('без метки — пусто', timeAgo(0, now), '');
eq('метка в будущем — пусто', timeAgo(now + 60000, now), '');

console.log(failed ? `\nпровалено проверок: ${failed}` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
