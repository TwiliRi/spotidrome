import useStore from '../state/store';
import api from './api.js';

/**
 * Отдаёт состояние плеера в main-процесс: по нему живут кнопки на превью в
 * панели задач (Windows), MPRIS-контролы (Linux), меню в трее и доке.
 *
 * Отправляем только при реальном изменении «слепка» состояния, а прогресс —
 * не чаще раза в секунду, поэтому IPC почти не нагружается.
 */
export function initDesktopMedia() {
  const d = typeof window !== 'undefined' ? window.desktop : null;
  if (!d?.sendPlayerState) return () => {};

  let last = '';

  const snapshot = () => {
    const s = useStore.getState();
    const t = s.current?.() || null;
    const queueLen = s.queue?.length || 0;
    const hasNext = queueLen > 0
      && (s.index < queueLen - 1 || s.repeat === 'all' || !!s.settings?.autodj?.enabled);
    const hasPrev = queueLen > 0 && (s.index > 0 || (s.time || 0) > 3);

    return {
      id: t?.id || null,
      title: t?.title || '',
      artist: t?.artist || '',
      album: t?.album || '',
      playing: !!s.playing,
      hasNext,
      hasPrev,
      liked: !!(t && s.starredIds?.song?.has(t.id)),
      disliked: !!(t && s.dislikedIds?.has(t.id)),
      time: Math.round(s.time || 0),
      duration: Math.round(s.duration || 0),
      coverKey: t ? api.coverKey(t.coverArt || t.albumId, 600) : null,
    };
  };

  const push = () => {
    try {
      const payload = snapshot();
      const sig = JSON.stringify(payload);
      if (sig === last) return;          // время округлено до секунды — шлём ≤1 раз/с
      last = sig;
      d.sendPlayerState(payload);
    } catch { /* IPC недоступен — не мешаем плееру играть */ }
  };

  const unsub = useStore.subscribe(push);
  const timer = setInterval(push, 1000);   // ползёт прогресс на значке
  push();

  return () => { unsub(); clearInterval(timer); };
}
