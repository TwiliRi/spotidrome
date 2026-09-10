import { useEffect } from 'react';
import useStore from '../state/store';

/* Элементы, которые сами «едят» пробел/Enter. На них глобальные клавиши молчат,
   иначе пробел по сфокусированной кнопке ещё и глушил воспроизведение. */
const FOCUSABLE = 'button, [role="button"], [role="link"], select, option, a[href], input, textarea, [contenteditable="true"]';
/* Живые окна: у каждого свои Esc и свои ползунки/кнопки. */
const IN_MODAL = '.modal, .ctx, [role="dialog"]';

const inModal = (el) => !!(el && el.closest && el.closest(IN_MODAL));

const isTypingTarget = (t) => {
  const tag = (t?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t?.isContentEditable;
};

export default function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey) return;
      const s = useStore.getState();

      // в полях ввода — только Escape (снять фокус), буквы пишут текст
      if (isTypingTarget(e.target)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      // Esc оставляем самим окнам: у каждого он свой (закрыть, свернуть историю…)
      if (e.key === 'Escape') return;

      const mod = e.ctrlKey || e.metaKey;
      /* Открытое окно настроек/эквалайзера/меню — ничего не включаем и не трогаем,
         кроме Ctrl+B (свернуть медиатеку) и зума: они поле не занимают. */
      const modalOpen = inModal(e.target)
        || s.settingsOpen || s.eqOpen || s.layoutOpen || s.aboutOpen || s.addToOpen || !!s.contextMenu;
      // масштаб и сворачивание медиатеки полезны и из открытого окна
      const zoomKeys = ['=', '+', '-', '_', '0'];
      const sidebarKeys = ['b', 'B', 'и', 'И'];
      const alwaysOk = mod && (zoomKeys.includes(e.key) || sidebarKeys.includes(e.key));
      if (modalOpen && !alwaysOk) return;
      if (!mod && e.target?.closest?.(FOCUSABLE) && (e.key === ' ' || e.key === 'Enter')) return;

      const track = s.current();

      /* масштаб интерфейса: Ctrl/Cmd + «+» / «−» / «0», сворачивание медиатеки: Ctrl+B */
      if (mod) {
        const cur = s.settings.ui?.scale || 1;
        if (e.key === '=' || e.key === '+') { e.preventDefault(); s.setUi({ scale: Math.min(1.6, Math.round((cur + 0.05) * 100) / 100) }); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); s.setUi({ scale: Math.max(0.7, Math.round((cur - 0.05) * 100) / 100) }); return; }
        if (e.key === '0') { e.preventDefault(); s.setUi({ scale: 1 }); return; }
        if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') { e.preventDefault(); s.toggleSidebar(); return; }
        return;                                  // остальные Ctrl/Cmd — не наши
      }

      switch (e.key) {
        case ' ':
          e.preventDefault(); s.togglePlay(); break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) s.next(true); else s.seek(Math.min((s.duration || 0), s.time + 5));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) s.prev(); else s.seek(Math.max(0, s.time - 5));
          break;
        case 'ArrowUp':
          e.preventDefault(); s.setVolume(Math.min(1, s.settings.volume + 0.05)); break;
        case 'ArrowDown':
          e.preventDefault(); s.setVolume(Math.max(0, s.settings.volume - 0.05)); break;
        case 's': case 'S': case 'ы': case 'Ы':
          s.toggleShuffle(); break;
        case 'r': case 'R': case 'к': case 'К':
          if (e.shiftKey) s.rollDice(); else s.cycleRepeat();
          break;
        case 'l': case 'L': case 'д': case 'Д':
          if (track) s.toggleStar(track, 'song'); break;
        case 'f': case 'F': case 'а': case 'А':
          if (track) s.setUI({ nowPlayingOpen: !s.nowPlayingOpen }); break;
        case 'q': case 'Q': case 'й': case 'Й':
          s.setUI({ queueOpen: !s.queueOpen }); break;
        case 'e': case 'E': case 'у': case 'У':
          s.setUI({ eqOpen: !s.eqOpen }); break;
        case 'd': case 'D': case 'в': case 'В':
          s.toggleAutoDj(); break;
        case 'm': case 'M': case 'ь': case 'Ь':
          if (e.shiftKey) s.toggleMini(); else s.toggleMute();
          break;
        case 'x': case 'X': case 'ч': case 'Ч':
          if (track) s.toggleDislike(track); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
