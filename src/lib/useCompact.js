import { useEffect, useState } from 'react';
import useStore from '../state/store';

const desktop = typeof window !== 'undefined' ? window.desktop : null;

/*
  Компактные раскладки.

  Окно можно ужимать сколько угодно (в Electron минимум 248×96) — интерфейс
  сам решает, что показывать:

    full  — обычное приложение: медиатека, страницы, плеер снизу
    mini  — «карточка»: большая обложка, название, прогресс и кнопки
    nano  — «полоска»: маленькая обложка, название бегущей строкой и три кнопки

  Пороги подобраны так, чтобы обычное окно (даже ужатое до 1040×640) осталось
  обычным, а сознательно уменьшенное — превратилось в плеер.
*/
export const MINI_W = 760;   // уже этого по ширине — компактный режим
export const MINI_H = 560;   // ниже этого по высоте — тоже
export const NANO_H = 260;   // ниже — раскладка «полоска»
export const NANO_W = 246;   // уже — тоже полоска (минимум окна в Electron 248)

export function layoutFor(w, h) {
  if (w >= MINI_W && h >= MINI_H) return 'full';
  // «полоску» включает низкое окно; узкое, но высокое остаётся карточкой
  if (h < NANO_H || w < NANO_W) return 'nano';
  // широкое и приплюснутое окно тоже удобнее полоской, чем карточкой
  if (h < 360 && w > h * 1.6) return 'nano';
  return 'mini';
}

const size = () => ({
  w: typeof window === 'undefined' ? 1440 : window.innerWidth,
  h: typeof window === 'undefined' ? 900 : window.innerHeight,
});

export default function useCompact() {
  const [s, setS] = useState(size);
  // При родном зуме Chromium innerWidth уменьшается — но окно-то не изменилось,
  // поэтому для выбора мини-раскладки возвращаемся к «физическому» размеру окна.
  const scale = useStore((st) => st.settings.ui?.scale) || 1;
  const k = desktop ? scale : 1;

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setS(size()));
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, []);

  const layout = layoutFor(s.w * k, s.h * k);
  return { ...s, layout, compact: layout !== 'full', nano: layout === 'nano' };
}
