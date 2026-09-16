/* Мелочи доступности интерфейса, которые нужны в нескольких местах сразу:
   ловушка фокуса в модальных окнах и превращение «клик по тексту» в настоящую
   ссылку (с клавиатуры она тоже должна работать). */

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Держим фокус внутри открытого окна: Tab ходит по кругу, Esc закрывает,
 * при открытии фокус уходит в окно, при закрытии — возвращается туда, откуда
 * окно открыли. Без этого Tab проваливается в интерфейс под затемнением,
 * а после закрытия фокус остаётся неизвестно где.
 *
 * @param {object} ref       ref на корень окна (ему нужен tabIndex={-1})
 * @param {object} opts      { onClose, autoFocus }
 */
export function useModalFocus(ref, { onClose, autoFocus = true, open = true } = {}) {
  /* onClose держим в ref: иначе из-за новой стрелки на каждый рендер эффект
     перезапускался бы constantly, снимая и вешая слушатель заново. А это прямо
     ломало Esc: пока браузер раздаёт событие, снятый слушатель уже не зовётся —
     окно, открывшееся первым, переставало закрываться по Esc. */
  const close = useRef(onClose);
  close.current = onClose;
  const back = useRef(null);

  useEffect(() => {
    const node = open ? ref.current : null;
    if (!node) return undefined;

    back.current = document.activeElement;
    /* фокусируем само окно, а не первую кнопку: иначе пробел или Enter
       сразу нажимали бы её (в настройках это была кнопка «закрыть») */
    if (autoFocus) {
      const first = node.querySelector('[data-autofocus]');
      (first || node).focus?.();
    }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current?.(); return; }
      if (e.key !== 'Tab') return;
      const items = [].slice.call(node.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetWidth || el.offsetHeight || el === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!node.contains(active)) { (e.shiftKey ? last : first).focus(); e.preventDefault(); return; }
      if (e.shiftKey && active === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && active === last) { first.focus(); e.preventDefault(); }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const el = back.current;
      if (el && document.contains(el)) el.focus?.();
    };
  }, [ref, open, autoFocus]);
}

/**
 * Пропсы для «текста, по которому можно щёлкнуть»: в разметке это остаётся
 * текстом, но становится ссылкой — попасть можно и с клавиатуры.
 * @param {Function} onActivate
 * @param {boolean} active  false, когда кликать некуда (курсор обычный)
 */
export const linkProps = (onActivate, active = true) => (active ? {
  role: 'link',
  tabIndex: 0,
  onClick: (e) => { e.stopPropagation(); onActivate(); },
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onActivate(); }
  },
} : {});
