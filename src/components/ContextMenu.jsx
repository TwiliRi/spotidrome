import React, { useEffect, useRef, useState } from 'react';
import useStore from '../state/store';

export default function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const setUI = useStore((s) => s.setUI);
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setUI({ contextMenu: null }); };
    const esc = (e) => e.key === 'Escape' && setUI({ contextMenu: null });
    const hide = () => setUI({ contextMenu: null });
    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      window.addEventListener('mousedown', close);
      // при прокрутке меню отъезжает от курсора — закрываем, как в Spotify
      window.addEventListener('scroll', hide, { capture: true });
    };
    const timer = setTimeout(attach, 0);
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(timer);
      if (attached) {
        window.removeEventListener('mousedown', close);
        window.removeEventListener('scroll', hide, { capture: true });
      }
      window.removeEventListener('keydown', esc);
    };
  }, [menu, setUI]);

  useEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 12);
    const y = Math.min(menu.y, window.innerHeight - r.height - 12);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  if (!menu) return null;

  return (
    <div className="ctx" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {menu.items.filter(Boolean).map((it, i) =>
        it.sep ? <div className="sep" key={i} />
          : it.label && it.header ? <div className="sub-label" key={i}>{it.label}</div>
          : (
            <button key={i} onClick={() => { setUI({ contextMenu: null }); it.onClick?.(); }} style={it.danger ? { color: '#f5707a' } : undefined}>
              {it.icon}<span>{it.label}</span>
            </button>
          )
      )}
    </div>
  );
}
