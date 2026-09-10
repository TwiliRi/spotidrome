import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import Splitter from './Splitter';
import ArtistLinks from './ArtistLinks';
import { Cover } from './UI';
import { Close, Trash, Play, RadioIc, Plus } from './Icons';
import { AUTODJ_MODES, modeName } from '../lib/autodj';

function AutoDjPanel() {
  const settings = useStore((s) => s.settings);
  const setAutoDj = useStore((s) => s.setAutoDj);
  const toggleAutoDj = useStore((s) => s.toggleAutoDj);
  const autoDjRefill = useStore((s) => s.autoDjRefill);
  const autodjBusy = useStore((s) => s.autodjBusy);
  const dj = settings.autodj || {};
  const [open, setOpen] = useState(false);

  return (
    <div className={`dj-panel${dj.enabled ? ' on' : ''}`}>
      <div className="dj-head">
        <button className="dj-title" onClick={() => setOpen((v) => !v)} title="Настройки AutoDJ">
          <RadioIc size={14} />
          <span>AutoDJ</span>
          {dj.enabled && <span className="dj-badge">{modeName(dj.mode)}</span>}
        </button>
        <div className={`switch${dj.enabled ? ' on' : ''}`} onClick={toggleAutoDj} role="switch" aria-checked={!!dj.enabled}><i /></div>
      </div>

      <div className="dj-sub">
        {dj.enabled
          ? (autodjBusy ? 'Подбираю треки…' : `Очередь продолжается сама · держу ${dj.buffer} впереди`)
          : 'Когда очередь кончается — клиент сам добавит похожее'}
      </div>

      {(open || dj.enabled) && (
        <>
          <div className="dj-modes">
            {AUTODJ_MODES.map((m) => (
              <button
                key={m.id}
                className={`dj-chip${dj.mode === m.id ? ' on' : ''}`}
                title={m.hint}
                onClick={() => setAutoDj({ mode: m.id, enabled: true }, false)}
              >
                {m.name}
              </button>
            ))}
          </div>

          <div className="dj-row">
            <span className="muted">Треков впереди</span>
            <div className="dj-steps">
              {[3, 5, 10, 20].map((n) => (
                <button key={n} className={`dj-chip sm${dj.buffer === n ? ' on' : ''}`} onClick={() => setAutoDj({ buffer: n })}>{n}</button>
              ))}
            </div>
          </div>

          <div className="dj-row">
            <span className="muted">Не повторять недавнее</span>
            <div className={`switch sm${dj.noRepeat ? ' on' : ''}`} onClick={() => setAutoDj({ noRepeat: !dj.noRepeat })}><i /></div>
          </div>

          <button className="dj-more" disabled={autodjBusy} onClick={() => autoDjRefill('more')}>
            <Plus size={12} /> {autodjBusy ? 'Подбираю…' : 'Добавить сейчас'}
          </button>
        </>
      )}
    </div>
  );
}

export default function RightPanel() {
  const nav = useNavigate();
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const jumpTo = useStore((s) => s.jumpTo);
  const setUI = useStore((s) => s.setUI);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const moveInQueue = useStore((s) => s.moveInQueue);
  const clearQueue = useStore((s) => s.clearQueue);
  const context = useStore((s) => s.context);
  const [drag, setDrag] = useState(null);
  const qSide = useStore((s) => s.settings.ui.queueSide);
  const cur = index >= 0 ? queue[index] : null;
  const upcoming = queue.slice(index + 1);

  return (
    <aside className="rightbar">
      <Splitter
        axis="x" field="rightW" min={260} max={560} dflt={340}
        dir={qSide === 'left' ? 1 : -1}
        className={qSide === 'left' ? 'on-right' : 'on-left'}
        title="Ширина панели очереди: потяните мышью"
      />
      <div className="rb-head">
        <span>Очередь</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {queue.length > 0 && <button className="icon-btn" title="Очистить" onClick={clearQueue}><Trash size={14} /></button>}
          <button className="icon-btn" onClick={() => setUI({ queueOpen: false })}><Close size={14} /></button>
        </div>
      </div>

      <div className="rb-body">
        <AutoDjPanel />

        {!cur && <div className="muted" style={{ padding: 16 }}>Очередь пуста. Включите что-нибудь 🎧</div>}

        {cur && (
          <>
            <Cover id={cur.coverArt || cur.albumId} size={500} alt={cur.album} className="rb-art" />
            <div style={{ padding: '0 8px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em' }}>{cur.title}</div>
              <ArtistLinks item={cur} className="muted" style={{ marginTop: 4 }} />
            </div>

            <div className="rb-section-title">Сейчас играет</div>
            <div className="q-row cur">
              <Cover id={cur.coverArt || cur.albumId} size={80} alt="" />
              <div className="m"><div className="n">{cur.title}</div><div className="s">{cur.artist}</div></div>
              {cur._dj && <span className="dj-tag" title={`Подобрано AutoDJ · ${modeName(cur._dj)}`}><RadioIc size={9} /></span>}
            </div>

            <div className="rb-section-title">
              Далее{context?.name ? `: из «${context.name}»` : ''}
            </div>
            {upcoming.length === 0 && <div className="muted" style={{ padding: '4px 8px', fontSize: 13 }}>Больше ничего в очереди</div>}
            {upcoming.map((t, i) => {
              const realIndex = index + 1 + i;
              return (
                <div
                  key={`${t.id}-${realIndex}`}
                  className={`q-row${t._dj ? ' dj' : ''}`}
                  draggable
                  onDragStart={() => setDrag(realIndex)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (drag != null) moveInQueue(drag, realIndex); setDrag(null); }}
                  onDoubleClick={() => jumpTo(realIndex)}
                >
                  <Cover id={t.coverArt || t.albumId} size={80} alt="" />
                  <div className="m">
                    <div className="n">{t.title}</div>
                    <div className="s">{t.artist}</div>
                  </div>
                  {t._dj && <span className="dj-tag" title={`Подобрано AutoDJ · ${modeName(t._dj)}`}><RadioIc size={9} /></span>}
                  <button className="icon-btn" title="Играть" onClick={() => jumpTo(realIndex)}><Play size={12} /></button>
                  <button className="icon-btn" title="Убрать" onClick={() => removeFromQueue(realIndex)}><Close size={12} /></button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
