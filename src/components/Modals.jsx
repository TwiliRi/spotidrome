import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import { AUTODJ_MODES } from '../lib/autodj';
import { EQ_FREQS, EQ_PRESETS } from '../lib/audio';
import { Close, Trash, Download } from './Icons';
import { bytes, plural, songsWord } from '../lib/util';
import { Switch } from './UI';
import { useModalFocus } from '../lib/uiA11y';
import api from '../lib/api';
import { collectAllTracks, tracksToText, dumpFileName } from '../lib/trackDump';
import { saveTextFile } from '../lib/saveFile';
import { coverCacheStats, clearCoverCache } from '../lib/covers';
import { lrclibStats, clearLyricsCache } from '../lib/lyrics';

const LYR_OFFSETS = [-3, -2, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 2, 3];

function Modal({ title, onClose, children, width }) {
  const ref = useRef(null);
  // Esc, ловушка фокуса и возврат фокуса на кнопку, которой окно открыли
  useModalFocus(ref, { onClose });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={ref} tabIndex={-1} style={width ? { width } : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginBottom: 18 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose} title="Закрыть" aria-label="Закрыть"><Close size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EqualizerModal() {
  const { settings, setEq, setUI } = useStore();
  const eq = settings.eq;

  const setBand = (i, v) => {
    const bands = [...eq.bands];
    bands[i] = v;
    setEq({ bands, preset: 'Свой' });
  };

  return (
    <Modal title="Эквалайзер" onClose={() => setUI({ eqOpen: false })} width={640}>
      <div className="row">
        <div>
          <div className="lbl">Включить эквалайзер</div>
          <div className="hint">10 полос + предусиление, обрабатывается через Web Audio</div>
        </div>
        <Switch on={eq.enabled} onClick={() => setEq({ enabled: !eq.enabled })} label="Включить эквалайзер" />
      </div>

      <div style={{ opacity: eq.enabled ? 1 : .45, pointerEvents: eq.enabled ? 'auto' : 'none' }}>
        <div className="eq-grid">
          {EQ_FREQS.map((f, i) => (
            <div className="eq-band" key={f}>
              <div className="v">{eq.bands[i] > 0 ? '+' : ''}{Math.round(eq.bands[i])}</div>
              <input
                type="range" min={-12} max={12} step={1} value={eq.bands[i]}
                onChange={(e) => setBand(i, Number(e.target.value))}
              />
              <div className="f">{f >= 1000 ? `${f / 1000}k` : f}</div>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div className="lbl">Предусиление</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, maxWidth: 280 }}>
            <input
              type="range" min={-12} max={12} step={1} value={eq.preamp} style={{ flex: 1 }}
              onChange={(e) => setEq({ preamp: Number(e.target.value) })}
            />
            <span className="muted" style={{ width: 46, textAlign: 'right' }}>{eq.preamp > 0 ? '+' : ''}{eq.preamp} дБ</span>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <div className="lbl" style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Пресеты</div>
          <div className="preset-row">
            {Object.entries(EQ_PRESETS).map(([name, bands]) => (
              <button
                key={name}
                className={`chip${eq.preset === name ? ' active' : ''}`}
                onClick={() => setEq({ bands: [...bands], preset: name })}
              >{name}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function SettingsModal() {
  const {
    settings, updateSettings, setUI, credentials, serverInfo, offline, clearDownloads, logout,
    musicFolders, setMusicFolder, setAutoDj, searchHistory, clearSearchHistory, playHistory, clearPlayHistory,
  } = useStore();
  const nav = useNavigate();
  const dislikedCount = useStore((st) => st.dislikedIds.size);
  const bannedCount = useStore((st) => (st.settings.bannedArtists || []).length);
  const dj = settings.autodj || {};
  const [coverCache, setCoverCache] = React.useState(null);
  const [lyrics, setLyrics] = React.useState(null);
  const off = Number(settings.lyricsOffset) || 0;
  useEffect(() => { coverCacheStats().then(setCoverCache); }, []);
  // счётчики LRCLIB живые: обновляем, пока окно открыто
  useEffect(() => {
    setLyrics(lrclibStats());
    const t = setInterval(() => setLyrics(lrclibStats()), 3000);
    return () => clearInterval(t);
  }, []);
  const forgetLyrics = () => {
    clearLyricsCache();
    setLyrics(lrclibStats());
    useStore.getState().toast('Кэш текстов очищен — при следующем открытии тексты будут найдены заново', 'info');
  };

  /* Выгрузка списка треков. Сбор идёт альбом за альбомом (Subsonic не умеет
     отдать все треки разом), поэтому тут и счётчик, и возможность отменить. */
  const [dump, setDump] = React.useState({ busy: false });
  const dumpAlive = React.useRef(false);
  useEffect(() => () => { dumpAlive.current = false; }, []);

  const exportTracks = async () => {
    if (dump.busy) return;
    dumpAlive.current = true;
    setDump({ busy: true, albums: 0, done: 0, tracks: 0 });
    try {
      const { songs, stopped } = await collectAllTracks(api, {
        alive: () => dumpAlive.current,
        onProgress: (p) => setDump((d) => (d.busy ? { ...d, ...p } : d)),
      });
      if (stopped) {
        useStore.getState().toast('Выгрузка остановлена', 'info');
        setDump({ busy: false });
        return;
      }
      if (!songs.length) {
        useStore.getState().toast('В фонотеке не нашлось треков', 'info');
        setDump({ busy: false });
        return;
      }
      const creds = useStore.getState().credentials;
      const server = creds?.demo ? 'демо-режим' : (creds?.url || '');
      const file = dumpFileName();
      const saved = await saveTextFile(file, tracksToText(songs, { server }), { ext: 'txt', title: 'Сохранить список треков' });
      if (saved.canceled) { setDump({ busy: false }); return; }
      useStore.getState().toast(
        `Выгружено ${plural(songs.length, 'трек', 'трека', 'треков')}: ${saved.path || file}`, 'success');
      setDump({ busy: false, result: songs.length, file: saved.path || file });
    } catch (e) {
      useStore.getState().toast(`Не получилось выгрузить список: ${e?.message || e}`, 'error');
      setDump({ busy: false });
    }
  };
  const total = useMemo(() => Object.values(offline).reduce((s, x) => s + (x.size || 0), 0), [offline]);

  return (
    <Modal title="Настройки" onClose={() => setUI({ settingsOpen: false })}>
      <div className="row">
        <div>
          <div className="lbl">Сервер</div>
          <div className="hint">{credentials?.demo ? 'Демо-режим (локальные данные)' : credentials?.url}</div>
        </div>
        <span className="badge gray">{serverInfo?.type || 'navidrome'} {serverInfo?.serverVersion || ''}</span>
      </div>

      <div className="row stack">
        <div>
          <div className="lbl">Анимация случайного трека</div>
          <div className="hint">Что показывать при броске «случайный трек»</div>
        </div>
        <div className="seg">
          {[['vinyl', 'Пластинка'], ['dice', 'Кубик'], ['cosmos', 'Космос 3D'], ['blackhole', 'Чёрная дыра'], ['off', 'Без анимации']].map(([v, t]) => (
            <button
              key={v}
              className={`seg-btn${(settings.rollAnim || 'vinyl') === v ? ' on' : ''}`}
              onClick={() => updateSettings({ rollAnim: v })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Кэш обложек</div>
          <div className="hint">
            {coverCache
              ? `${coverCache.count} файлов · ${bytes(coverCache.bytes)} · без ограничения размера`
              : 'считаю…'}
          </div>
        </div>
        <button
          className="pill-btn"
          onClick={async () => { await clearCoverCache(); setCoverCache(await coverCacheStats()); }}
        >
          Очистить
        </button>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Музыкальная папка</div>
          <div className="hint">
            {musicFolders.length > 1
              ? 'Ограничить библиотеку одной папкой Navidrome (musicFolderId)'
              : 'На сервере настроена одна музыкальная папка'}
          </div>
        </div>
        <select
          value={settings.musicFolderId ?? ''}
          onChange={(e) => setMusicFolder(e.target.value || null)}
          disabled={musicFolders.length < 2}
        >
          <option value="">Все папки</option>
          {musicFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Список треков</div>
          <div className="hint">
            {dump.busy
              ? `Собираю: ${dump.done} из ${dump.albums} альбомов · ${plural(dump.tracks || 0, 'трек', 'трека', 'треков')}`
              : dump.result
                ? `Готово: ${plural(dump.result, 'трек', 'трека', 'треков')}${dump.file ? ` · ${dump.file}` : ''}`
                : 'Имена всех треков фонотеки в одном текстовом файле — «Исполнитель — Название»'}
          </div>
        </div>
        {dump.busy ? (
          <button className="pill-btn" onClick={() => { dumpAlive.current = false; }}>Отмена</button>
        ) : (
          <button className="pill-btn" onClick={exportTracks}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Download size={13} /> Выгрузить в .txt</span>
          </button>
        )}
      </div>

      <div className="row">
        <div>
          <div className="lbl">AutoDJ</div>
          <div className="hint">Бесконечная очередь: клиент дописывает похожие треки (клавиша D)</div>
        </div>
        <Switch on={dj.enabled} onClick={() => useStore.getState().toggleAutoDj()} label="AutoDJ" />
      </div>

      <div className="row">
        <div>
          <div className="lbl">Режим подбора</div>
          <div className="hint">{AUTODJ_MODES.find((m) => m.id === dj.mode)?.hint || ''}</div>
        </div>
        <select value={dj.mode || 'mix'} onChange={(e) => setAutoDj({ mode: e.target.value })}>
          {AUTODJ_MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Треков впереди</div>
          <div className="hint">Сколько подобранных треков держать в хвосте очереди</div>
        </div>
        <select value={dj.buffer || 5} onChange={(e) => setAutoDj({ buffer: Number(e.target.value) })}>
          {[3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Скробблинг</div>
          <div className="hint">Отправлять прослушивания в Navidrome (и дальше в Last.fm / ListenBrainz)</div>
        </div>
        <Switch on={settings.scrobble} onClick={() => updateSettings({ scrobble: !settings.scrobble })} label="Скробблинг" />
      </div>

      <div className="row">
        <div>
          <div className="lbl">История поиска</div>
          <div className="hint">
            {searchHistory.length
              ? `${plural(searchHistory.length, 'запрос', 'запроса', 'запросов')} — подсказки под полем поиска и на странице «Поиск»`
              : 'пока пусто: сохранённые запросы появятся под полем поиска'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch on={settings.rememberSearch !== false} onClick={() => updateSettings({ rememberSearch: settings.rememberSearch === false })} label="Запоминать запросы" />
          {!!searchHistory.length && (
            <button className="pill-btn" onClick={() => { clearSearchHistory(); useStore.getState().toast('История поиска очищена', 'info'); }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Trash size={13} /> Очистить</span>
            </button>
          )}
        </div>
      </div>

      <div className="row">
        <div>
          <div className="lbl">История прослушиваний</div>
          <div className="hint">
            {playHistory.length
              ? `${plural(playHistory.length, 'запись', 'записи', 'записей')} на экране «Недавнее» — хранится на этом устройстве`
              : 'пока пусто: трек попадает туда, когда играл около 20 секунд'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch on={settings.rememberPlays !== false} onClick={() => updateSettings({ rememberPlays: settings.rememberPlays === false })} label="Запоминать прослушанное" />
          {!!playHistory.length && (
            <button className="pill-btn" onClick={() => { clearPlayHistory(); useStore.getState().toast('История прослушиваний очищена', 'info'); }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Trash size={13} /> Очистить</span>
            </button>
          )}
        </div>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Тексты: база LRCLIB</div>
          <div className="hint">
            Если на сервере текста нет или он без таймкодов — брать синхронный текст из открытой базы lrclib.net
            {lyrics ? ` · запросов ${lyrics.sent}, найдено ${lyrics.hits}` : ''}
          </div>
        </div>
        <Switch on={settings.lrclib !== false} onClick={() => updateSettings({ lrclib: settings.lrclib === false })} label="Тексты: база LRCLIB" />
      </div>

      <div className="row">
        <div>
          <div className="lbl">Готовить тексты заранее</div>
          <div className="hint">Пока играет трек, в фоне подтягивать тексты для следующих треков очереди</div>
        </div>
        <Switch on={settings.lyricsPrefetch !== false} onClick={() => updateSettings({ lyricsPrefetch: settings.lyricsPrefetch === false })} label="Готовить тексты заранее" />
      </div>

      <div className="row">
        <div>
          <div className="lbl">Поправка синхронизации</div>
          <div className="hint">
            {off
              ? `${off > 0 ? '+' : ''}${off.toFixed(1)} с: строки подсвечиваются позже. Тонко — в полноэкранном плеере`
              : 'строки идут ровно по таймкодам; тонкая подстройка — в полноэкранном плеере'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={String(off)} onChange={(e) => updateSettings({ lyricsOffset: Number(e.target.value) })}>
            {LYR_OFFSETS.map((v) => <option key={v} value={String(v)}>{v > 0 ? `+${v}` : v} с</option>)}
          </select>
          <button className="pill-btn" onClick={forgetLyrics}><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Trash size={13} /> Кэш</span></button>
        </div>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Качество потока</div>
          <div className="hint">Транскодирование на стороне сервера</div>
        </div>
        <select value={settings.maxBitRate} onChange={(e) => updateSettings({ maxBitRate: Number(e.target.value) })}>
          <option value={0}>Оригинал</option>
          <option value={320}>320 кбит/с</option>
          <option value={256}>256 кбит/с</option>
          <option value={192}>192 кбит/с</option>
          <option value={128}>128 кбит/с</option>
          <option value={96}>96 кбит/с</option>
        </select>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Формат</div>
          <div className="hint">raw — без перекодирования</div>
        </div>
        <select value={settings.format} onChange={(e) => updateSettings({ format: e.target.value })}>
          <option value="raw">raw</option>
          <option value="mp3">mp3</option>
          <option value="opus">opus</option>
          <option value="aac">aac</option>
        </select>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Визуализатор</div>
          <div className="hint">Спектр на полноэкранном плеере</div>
        </div>
        <Switch on={settings.showVisualizer} onClick={() => updateSettings({ showVisualizer: !settings.showVisualizer })} label="Визуализатор" />
      </div>

      <div className="row">
        <div>
          <div className="lbl">Интерфейс и раскладка</div>
          <div className="hint">
            Масштаб {Math.round((settings.ui?.scale || 1) * 100)}% • панели, плотность списков,
            расположение и состав кнопок
          </div>
        </div>
        <button className="pill-btn" onClick={() => setUI({ settingsOpen: false, layoutOpen: true })}>Настроить</button>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Исключённые треки</div>
          <div className="hint">
            {dislikedCount ? `${dislikedCount} шт. — не попадают в списки, радио и AutoDJ` : 'Дизлайк («палец вниз» или клавиша X) убирает трек из подборок'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch on={settings.hideDisliked} onClick={() => updateSettings({ hideDisliked: !settings.hideDisliked })} label="Скрывать исключённые треки" />
          <button className="pill-btn" onClick={() => { setUI({ settingsOpen: false }); nav('/disliked'); }}>Список</button>
        </div>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Заблокированные исполнители</div>
          <div className="hint">
            {bannedCount
              ? `${bannedCount} — не звучат в AutoDJ, радио и случайном выборе`
              : 'Блокируется в меню трека или на странице исполнителя'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch on={settings.hideBanned !== false} onClick={() => updateSettings({ hideBanned: !(settings.hideBanned !== false) })} label="Скрывать их треки" />
          <button className="pill-btn" onClick={() => { setUI({ settingsOpen: false }); nav('/disliked?tab=artists'); }}>Список</button>
        </div>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Офлайн-кэш</div>
          <div className="hint">{songsWord(Object.keys(offline).length)} • {bytes(total)}</div>
        </div>
        <button className="pill-btn" onClick={clearDownloads}><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Trash size={13} /> Очистить</span></button>
      </div>

      <div className="row">
        <div>
          <div className="lbl">Аккаунт</div>
          <div className="hint">{credentials?.username}</div>
        </div>
        <button className="pill-btn" onClick={() => { setUI({ settingsOpen: false }); logout(); }}>Выйти</button>
      </div>
    </Modal>
  );
}

export function AboutModal() {
  const { setUI } = useStore();
  const [taskbar, setTaskbar] = React.useState(null);
  useEffect(() => {
    window.desktop?.taskbarStatus?.().then(setTaskbar).catch(() => {});
    const t = setInterval(() => window.desktop?.taskbarStatus?.().then(setTaskbar).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, []);
  const keys = [
    ['Пробел', 'Играть / пауза'],
    ['→ / ←', 'Перемотка ±5 с'],
    ['Shift + → / ←', 'Следующий / предыдущий трек'],
    ['↑ / ↓', 'Громкость'],
    ['S / R', 'Перемешивание / повтор'],
    ['L', 'В любимые'],
    ['X', 'Больше не играть'],
    ['Shift + M', 'Мини-плеер'],
    ['Ctrl + B', 'Свернуть/развернуть медиатеку'],
    ['Ctrl + + / − / 0', 'Масштаб интерфейса'],
    ['F', 'Полноэкранный плеер'],
    ['Q', 'Очередь'],
    ['E', 'Эквалайзер'],
    ['/', 'Поиск'],
  ];
  return (
    <Modal title="Spotidrome" onClose={() => setUI({ aboutOpen: false })}>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
        Десктоп-клиент для Navidrome в стиле Spotify. Работает через Subsonic/OpenSubsonic API:
        библиотека, плейлисты, любимое, синхронные тексты, скробблинг, эквалайзер и офлайн-загрузки.
      </p>
      {taskbar && (
        <>
          <div className="rb-section-title" style={{ margin: '8px 0' }}>Управление снаружи окна</div>
          <div className="row">
            <div>
              <div className="lbl">Кнопки на превью в панели задач</div>
              <div className="hint">
                {taskbar.supported
                  ? (taskbar.ok
                    ? 'Работают: наведите курсор на значок приложения — любимые, «больше не играть», перемотка и пауза'
                    : (taskbar.started
                      ? `Система пока не приняла кнопки (попыток: ${taskbar.tries})`
                      : 'Появятся после первого показа окна'))
                  : 'Только в Windows; здесь работают трей и MPRIS'}
              </div>
            </div>
            <span className={`badge ${taskbar.supported ? (taskbar.ok ? 'green' : 'gray') : 'gray'}`}>
              {taskbar.supported ? (taskbar.ok ? 'включены' : 'ждём') : taskbar.platform}
            </span>
          </div>
          <div className="row">
            <div><div className="lbl">Значок в трее</div></div>
            <span className={`badge ${taskbar.tray ? 'green' : 'gray'}`}>{taskbar.tray ? 'есть' : 'нет'}</span>
          </div>
          {taskbar.platform === 'linux' && (
            <div className="row">
              <div><div className="lbl">MPRIS (D-Bus)</div></div>
              <span className={`badge ${taskbar.mpris ? 'green' : 'gray'}`}>{taskbar.mpris ? 'работает' : 'нет'}</span>
            </div>
          )}
        </>
      )}

      <div className="rb-section-title" style={{ margin: '8px 0' }}>Горячие клавиши</div>
      {keys.map(([k, v]) => (
        <div className="row" key={k}>
          <div className="lbl">{v}</div>
          <span className="badge gray" style={{ fontSize: 11, padding: '4px 8px' }}>{k}</span>
        </div>
      ))}
    </Modal>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => { t.action.onClick?.(); useStore.getState().closeToast(t.id); }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
