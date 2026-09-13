/**
 * Передача обложки из анимации броска в полноэкранный плеер.
 *
 * Все четыре сцены (кубик, пластинка, космос, чёрная дыра) заканчиваются
 * одинаково: обложка выпавшего трека перелетает со своего места в сцене точно
 * в обложку плеера — элемент как будто один и тот же (shared element).
 *
 * Логика вынесена сюда не ради краткости, а потому что её легко сломать,
 * не заметив: картинку нужно **поставить** в точку старта (`left/top/width/
 * height`), а не только посчитать ей сдвиг. Без этого она остаётся там, где
 * её положил поток — в левом верхнем углу оверлея и в своём натуральном
 * размере, — и улетает не в плеер, а за край экрана влево-вверх.
 *
 * Все прямоугольники — в координатах окна (`getBoundingClientRect`), потому
 * что оверлей `position: fixed` и его система отсчёта та же.
 */

/** Поставить картинку в точку старта. false — прямоугольник непригоден. */
export function placeFly(el, from) {
  if (!el || !from) return false;
  const w = from.w ?? from.width;
  const h = from.h ?? from.height;
  const x = from.x ?? from.left ?? 0;
  const y = from.y ?? from.top ?? 0;
  if (!w || !h || !isFinite(w) || !isFinite(h) || !isFinite(x) || !isFinite(y)) return false;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  return true;
}

/**
 * Перелёт обложки в обложку плеера.
 *
 * @param {HTMLElement} el    картинка, которая летит (уже в DOM)
 * @param {object}      from  { x, y, w, h } — откуда (место обложки в сцене)
 * @param {DOMRect}     to    куда (`.np2-cover`); DOMRect или такой же объект
 * @param {object}      opts  { fromRadius, midRadius, toRadius, duration, easing }
 * @returns {Animation|null}  null — лететь некуда: плеер не нашли или
 *                            стартовый прямоугольник пришёл пустой
 */
export function flyToPlayer(el, from, to, opts = {}) {
  const {
    fromRadius = '4%',
    midRadius = '8%',
    toRadius = '14px',
    duration = 660,
    easing = 'cubic-bezier(.22,1,.28,1)',
  } = opts || {};

  if (!el || !to) return null;
  if (!placeFly(el, from)) return null;

  // `from` бывает и нашим объектом {x,y,w,h}, и DOMRect — сводим к одному виду
  const fw = from.w ?? from.width;
  const fh = from.h ?? from.height;
  const toW = to.width ?? to.w;
  const toH = to.height ?? to.h;
  if (!fw || !fh || !toW || !toH) return null;

  // масштаб — по ширине: обложка квадратная и в сцене, и в плеере
  const scale = toW / fw;
  const dx = (to.left + toW / 2) - (from.x + fw / 2);
  const dy = (to.top + toH / 2) - (from.y + fh / 2);

  const head = { transform: 'translate(0px, 0px) scale(1)', borderRadius: fromRadius };
  const tail = { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: toRadius };
  const frames = midRadius == null
    ? [head, tail]
    : [head, {
      transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${(1 + scale) / 2})`,
      borderRadius: midRadius,
      offset: 0.5,
    }, tail];

  return el.animate(frames, { duration, easing, fill: 'forwards' });
}
