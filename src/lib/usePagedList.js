import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Автоматическая подгрузка списка страницами.
 *
 * Сервер отдаёт списки порциями (`getAlbumList2`, `getSongsByGenre`, `search3`),
 * и раньше мы брали одну порцию с запасом — у кого фонотека больше, тот видел
 * только её начало. Здесь список растёт сам: сторожевой элемент внизу попадает
 * в поле зрения — догружается следующая страница.
 *
 * Что важно:
 *
 * - **поколения.** У запроса есть номер: пока страница едет, сортировку или
 *   вкладку могли переключить. Ответ с чужим номером выбрасывается, поэтому
 *   в список никогда не попадает то, что относится к прошлому запросу;
 * - **склейка без повторов.** Сервер сортирует по живому полю (свежие альбомы
 *   — по дате), поэтому между двумя запросами в выдачу может вклиниться новая
 *   запись и старая приедет ещё раз. Повторы отбрасываются по id;
 * - **признак конца.** Страница пришла короче запрошенной — это последняя.
 *   Больше запросов не делаем, сколько бы ни крутили список;
 * - **сторож пересоздаётся после каждой страницы**: IntersectionObserver
 *   срабатывает на смену пересечения, а короткая страница может оставить
 *   сторож на виду — тогда следующая подгрузка не началась бы.
 *
 * @param {object}   o
 * @param {Function} o.fetchPage  (offset, size) => Promise<Array|{items}>
 * @param {string}   o.key        меняется — список сбрасывается и грузится заново
 * @param {number}   o.size       сколько записей в странице
 * @param {boolean}  o.enabled    false — не грузим (вкладка не открыта)
 * @returns {{items, loading, error, done, loadMore, reload, sentinelRef}}
 */
export default function usePagedList({
  fetchPage, key, size = 40, enabled = true, rootMargin = '800px',
} = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const gen = useRef(0);            // поколение запросов: чужие ответы игнорируем
  const busy = useRef(false);       // идёт запрос — второй не стартуем
  const offset = useRef(0);
  const ids = useRef(new Set());
  const loaded = useRef(false);     // для этого ключа уже грузили
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const sentinelRef = useRef(null);

  const loadMore = useCallback(async () => {
    if (busy.current || done) return;
    const my = gen.current;
    busy.current = true;
    setLoading(true);
    try {
      const page = await fetchRef.current(offset.current, size);
      if (my !== gen.current) return;                 // ключ успели сменить
      const list = Array.isArray(page) ? page : (page?.items || []);
      const fresh = [];
      for (const it of list) {
        const id = it?.id != null ? String(it.id) : null;
        if (!id || ids.current.has(id)) continue;     // уже видели — не дублируем
        ids.current.add(id);
        fresh.push(it);
      }
      offset.current += list.length;
      if (fresh.length) setItems((prev) => [...prev, ...fresh]);
      if (list.length < size) setDone(true);          // короткая страница — последняя
      setError(null);
    } catch (e) {
      if (my === gen.current) setError(e);
    } finally {
      busy.current = false;
      if (my === gen.current) setLoading(false);
    }
  }, [size, done]);

  // смена ключа: старые ответы больше никого не интересуют
  useEffect(() => { loaded.current = false; }, [key]);

  useEffect(() => {
    if (!enabled || loaded.current) return;
    loaded.current = true;
    gen.current += 1;
    busy.current = false;
    offset.current = 0;
    ids.current = new Set();
    setItems([]);
    setDone(false);
    setError(null);
    setLoading(true);
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, loadMore]);

  const reload = useCallback(() => {
    gen.current += 1;
    busy.current = false;
    offset.current = 0;
    ids.current = new Set();
    setItems([]);
    setDone(false);
    setError(null);
    setLoading(true);
    loadMore();
  }, [loadMore]);

  /* Сторож: как только он показался в пределах rootMargin — тянем следующую
     страницу. Пересоздаём наблюдатель после каждой порции (см. выше). */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled || done) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, enabled, done, rootMargin, items.length]);

  return { items, loading, error, done, loadMore, reload, sentinelRef };
}
