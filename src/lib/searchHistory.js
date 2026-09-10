/* История поиска: чистые функции без React и без доступа к хранилищу.
   Список хранится в настройках клиента как [{ q, at }], свежие сверху. */

export const HISTORY_MAX = 12;      // сколько запросов помнить
export const MIN_QUERY = 2;         // короче — не запоминаем («а», «be» и прочий мусор)

function plural(n, one, few, many) {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few;
  return many;
}

export function normalizeQuery(q) {
  return String(q || '').replace(/\s+/g, ' ').trim();
}

const same = (a, b) => normalizeQuery(a).toLowerCase() === normalizeQuery(b).toLowerCase();

/** Добавить запрос: повторы поднимаются наверх, хвост отрезается. */
export function pushHistory(list, q, max = HISTORY_MAX) {
  const text = normalizeQuery(q);
  if (text.length < MIN_QUERY) return Array.isArray(list) ? list : [];
  const rest = (Array.isArray(list) ? list : []).filter((it) => it && !same(it.q, text));
  return [{ q: text, at: Date.now() }, ...rest].slice(0, Math.max(1, max));
}

/** Убрать один запрос (крестик в подсказке). */
export function dropHistory(list, q) {
  return (Array.isArray(list) ? list : []).filter((it) => it && !same(it.q, q));
}

export function clearHistory() { return []; }

/** Подсказки по введённому тексту: подстрока — в начало, остальное — после. */
export function filterHistory(list, q) {
  const all = (Array.isArray(list) ? list : []).filter((it) => it && it.q);
  const needle = normalizeQuery(q).toLowerCase();
  if (!needle) return all;
  const hit = [], rest = [];
  for (const it of all) (it.q.toLowerCase().includes(needle) ? hit : rest).push(it);
  return [...hit, ...rest];
}

/** «только что», «5 минут назад», «вчера», «3 недели назад» */
export function timeAgo(at, now = Date.now()) {
  const ts = Number(at) || 0;
  if (!ts || ts > now) return '';
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 45) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days === 2) return 'позавчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${plural(weeks, 'неделю', 'недели', 'недель')} назад`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;
  const years = Math.floor(days / 365);
  return `${years} ${plural(years, 'год', 'года', 'лет')} назад`;
}

export default { pushHistory, dropHistory, clearHistory, filterHistory, timeAgo, normalizeQuery, HISTORY_MAX, MIN_QUERY };
