import React from 'react';
import useStore from '../state/store';
import { Play, Pause } from './Icons';

/* Тонкая контекстная панель внутри страницы: при прокрутке проявляется
   заголовок текущей страницы и компактная кнопка воспроизведения. */
export default function TopBar({ scrolled, heroColor, title }) {
  const pagePlay = useStore((s) => s.pagePlay);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);

  const bg = scrolled
    ? (heroColor ? `color-mix(in srgb, ${heroColor} 62%, #121212)` : '#121212')
    : 'transparent';

  return (
    <div className="topbar" style={{ background: bg }}>
      <div
        className="topbar-title"
        style={{ opacity: scrolled ? 1 : 0, transform: scrolled ? 'none' : 'translateY(6px)', transition: 'opacity .22s, transform .22s', pointerEvents: scrolled ? 'auto' : 'none' }}
      >
        {pagePlay && (
          <button
            className="topbar-play"
            title={playing ? 'Пауза' : 'Слушать'}
            onClick={() => (playing ? togglePlay() : pagePlay())}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
        )}
        <span className="topbar-h1">{title}</span>
      </div>
      <div className="spacer" />
    </div>
  );
}
