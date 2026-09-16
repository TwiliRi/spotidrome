import React, { useRef, useState } from 'react';
import useStore, { DEFAULT_UI, UI_PRESETS } from '../state/store';
import { clampUi } from '../lib/uiLayout';
import { Close, DragIc, EyeIc, EyeOffIc, Trash } from './Icons';
import { Switch } from './UI';
import { useModalFocus } from '../lib/uiA11y';

/* какие кнопки живут в правой части нижнего плеера */
export const BAR_BUTTONS = [
  { id: 'autodj', label: 'AutoDJ' },
  { id: 'lyrics', label: 'Текст песни' },
  { id: 'queue', label: 'Очередь' },
  { id: 'eq', label: 'Эквалайзер' },
  { id: 'volume', label: 'Громкость' },
  { id: 'mini', label: 'Мини-плеер' },
  { id: 'expand', label: 'Во весь экран' },
  { id: 'layout', label: 'Интерфейс и раскладка' },
];
const LEFT_BUTTONS = [
  { id: 'like', label: 'В любимые' },
  { id: 'dislike', label: 'Больше не играть' },
  { id: 'download', label: 'Скачать' },
];

const DENSITY_LABEL = [
  ['compact', 'Плотно'],
  ['normal', 'Обычно'],
  ['cozy', 'Просторно'],
];

/* --- строчка «подпись + ползунок + значение» --- */
function Range({ label, hint, value, min, max, step = 1, unit = 'px', onChange, format }) {
  return (
    <div className="lay-range">
      <div className="lay-range-top">
        <div>
          <div className="lbl">{label}</div>
          {hint && <div className="hint">{hint}</div>}
        </div>
        <div className="lay-val">{format ? format(value) : `${Math.round(value)}${unit}`}</div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

const Seg = ({ options, value, onChange }) => (
  <div className="seg">
    {options.map(([v, label]) => (
      <button key={v} className={`seg-btn${value === v ? ' on' : ''}`} onClick={() => onChange(v)}>{label}</button>
    ))}
  </div>
);


/* --- список кнопок плеера: порядок мышью + показать/скрыть --- */
function BarButtons({ ui, setUi }) {
  const order = [
    ...(ui.barOrder || []),
    ...BAR_BUTTONS.map((b) => b.id).filter((id) => !(ui.barOrder || []).includes(id)),
  ];
  const hidden = new Set(ui.barHidden || []);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);

  const label = (id) => BAR_BUTTONS.find((b) => b.id === id)?.label || id;

  const move = (from, to) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setUi({ barOrder: next });
  };

  const toggle = (id) => {
    const next = new Set(hidden);
    next.has(id) ? next.delete(id) : next.add(id);
    setUi({ barHidden: [...next] });
  };

  return (
    <div className="lay-list">
      {order.map((id, i) => (
        <div
          key={id}
          className={`lay-item${hidden.has(id) ? ' off' : ''}${over === i ? ' over' : ''}${drag === i ? ' dragging' : ''}`}
          draggable
          onDragStart={() => setDrag(i)}
          onDragOver={(e) => { e.preventDefault(); setOver(i); }}
          onDragLeave={() => setOver((v) => (v === i ? null : v))}
          onDrop={(e) => { e.preventDefault(); move(drag, i); setDrag(null); setOver(null); }}
          onDragEnd={() => { setDrag(null); setOver(null); }}
        >
          <span className="lay-grip" title="Перетащите, чтобы поменять порядок"><DragIc size={14} /></span>
          <span className="lay-name">{label(id)}</span>
          <button className="icon-btn" title="Выше" onClick={() => move(i, i - 1)} disabled={i === 0}>↑</button>
          <button className="icon-btn" title="Ниже" onClick={() => move(i, i + 1)} disabled={i === order.length - 1}>↓</button>
          <button className="icon-btn" title={hidden.has(id) ? 'Показать' : 'Скрыть'} onClick={() => toggle(id)}>
            {hidden.has(id) ? <EyeOffIc size={15} /> : <EyeIc size={15} />}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function LayoutModal() {
  const setUI = useStore((s) => s.setUI);
  const ui = useStore((s) => s.settings.ui);
  const setUiRaw = useStore((s) => s.setUi);
  const resetUi = useStore((s) => s.resetUi);
  const applyUiPreset = useStore((s) => s.applyUiPreset);
  const setUi = (patch) => setUiRaw(clampUi(patch));
  const leftHidden = new Set(ui.leftHidden || []);

  const close = () => setUI({ layoutOpen: false });
  const ref = useRef(null);
  useModalFocus(ref, { onClose: close });      // Esc и Tab внутри окна
  const presetActive = Object.entries(UI_PRESETS).find(([, p]) =>
    Object.entries(p).every(([k, v]) => ui[k] === v))?.[0];

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal lay-modal" ref={ref} tabIndex={-1}>
        <div className="lay-head">
          <div>
            <h3>Интерфейс и раскладка</h3>
            <div className="hint">
              Всё меняется сразу. Границы медиатеки, очереди и нижней панели можно
              просто тянуть мышью прямо в окне, двойной клик по границе — сброс.
            </div>
          </div>
          <button className="icon-btn" onClick={close} title="Закрыть" aria-label="Закрыть"><Close size={14} /></button>
        </div>

        <div className="lay-body">
          <div className="lay-section">
            <div className="lay-title">Готовые наборы</div>
            <div className="seg wide">
              <button className={`seg-btn${presetActive === 'compact' ? ' on' : ''}`} onClick={() => applyUiPreset('compact')}>Компактно</button>
              <button className={`seg-btn${presetActive === 'normal' ? ' on' : ''}`} onClick={() => applyUiPreset('normal')}>Обычно</button>
              <button className={`seg-btn${presetActive === 'large' ? ' on' : ''}`} onClick={() => applyUiPreset('large')}>Крупно</button>
            </div>
          </div>

          <div className="lay-section">
            <div className="lay-title">Масштаб</div>
            <Range
              label="Размер интерфейса"
              hint="Увеличивает вообще всё: шрифты, обложки, кнопки"
              value={ui.scale} min={0.7} max={1.6} step={0.05} onChange={(v) => setUi({ scale: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <div className="lay-zoom-row">
              {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((z) => (
                <button key={z} className={`chip${Math.abs(ui.scale - z) < 0.001 ? ' active' : ''}`} onClick={() => setUi({ scale: z })}>
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
          </div>

          <div className="lay-section">
            <div className="lay-title">Размеры панелей</div>
            <Range label="Ширина медиатеки" value={ui.sidebarW} min={170} max={480} onChange={(v) => setUi({ sidebarW: v })} />
            <Range label="Ширина панели очереди" value={ui.rightW} min={260} max={560} onChange={(v) => setUi({ rightW: v })} />
            <Range label="Высота нижнего плеера" value={ui.barH} min={68} max={150} onChange={(v) => setUi({ barH: v })} />
            <Range label="Высота верхней панели" value={ui.titleH} min={44} max={96} onChange={(v) => setUi({ titleH: v })} />
          </div>

          <div className="lay-section">
            <div className="lay-title">Списки и карточки</div>
            <div className="row">
              <div>
                <div className="lbl">Плотность списков</div>
                <div className="hint">Высота строк и размер текста в таблицах треков</div>
              </div>
              <Seg options={DENSITY_LABEL} value={ui.density} onChange={(v) => setUi({ density: v })} />
            </div>
            <Range label="Размер карточек" hint="Альбомы, плейлисты и исполнители в сетках" value={ui.cardMin} min={120} max={300} onChange={(v) => setUi({ cardMin: v })} />
            <Range label="Скругление углов" value={ui.radius} min={0} max={22} onChange={(v) => setUi({ radius: v })} />
          </div>

          <div className="lay-section">
            <div className="lay-title">Расположение</div>
            <div className="row">
              <div><div className="lbl">Медиатека</div></div>
              <Seg options={[['left', 'Слева'], ['right', 'Справа']]} value={ui.sidebarSide} onChange={(v) => setUi({ sidebarSide: v })} />
            </div>
            <div className="row">
              <div><div className="lbl">Панель очереди</div></div>
              <Seg options={[['left', 'Слева'], ['right', 'Справа']]} value={ui.queueSide} onChange={(v) => setUi({ queueSide: v })} />
            </div>
            <div className="row">
              <div>
                <div className="lbl">Показывать медиатеку</div>
                <div className="hint">Выключите, если нужен максимум места под контент</div>
              </div>
              <Switch on={ui.showSidebar} onClick={() => setUi({ showSidebar: !ui.showSidebar })} label="Показывать медиатеку" />
            </div>
            <div className="row">
              <div>
                <div className="lbl">Медиатека свёрнута</div>
                <div className="hint">
                  Узкая полоса с обложками, как в Spotify. То же самое — по <b>Ctrl + B</b>,
                  кнопкой «‹» в шапке медиатеки или если утянуть её границу до упора
                </div>
              </div>
              <Switch on={ui.sidebarCollapsed} onClick={() => useStore.getState().toggleSidebar()} label="Медиатека свёрнута" />
            </div>
            <div className="row">
              <div>
                <div className="lbl">Показывать верхнюю панель</div>
                <div className="hint">Поиск и навигация сверху</div>
              </div>
              <Switch on={ui.showTitlebar} onClick={() => setUi({ showTitlebar: !ui.showTitlebar })} label="Показывать верхнюю панель" />
            </div>
          </div>

          <div className="lay-section">
            <div className="lay-title">Кнопки нижнего плеера</div>
            <div className="hint" style={{ marginBottom: 10 }}>
              Перетащите за точки, чтобы поменять порядок; глаз — скрыть кнопку.
            </div>
            <BarButtons ui={ui} setUi={setUi} />

            <div className="lay-title" style={{ marginTop: 16 }}>Кнопки рядом с обложкой</div>
            <div className="lay-list">
              {LEFT_BUTTONS.map((b) => (
                <div key={b.id} className={`lay-item${leftHidden.has(b.id) ? ' off' : ''}`}>
                  <span className="lay-name" style={{ marginLeft: 4 }}>{b.label}</span>
                  <button
                    className="icon-btn"
                    title={leftHidden.has(b.id) ? 'Показать' : 'Скрыть'}
                    onClick={() => {
                      const next = new Set(leftHidden);
                      next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                      setUi({ leftHidden: [...next] });
                    }}
                  >
                    {leftHidden.has(b.id) ? <EyeOffIc size={15} /> : <EyeIc size={15} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lay-foot">
          <span className="hint">Настройки сохраняются вместе с остальными — в конфиге приложения.</span>
          <button className="pill-btn danger" onClick={resetUi}><Trash size={13} /> Сбросить всё</button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_UI };
