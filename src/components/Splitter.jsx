import React, { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../state/store';
import { clampUi } from '../lib/uiLayout';

/**
 * Полоска между панелями: тянешь мышью — панель меняет размер.
 * Двойной клик возвращает значение по умолчанию.
 *
 *  axis      'x' — двигаем ширину, 'y' — высоту
 *  dir        1  — размер растёт вправо/вниз, -1 — влево/вверх
 *  collapse  { at, isCollapsed, onCollapse } — «залипание» в свёрнутое
 *            состояние, когда панель утянули уже некуда (как в Spotify)
 */
export default function Splitter({
  axis = 'x', field, min, max, dir = 1, dflt, className = '', title, collapse = null,
}) {
  const setUi = useStore((s) => s.setUi);
  const [drag, setDrag] = useState(false);
  const start = useRef(null);
  const self = useRef(null);

  const apply = useCallback((v) => {
    // ниже порога панель не сжимается, а сворачивается в полосу
    if (collapse) {
      if (v < collapse.at) {
        if (!collapse.isCollapsed) collapse.onCollapse(true);
        return;
      }
      if (collapse.isCollapsed) collapse.onCollapse(false);
    }
    setUi(clampUi({ [field]: Math.round(Math.min(max, Math.max(min, v))) }));
  }, [field, min, max, setUi, collapse]);

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const s = start.current;
      const delta = (axis === 'x' ? e.clientX - s.x : e.clientY - s.y) * dir;
      apply(s.value + delta);
    };
    const up = () => setDrag(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-x', 'resizing-y');
    };
  }, [drag, axis, dir, apply]);

  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // отсчитываем от реального размера панели: так работает и из свёрнутого вида
    const box = self.current?.parentElement?.getBoundingClientRect();
    const value = box ? (axis === 'x' ? box.width : box.height) : 0;
    start.current = { x: e.clientX, y: e.clientY, value };
    setDrag(true);
  };

  const reset = () => {
    collapse?.onCollapse(false);
    setUi(clampUi({ [field]: dflt }));
  };

  return (
    <div
      ref={self}
      className={`splitter ${axis} ${className}${drag ? ' active' : ''}`.trim()}
      onPointerDown={down}
      onDoubleClick={reset}
      title={title || 'Потяните, чтобы изменить размер (двойной клик — по умолчанию)'}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    >
      <i />
    </div>
  );
}
