import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';

/**
 * Виртуализированный список строк.
 *
 * Нужен для больших библиотек: плейлист на 3–5 тыс. треков целиком в DOM —
 * это десятки тысяч узлов, из-за них тормозила прокрутка и каждое переключение
 * трека. Здесь в DOM живёт только видимая часть строк плюс небольшой запас.
 *
 * items      — плоский массив строк;
 * rowHeight  — число px, «%» или (index, item) => px;
 * renderItem — (item, index, { style, ariaAttributes }) => JSX;
 * fill       — тянуть высоту «до низа окна»: большой список скроллится сам,
 *              страница ради него не прыгает (как в Spotify).
 */

/** Строка: данные приходят через rowProps, поэтому компонент-строки не пересоздаётся. */
function VRow({ index, style, ariaAttributes, items, renderItem }) {
  const item = items[index];
  if (!item) return null;
  return renderItem(item, index, { style, ariaAttributes });
}

/** Высота блока = от его верха до низа видимой области страницы. */
function useFillHeight(boxRef, enabled, remeasureKey) {
  const [h, setH] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = boxRef.current;
    if (!el) return undefined;
    const scroller = el.closest('.scroll') || document.documentElement;
    let last = -1;

    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const bottom = typeof scroller.getBoundingClientRect === 'function'
        ? scroller.getBoundingClientRect().bottom
        : window.innerHeight;
      const next = Math.max(220, Math.round(bottom - top - 8));
      if (Math.abs(next - last) < 2) return;            // защита от петли измерений
      last = next;
      setH(next);
    };

    measure();
    let raf = requestAnimationFrame(measure);            // героя мог сдвинуть шрифт/обложка
    const again = () => { raf = requestAnimationFrame(measure); };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(scroller);
    // страница прокручивается — герой уехал вверх, списку можно занять его место
    scroller.addEventListener('scroll', again, { passive: true });
    // плотность, масштаб и ширина панелей пишутся в атрибуты <html> — заодно
    // пересчитываем высоту, когда интерфейс перестроили
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(measure) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-density', 'data-layout'] });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', again);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [boxRef, enabled, remeasureKey]);

  return h;
}

export default function VList({
  items = [], rowHeight = 56, renderItem, rowKey, className = '',
  height, overscanCount = 6, listRef, onRowsRendered, fill = true, remeasureKey = null,
}) {
  const boxRef = useRef(null);
  const filled = useFillHeight(boxRef, fill && height == null, remeasureKey);
  const px = height != null ? height : (filled || undefined);
  const rowProps = useMemo(() => ({ items, renderItem }), [items, renderItem]);

  return (
    <div
      className="vlist-box"
      ref={boxRef}
      style={px ? { height: `${px}px` } : undefined}
    >
      <List
        rowComponent={VRow}
        rowProps={rowProps}
        rowCount={items.length}
        rowHeight={rowHeight}
        rowKey={rowKey}
        overscanCount={overscanCount}
        onRowsRendered={onRowsRendered}
        listRef={listRef}
        defaultHeight={420}
        className={`vlist ${className}`.trim()}
        style={{ height: '100%' }}
      />
    </div>
  );
}
