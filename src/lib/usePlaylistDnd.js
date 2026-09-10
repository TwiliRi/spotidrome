import { useState } from 'react';
import useStore from '../state/store';

/**
 * Перетаскивание плейлистов мышью.
 *
 * Порядок плейлистов хранится локально (settings.playlistOrder): Navidrome
 * отдаёт их своим чередом, а Subsonic API не умеет переставлять плейлисты на
 * сервере. Закреплённые строки переставляются внутри своей группы — там
 * порядок задают закрепления (settings.pins).
 *
 * axis: 'y' — списком (медиатека слева), 'x' — сеткой карточек (медиатека
 * страницей). Возвращает готовые обработчики строки: dndProps(it) и dndClass(it),
 * где it = { id, group }.
 */
export default function usePlaylistDnd({ axis = 'y' } = {}) {
  const movePlaylist = useStore((s) => s.movePlaylist);
  const [drag, setDrag] = useState(null);          // { id, group }
  const [dropAt, setDropAt] = useState(null);      // { id, before } — куда упадёт

  /** Закреплённые переставляются в своём списке — порядке закреплений. */
  const reorderPins = (fromId, toId, before) => {
    const st = useStore.getState();
    const fromKey = `playlist:${fromId}`;
    const pins = (st.settings.pins || []).filter((k) => k !== fromKey);
    const at = pins.indexOf(`playlist:${toId}`);
    pins.splice(at < 0 ? pins.length : (before ? at : at + 1), 0, fromKey);
    st.updateSettings({ pins });
  };

  /** Верхняя (или левая) половина строки — «поставить перед», нижняя — «после». */
  const isBefore = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return axis === 'x'
      ? (e.clientX - r.left) < (r.width / 2)
      : (e.clientY - r.top) < (r.height / 2);
  };

  const dndProps = (it) => {
    if (!it || it.kind !== 'playlist') return {};   // альбомы и исполнители не переставляем
    return {
      draggable: true,
      onDragStart: (e) => {
        setDrag({ id: it.id, group: it.group });
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(it.id)); } catch { /* старый Electron — и так сработает */ }
      },
      onDragEnd: () => { setDrag(null); setDropAt(null); },
      onDragOver: (e) => {
        // кидать можно только внутри своей группы: свои к своим, общие к общим
        if (!drag || !it.group || drag.group !== it.group || String(drag.id) === String(it.id)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const before = isBefore(e);
        setDropAt((s) => (s && String(s.id) === String(it.id) && s.before === before ? s : { id: it.id, before }));
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDropAt((s) => (s && String(s.id) === String(it.id) ? null : s));
      },
      onDrop: (e) => {
        e.preventDefault();
        const before = dropAt && String(dropAt.id) === String(it.id) ? dropAt.before : isBefore(e);
        let fromId = drag?.id;
        if (fromId == null) { try { fromId = e.dataTransfer.getData('text/plain'); } catch { fromId = null; } }
        setDrag(null); setDropAt(null);
        if (fromId == null || String(fromId) === String(it.id)) return;
        if (it.group === 'pinned') reorderPins(fromId, it.id, before);
        else movePlaylist(fromId, it.id, before);
      },
    };
  };

  /** Классы строки во время перетаскивания: источник гасим, цель подсвечиваем. */
  const dndClass = (it) => {
    if (!it) return '';
    const cls = [];
    if (drag && String(drag.id) === String(it.id)) cls.push('dragging');
    if (dropAt && String(dropAt.id) === String(it.id) && drag && String(drag.id) !== String(it.id)) {
      cls.push(dropAt.before ? 'drop-before' : 'drop-after');
    }
    return cls.join(' ');
  };

  return { drag, dropAt, dndProps, dndClass };
}
