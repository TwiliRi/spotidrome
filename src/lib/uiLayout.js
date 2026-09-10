import { useEffect } from 'react';
import useStore from '../state/store';
import { DEFAULT_UI } from '../state/store';

const desktop = typeof window !== 'undefined' ? window.desktop : null;

/* Ширина свёрнутой медиатеки — как в Spotify: только обложки */
export const RAIL_W = 76;

export const DENSITY = {
  compact: { row: 40, pad: 6, font: 13, gap: 6 },
  normal: { row: 56, pad: 8, font: 14, gap: 8 },
  cozy: { row: 68, pad: 12, font: 15, gap: 12 },
};

export const clampUi = (patch) => {
  const c = (v, min, max, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  const out = { ...patch };
  if ('scale' in patch) out.scale = c(patch.scale, 0.7, 1.6, 1);
  if ('sidebarW' in patch) out.sidebarW = c(patch.sidebarW, 170, 480, 260);
  if ('rightW' in patch) out.rightW = c(patch.rightW, 260, 560, 340);
  if ('barH' in patch) out.barH = c(patch.barH, 68, 150, 88);
  if ('titleH' in patch) out.titleH = c(patch.titleH, 44, 96, 64);
  if ('cardMin' in patch) out.cardMin = c(patch.cardMin, 120, 300, 170);
  if ('radius' in patch) out.radius = c(patch.radius, 0, 22, 8);
  return out;
};

/** Раскладывает настройки по CSS-переменным и атрибутам <html>. */
export function applyUi(raw) {
  if (typeof document === 'undefined') return;
  const merged = { ...DEFAULT_UI, ...(raw || {}) };
  // значения могли прийти из config.json (его правят руками) или от старой
  // версии — без ограничителей один «radius: 400» делает интерфейс недостижимым
  const ui = { ...merged, ...clampUi(merged) };
  const el = document.documentElement;
  const d = DENSITY[ui.density] || DENSITY.normal;

  const collapsed = !!ui.sidebarCollapsed;
  el.style.setProperty('--sidebar-w', `${collapsed ? RAIL_W : ui.sidebarW}px`);
  el.style.setProperty('--sidebar-full-w', `${ui.sidebarW}px`);
  el.style.setProperty('--rightbar-w', `${ui.rightW}px`);
  el.style.setProperty('--bar-h', `${ui.barH}px`);
  // в десктопе даже «скрытая» панель оставляет полоску 30px — иначе окно
  // без рамки нечем двигать и закрывать
  el.style.setProperty('--titlebar-h', `${ui.showTitlebar ? ui.titleH : (desktop ? 30 : 0)}px`);
  el.style.setProperty('--card-min', `${ui.cardMin}px`);
  el.style.setProperty('--radius', `${ui.radius}px`);
  el.style.setProperty('--radius-lg', `${ui.radius + 4}px`);
  el.style.setProperty('--row-h', `${d.row}px`);
  el.style.setProperty('--row-pad', `${d.pad}px`);
  el.style.setProperty('--list-font', `${d.font}px`);
  el.style.setProperty('--gap', `${d.gap}px`);

  el.dataset.density = ui.density;
  el.dataset.sidebarSide = ui.sidebarSide;
  el.dataset.queueSide = ui.queueSide;
  el.dataset.sidebar = ui.showSidebar ? (collapsed ? 'rail' : 'on') : 'off';
  el.dataset.titlebar = ui.showTitlebar ? 'on' : 'off';

  /* Масштаб. В десктопе — родной зум Chromium (ничего не «плывёт»),
     в браузере — CSS-зум как запасной вариант. */
  const scale = Math.min(1.6, Math.max(0.7, Number(ui.scale) || 1));
  if (desktop?.setZoom) {
    desktop.setZoom(scale);
    el.style.zoom = '';
  } else {
    // CSS-зум растягивает и вьюпортные единицы — компенсируем их своими vh/vw
    el.style.zoom = scale === 1 ? '' : String(scale);
    el.style.setProperty('--vh', scale === 1 ? '1vh' : `calc(1vh / ${scale})`);
    el.style.setProperty('--vw', scale === 1 ? '1vw' : `calc(1vw / ${scale})`);
  }
}

export default function useUiLayout() {
  const ui = useStore((s) => s.settings.ui);
  useEffect(() => { applyUi(ui); }, [ui]);
  useEffect(() => () => { if (typeof document !== 'undefined') document.documentElement.style.zoom = ''; }, []);
  return ui;
}
