import { create } from 'zustand';
import api, { normalizeServerUrl } from '../lib/api';
import engine from '../lib/audio';
import { pickAutoDj, modeName } from '../lib/autodj';
import { pushHistory, dropHistory, normalizeQuery, HISTORY_MAX, MIN_QUERY } from '../lib/searchHistory';
import { pushPlay, dropPlay, sanitizePlays, MIN_LISTEN_SEC } from '../lib/playHistory.js';
import { prefetchCovers, resolveCover } from '../lib/covers';
import { songsWord } from '../lib/util';

const desktop = typeof window !== 'undefined' ? window.desktop : null;

/* Текущий маршрут. Его ставит App на каждый рендер — до рендера страниц, так
   что страницы, проставляющие заголовок в своём эффекте, попадают уже в новый
   адрес. Нужен, чтобы заголовок прошлой страницы не всплывал в шапке новой. */
let routeNow = '';
export function setRouteNow(path) { routeNow = path || ''; }

let persistTimer = null;
const lyricsWarmed = new Set();   // треки, тексты для которых уже подготавливали

/* ---------- раскладка интерфейса ----------
   Всё, что можно подвинуть, растянуть, спрятать или увеличить.
   Меняется в «Настройки → Интерфейс и раскладка» и мышью прямо в окне. */
export const DEFAULT_UI = {
  scale: 1,                 // масштаб всего интерфейса, 0.75…1.6
  sidebarW: 260,            // ширина медиатеки слева
  rightW: 340,              // ширина панели очереди
  barH: 88,                 // высота нижнего плеера
  titleH: 64,               // высота верхней панели
  cardMin: 170,             // минимальная ширина карточки в сетках
  radius: 8,                // скругления
  density: 'normal',        // плотность списков: compact | normal | cozy
  sidebarSide: 'left',      // медиатека слева или справа
  queueSide: 'right',       // очередь слева или справа
  showSidebar: true,
  sidebarCollapsed: false,  // медиатека свёрнута в узкую полосу с обложками
  showTitlebar: true,
  // правая группа кнопок нижнего плеера: порядок и что скрыто
  barOrder: ['autodj', 'lyrics', 'queue', 'eq', 'volume', 'mini', 'expand'],
  barHidden: [],
  // кнопки рядом с обложкой в нижнем плеере
  leftHidden: [],
};

export const UI_PRESETS = {
  compact: { scale: 0.9, sidebarW: 220, rightW: 300, barH: 76, titleH: 56, cardMin: 150, radius: 6, density: 'compact' },
  normal: { scale: 1, sidebarW: 260, rightW: 340, barH: 88, titleH: 64, cardMin: 170, radius: 8, density: 'normal' },
  large: { scale: 1.15, sidebarW: 300, rightW: 380, barH: 100, titleH: 72, cardMin: 200, radius: 12, density: 'cozy' },
};

const DEFAULT_SETTINGS = {
  volume: 0.8,
  muted: false,
  scrobble: true,
  maxBitRate: 0,
  format: 'raw',
  eq: { enabled: false, preset: 'Плоский', preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  musicFolderId: null,
  autodj: { enabled: false, mode: 'mix', buffer: 5, noRepeat: true },
  showVisualizer: true,
  hideDisliked: true,       // прятать исключённые треки в списках и подборках
  rollAnim: 'vinyl',        // анимация случайного трека: 'vinyl' | 'dice' | 'off'
  pins: [],                 // закреплённое в медиатеке: ['playlist:12', 'album:7', …]
  playlistOrder: [],        // свой порядок плейлистов в медиатеке: ['pl-id', …] (перетаскиванием)
  rememberSearch: true,     // запоминать поисковые запросы (история под полем поиска)
  rememberPlays: true,      // запоминать, что играли (экран «Недавнее»)
  // тексты: если на сервере их нет (или они без таймкодов) — берём синхронный текст из LRCLIB
  lrclib: true,             // искать недостающие тексты на lrclib.net
  lyricsPrefetch: true,     // подготавливать тексты для следующих треков очереди
  lyricsOffset: 0,          // ручная поправка синхронизации текста, сек (−30…+30)
  ui: DEFAULT_UI,           // размеры, плотность и расположение элементов интерфейса
};

/** эквалайзер из config.json: 10 полос, числа в допустимом диапазоне */
const clampDb = (v) => Math.max(-12, Math.min(12, Number(v) || 0));
function normalizeEq(eq) {
  const bands = Array.isArray(eq?.bands) ? eq.bands.slice(0, 10).map(clampDb) : [];
  while (bands.length < 10) bands.push(0);
  return { ...DEFAULT_SETTINGS.eq, ...(eq || {}), bands, preamp: clampDb(eq?.preamp), enabled: !!eq?.enabled };
}

async function loadPersisted() {
  if (desktop) return (await desktop.getConfig()) || {};
  try { return JSON.parse(localStorage.getItem('spotidrome') || '{}'); } catch { return {}; }
}
async function loadDislikes() {
  if (desktop?.dislikesGet) return (await desktop.dislikesGet()) || [];
  try { return JSON.parse(localStorage.getItem('spotidrome-dislikes') || '[]'); } catch { return []; }
}
async function saveDislikes(list) {
  if (desktop?.dislikesSet) return desktop.dislikesSet(list);
  try { localStorage.setItem('spotidrome-dislikes', JSON.stringify(list)); } catch {}
  return true;
}

/* история поиска в сохранённом виде приходит из config/localStorage —
   её мог записать другой клиент, поэтому чистим перед использованием */
const sanitizeHistory = (raw) => (Array.isArray(raw) ? raw : [])
  .map((it) => ({ q: normalizeQuery(it?.q), at: Number(it?.at) || 0 }))
  .filter((it) => it.q.length >= MIN_QUERY)
  .slice(0, HISTORY_MAX);

/* одним махом пишем всё, что переживает перезапуск: доступ, настройки,
   офлайн-список и историю поиска */
function persistNow(state) {
  clearTimeout(persistTimer);
  const { credentials, settings, offlineMeta, searchHistory, playHistory } = state;
  return savePersisted({ credentials, settings, offlineMeta, searchHistory, playHistory });
}

async function savePersisted(obj) {
  if (desktop) return desktop.setConfig(obj);
  try { localStorage.setItem('spotidrome', JSON.stringify(obj)); } catch {}
}

const shuffled = (arr, keepIndex) => {
  const a = arr.map((x, i) => ({ x, i }));
  const head = keepIndex != null ? a.splice(keepIndex, 1) : [];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return [...head, ...a].map((o) => o.x);
};

export /**
 * Тайминги броска кубика (мс). Вращение при этом не ограничено сверху:
 * фаза spin/balance длится ровно столько, сколько идёт запрос к серверу.
 */
/** «Ставим пластинку»: падение винила, раскрутка, тонарм, наезд на этикетку */
const VINYL = {
  intro: 700,              // пластинка падает на диск вертушки
  minSpin: 1400,
  balanceAfter: 2600,      // долгая загрузка → тонарм «ищет дорожку»
  settle: 900,             // тонарм опускается, игла касается
  settleFromBalance: 1000,
  camera: 900,             // наезд камеры на этикетку
  reveal: 300,             // этикетка → обложка
  hold: 320,
  expand: 800,
};

const DICE = {
  intro: 520,              // 1. кубик прилетел, лёгкий idle
  minSpin: 1200,           // минимум вращения, чтобы бросок не «моргал»
  balanceAfter: 2600,      // 3. долгая загрузка → баланс на ребре
  settle: 700,             // 4. торможение + overshoot
  settleFromBalance: 1160, // возврат с ребра + торможение
  camera: 950,             // 5. облёт камеры на вид сверху
  reveal: 280,             // проявление обложки на верхней грани
  hold: 260,               // пауза на результат
  expand: 780,             // 6. перелёт обложки в плеер
};

const useStore = create((set, get) => ({
  /* ---------- boot / auth ---------- */
  booted: false,
  connected: false,
  connecting: false,
  authError: '',
  credentials: null,
  serverInfo: null,

  settings: DEFAULT_SETTINGS,
  offline: {},
  offlineMeta: {},

  /* ---------- player ---------- */
  queue: [],
  queueSource: [],
  index: -1,
  playing: false,
  buffering: false,
  time: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  context: null,
  autodjBusy: false,
  djSeen: [],
  randomBusy: false,
  dice: null,          // { phase: 'roll'|'reveal'|'expand', origin, track }

  /* ---------- library caches ---------- */
  musicFolders: [],
  libraryVersion: 0,
  playlists: [],
  starredIds: { song: new Set(), album: new Set(), artist: new Set() },

  /* ---------- история поиска ---------- */
  searchHistory: [],            // [{ q, at }] — недавние запросы, свежие сверху

  /* ---------- история прослушиваний ---------- */
  playHistory: [],              // [{ id, title, …, at }] — свежие сверху

  /* ---------- исключённые («дизлайкнутые») треки ---------- */
  dislikes: {},                 // id → { id, title, artist, album, albumId, artistId, at }
  dislikedIds: new Set(),
  dislikesPath: '',

  /* ---------- ui ---------- */
  toasts: [],
  nowPlayingOpen: false,
  pagePlay: null,           // «играть страницу» в шапке: ставит сама страница
  pageTitle: '',            // заголовок в шапке при прокрутке
  heroColor: '#121212',     // цвет героя — им подсвечивается шапка
  pageRoute: '',            // маршрут, которому принадлежат эти три значения
  queueOpen: false,
  eqOpen: false,
  layoutOpen: false,
  contextMenu: null,
  addToOpen: null,          // { ids: [id…], title } — окно «Добавить в плейлист»
  // мини-плеер: в десктопе окно физически ужимается, в браузере показываем
  // плавающую карточку поверх интерфейса
  miniForced: false,
  miniPos: null,

  toast(text, kind = 'info', action = null) {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? 6000 : 3200);
  },
  closeToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },

  async boot() {
    const cfg = await loadPersisted();
    const settings = {
      ...DEFAULT_SETTINGS, ...(cfg.settings || {}),
      eq: normalizeEq(cfg.settings?.eq),
      autodj: { ...DEFAULT_SETTINGS.autodj, ...(cfg.settings?.autodj || {}) },
      ui: { ...DEFAULT_UI, ...(cfg.settings?.ui || {}) },
    };
    api.setMusicFolder(settings.musicFolderId ?? null);
    set({
      settings,
      booted: true,
      credentials: cfg.credentials || null,
      offlineMeta: cfg.offlineMeta || {},
      searchHistory: sanitizeHistory(cfg.searchHistory),
      playHistory: sanitizePlays(cfg.playHistory),
    });
    engine.init();
    engine.setVolume(settings.muted ? 0 : settings.volume);
    get().wireEngine();
    if (desktop?.onMediaKey) {
      desktop.onMediaKey((action) => {
        const st = get();
        if (action === 'playpause') st.togglePlay();
        else if (action === 'next') st.next(true);
        else if (action === 'prev') st.prev();
        else if (action === 'stop') st.pause();
        else if (action === 'like') { const t = st.current(); if (t) st.toggleStar(t, 'song'); }
        else if (action === 'dislike') { const t = st.current(); if (t) st.toggleDislike(t); }
      });
    }
    await get().loadDislikes();
    await get().refreshOffline();
    if (cfg.credentials) await get().connect(cfg.credentials, true);
    get().wirePersistFlush();
  },

  /* «Сохранить на диск» отложено на 350 мс; если окно закрыли раньше, последние
     изменения (громкость, эквалайзер, история поиска) пропадали */
  wirePersistFlush() {
    if (typeof window === 'undefined' || get()._flushWired) return;
    set({ _flushWired: true });
    const flush = () => { persistNow(get()); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  },

  wireEngine() {
    if (get()._wired) return;
    set({ _wired: true });
    engine.on((type, payload) => {
      const st = get();
      if (type === 'time') {
        set({ time: payload });
        const cur = st.current();
        if (cur && st.settings.scrobble && !st._scrobbled && st.duration > 30 && payload > Math.min(st.duration / 2, 120)) {
          set({ _scrobbled: true });
          api.scrobble(cur.id, true).catch(() => {});
        }
        // прослушивание засчитывается, когда трек реально звучал, а не просто
        // был открыт: столько секунд достаточно, чтобы он попал в «Недавнее»
        const need = Math.min(MIN_LISTEN_SEC, st.duration || MIN_LISTEN_SEC);
        if (cur && !st._playLogged && payload >= need) {
          set({ _playLogged: true });
          get().recordPlay(cur, { at: st._playFrom || Date.now() });
        }
      } else if (type === 'duration') set({ duration: payload || 0 });
      else if (type === 'playing') set({ playing: payload });
      else if (type === 'buffering') set({ buffering: payload });
      else if (type === 'ended') { get().markPlayed(); get().onEnded(); }
      else if (type === 'error') get().toast(payload, 'error');
    });
  },

  // Пишем настройки пачкой: во время перетаскивания ползунка громкости
  // состояние меняется каждый кадр, а на диск это летит один раз.
  persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => persistNow(get()), 350);
  },
  persistNow() { return persistNow(get()); },

  async connect(rawCreds, silent = false) {
    set({ connecting: true, authError: '' });
    const creds = rawCreds?.demo ? rawCreds : { ...rawCreds, url: normalizeServerUrl(rawCreds.url) };
    try {
      api.configure(creds);
      api.setMusicFolder(get().settings.musicFolderId ?? null);
      const info = await api.ping();
      set({ connected: true, credentials: creds, serverInfo: info, connecting: false });
      await get().persistNow();
      get().loadMusicFolders();
      get().loadPlaylists();
      get().loadStarred();
      return true;
    } catch (e) {
      set({ connecting: false, connected: false, authError: e.message || 'Не удалось подключиться' });
      if (!silent) get().toast(e.message || 'Ошибка подключения', 'error');
      return false;
    }
  },

  async logout() {
    engine.pause();
    set({ connected: false, credentials: null, queue: [], index: -1, playlists: [], serverInfo: null });
    await savePersisted({
      settings: get().settings, offlineMeta: get().offlineMeta, searchHistory: get().searchHistory,
      playHistory: [],
    });
  },

  /* ---------- исключённые треки ---------- */

  async loadDislikes() {
    const list = await loadDislikes();
    const dislikes = {};
    list.forEach((t) => { if (t?.id) dislikes[t.id] = t; });
    set({ dislikes, dislikedIds: new Set(Object.keys(dislikes)) });
    if (desktop?.dislikesPath) desktop.dislikesPath().then((p) => set({ dislikesPath: p })).catch(() => {});
  },

  persistDislikes() {
    const list = Object.values(get().dislikes).sort((a, b) => (b.at || 0) - (a.at || 0));
    saveDislikes(list);
  },

  isDisliked(id) { return get().dislikedIds.has(id); },

  /** Исключить трек: убрать из очереди, промотать дальше и запомнить на диск. */
  dislike(track, { silent = false } = {}) {
    if (!track?.id || get().dislikedIds.has(track.id)) return;
    const entry = {
      id: track.id,
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      albumId: track.albumId || null,
      artistId: track.artistId || null,
      duration: track.duration || 0,
      coverArt: track.coverArt || track.albumId || null,
      at: Date.now(),
    };
    const dislikes = { ...get().dislikes, [track.id]: entry };
    const dislikedIds = new Set(get().dislikedIds); dislikedIds.add(track.id);
    set({ dislikes, dislikedIds });
    get().persistDislikes();
    get().dropDislikedFromQueue(track.id);
    if (!silent) {
      get().toast(`Больше не попадётся: ${track.title}`, 'info', {
        label: 'Вернуть', onClick: () => get().undislike(track.id),
      });
    }
  },

  undislike(id) {
    if (!get().dislikedIds.has(id)) return;
    const dislikes = { ...get().dislikes }; delete dislikes[id];
    const dislikedIds = new Set(get().dislikedIds); dislikedIds.delete(id);
    set({ dislikes, dislikedIds });
    get().persistDislikes();
  },

  toggleDislike(track) {
    if (!track?.id) return;
    if (get().dislikedIds.has(track.id)) { get().undislike(track.id); get().toast('Дизлайк снят'); }
    else get().dislike(track);
  },

  clearDislikes() {
    set({ dislikes: {}, dislikedIds: new Set() });
    get().persistDislikes();
    get().toast('Список исключённых очищен', 'success');
  },

  /** Выкинуть исключённый трек из очереди; если он играет — сразу следующий. */
  dropDislikedFromQueue(id) {
    const { queue, index } = get();
    if (!queue.length) return;
    const playingIt = queue[index]?.id === id;
    const q = queue.filter((t) => t.id !== id);
    if (!q.length) { set({ queue: [], queueSource: [], index: -1 }); engine.pause(); return; }
    if (playingIt) {
      const nextIndex = Math.min(index, q.length - 1);
      set({ queue: q, queueSource: q, index: nextIndex });
      get().loadCurrent(true);
    } else {
      const before = queue.slice(0, index).filter((t) => t.id !== id).length;
      set({ queue: q, queueSource: q, index: before });
    }
  },

  /** Убрать исключённые из любого списка треков (если включена настройка). */
  filterDisliked(list) {
    if (!Array.isArray(list) || !get().settings.hideDisliked) return list || [];
    const ids = get().dislikedIds;
    if (!ids.size) return list;
    return list.filter((t) => !ids.has(t?.id));
  },

  openDislikesFolder() {
    if (desktop?.dislikesReveal) desktop.dislikesReveal();
    else get().toast('Список хранится в браузере (localStorage)', 'info');
  },

  /* ---------- история поиска ----------
     Пишется только по явному действию пользователя — Enter в поле поиска или
     кнопка «Искать» (см. TitleBar), а также при выборе строки из самой истории.
     Набор текста историю не меняет, чтобы в ней не оседали промежуточные варианты. */

  /** @returns {boolean} запомнен ли запрос */
  pushSearchHistory(q) {
    if (get().settings.rememberSearch === false) return false;   // пользователь просил не помнить
    const list = pushHistory(get().searchHistory, q);
    if (list === get().searchHistory) return false;      // слишком короткий/пустой
    set({ searchHistory: list });
    get().persist();
    return true;
  },
  removeSearchHistory(q) {
    set({ searchHistory: dropHistory(get().searchHistory, q) });
    get().persist();
  },
  clearSearchHistory() {
    set({ searchHistory: [] });
    get().persistNow();
  },

  /* ---------- история прослушиваний (экран «Недавнее») ----------
     Своей истории у Subsonic нет (scrobble — только запись на сервер), поэтому
     помним сами: что зазвучало — то и записано. Пишет движок из wireEngine. */

  /** @returns {boolean} записано ли прослушивание */
  recordPlay(track, { at = 0, context = null } = {}) {
    if (!track?.id) return false;
    if (get().settings.rememberPlays === false) return false;
    const ctx = context || get().context;
    const list = pushPlay(get().playHistory, track, {
      at: at || Date.now(),
      context: typeof ctx === 'string' ? ctx : (ctx?.name || null),
    });
    if (list === get().playHistory) return false;
    set({ playHistory: list });
    get().persist();
    return true;
  },
  /** трек доиграл до конца — считаем прослушанным, даже если не дослушал 20 с */
  markPlayed() {
    const st = get();
    if (st._playLogged) return false;
    const cur = st.current();
    if (!cur || st.time < 5) return false;
    set({ _playLogged: true });
    return get().recordPlay(cur, { at: st._playFrom || Date.now() });
  },
  removePlay(at) {
    const list = dropPlay(get().playHistory, at);
    if (list === get().playHistory) return false;
    set({ playHistory: list });
    get().persist();
    return true;
  },
  clearPlayHistory() {
    set({ playHistory: [] });
    get().persistNow();
  },
  /** «Вернуть» из тоста после очистки */
  restorePlayHistory(list) {
    set({ playHistory: sanitizePlays(list) });
    get().persistNow();
  },

  /* ---------- settings ---------- */
  updateSettings(patch) {
    if ('lrclib' in patch) lyricsWarmed.clear();   // после включения тексты ищем заново
    if (patch.rememberSearch === false) set({ searchHistory: [] });   // выключил — забыли
    if (patch.rememberPlays === false) set({ playHistory: [] });      // выключил — забыли и историю
    const settings = { ...get().settings, ...patch };
    set({ settings });
    get().persist();
    return settings;
  },
  // v — положение ползунка 0..1; кривую громкости применяет движок
  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    engine.setVolume(vol);                       // движение ползунка всегда снимает mute
    get().updateSettings({ volume: vol, muted: vol === 0 ? get().settings.muted : false });
  },
  toggleMute() {
    const m = !get().settings.muted;
    engine.setVolume(m ? 0 : get().settings.volume);
    get().updateSettings({ muted: m });
  },
  /* ---------- раскладка интерфейса ---------- */
  setUi(patch) {
    const ui = { ...DEFAULT_UI, ...get().settings.ui, ...patch };
    get().updateSettings({ ui });
    return ui;
  },
  applyUiPreset(name) {
    const p = UI_PRESETS[name];
    if (p) get().setUi(p);
  },
  resetUi() { get().updateSettings({ ui: { ...DEFAULT_UI } }); },
  toggleSidebar(force) {
    const ui = get().settings.ui;
    const next = force == null ? !ui.sidebarCollapsed : !!force;
    if (next === !!ui.sidebarCollapsed) return next;
    get().setUi({ sidebarCollapsed: next, showSidebar: true });
    return next;
  },

  setEq(patch) {
    const eq = { ...get().settings.eq, ...patch };
    engine.setEqEnabled(eq.enabled);
    engine.setPreamp(eq.preamp);
    engine.applyBands(eq.bands);
    get().updateSettings({ eq });
  },

  /* ---------- offline ---------- */
  async refreshOffline() {
    if (!desktop) return;
    const list = await desktop.offlineList();
    set({ offline: list || {} });
  },
  async download(track) {
    if (!desktop) { get().toast('Скачивание доступно в десктоп-версии', 'error'); return; }
    if (api.demo) { get().toast('В демо-режиме скачивание отключено', 'error'); return; }
    get().toast(`Скачиваю «${track.title}»…`);
    try {
      const saved = await desktop.offlineSave({ id: track.id, url: api.downloadUrl(track.id), ext: track.suffix || 'mp3' });
      // main-процесс отвечает { ok, … } — без проверки битый файл выглядел бы скачанным
      if (!saved?.ok) throw new Error(saved?.error || 'не удалось сохранить файл');
      set({ offlineMeta: { ...get().offlineMeta, [track.id]: track } });
      await get().persistNow();
      await get().refreshOffline();
      get().toast(`«${track.title}» доступен офлайн`, 'success');
      return true;
    } catch (e) { get().toast('Ошибка скачивания: ' + e.message, 'error'); return false; }
  },
  /**
   * Скачать несколько треков (альбом, плейлист). Предупреждаем один раз, а не
   * по числу треков, и не зовём сервер, когда офлайн вообще недоступен.
   * @returns {Promise<number>} сколько треки отправлено в загрузку
   */
  async downloadMany(tracks) {
    const list = (tracks || []).filter(Boolean);
    if (!list.length) return 0;
    if (!desktop) { get().toast('Скачивание доступно в десктоп-версии', 'error'); return 0; }
    if (api.demo) { get().toast('В демо-режиме скачивание отключено', 'error'); return 0; }
    const already = get().offline;
    const todo = list.filter((t) => !already[t.id]);
    if (!todo.length) { get().toast('Все треки уже скачаны', 'info'); return 0; }
    get().toast(`Скачиваю ${songsWord(todo.length)}…`, 'info');
    let ok = 0;
    for (const t of todo) { if (await get().downloadQueueItem(t)) ok++; }
    await get().refreshOffline();
    if (ok) get().toast(`${songsWord(ok)} в офлайн-кэше${todo.length - ok ? `, сбой: ${todo.length - ok}` : ''}`, 'success');
    return ok;
  },

  // внутренний вариант download() без тостов — для пакетной загрузки
  async downloadQueueItem(track) {
    const desktopApi = typeof window !== 'undefined' ? window.desktop : null;
    if (!desktopApi) return false;
    try {
      const saved = await desktopApi.offlineSave({ id: track.id, url: api.downloadUrl(track.id), ext: track.suffix || 'mp3' });
      if (!saved?.ok) return false;
      set({ offlineMeta: { ...get().offlineMeta, [track.id]: track } });
      await get().persistNow();
      return true;
    } catch { return false; }
  },

  async removeDownload(id) {
    if (!desktop) return;
    await desktop.offlineRemove(id);
    const meta = { ...get().offlineMeta };
    delete meta[id];
    set({ offlineMeta: meta });
    await get().persistNow();
    await get().refreshOffline();
  },
  async clearDownloads() {
    if (!desktop) return;
    await desktop.offlineClear();
    set({ offlineMeta: {} });
    await get().persistNow();
    await get().refreshOffline();
    get().toast('Офлайн-кэш очищен', 'success');
  },

  /* ---------- music folders (библиотеки Navidrome) ---------- */
  async loadMusicFolders() {
    const folders = await api.getMusicFolders();
    set({ musicFolders: folders });
    // выбранная папка исчезла на сервере — возвращаемся ко «Всем»
    const cur = get().settings.musicFolderId;
    if (cur != null && !folders.some((f) => String(f.id) === String(cur))) {
      get().setMusicFolder(null, true);
    }
    return folders;
  },

  setMusicFolder(id, silent = false) {
    const value = (id === null || id === undefined || id === '') ? null : String(id);
    if (String(get().settings.musicFolderId ?? '') === String(value ?? '')) return;
    api.setMusicFolder(value);
    get().updateSettings({ musicFolderId: value });
    set({ libraryVersion: get().libraryVersion + 1 });
    get().loadPlaylists();
    get().loadStarred();
    if (!silent) {
      const name = value === null
        ? 'Все музыкальные папки'
        : (get().musicFolders.find((f) => String(f.id) === value)?.name || 'Библиотека');
      get().toast(`Библиотека: ${name}`, 'success');
    }
  },

  currentFolderName() {
    const id = get().settings.musicFolderId;
    if (id == null) return 'Все папки';
    return get().musicFolders.find((f) => String(f.id) === String(id))?.name || 'Папка';
  },

  /* ---------- library ---------- */
  async loadPlaylists() {
    try { set({ playlists: await api.getPlaylists() }); } catch {}
  },

  /* ---------- плейлисты: свои и общие ---------- */

  /** Плейлист создан текущим пользователем? */
  isMyPlaylist(pl) {
    const me = get().credentials?.username;
    if (!pl?.owner || !me) return true;          // сервер не сказал — считаем своим
    return String(pl.owner).toLowerCase() === String(me).toLowerCase();
  },

  /** Свои и «расшаренные» другими пользователями — раздельно. */
  splitPlaylists(list) {
    const all = list || get().playlists;
    const mine = [], shared = [];
    all.forEach((p) => (get().isMyPlaylist(p) ? mine : shared).push(p));
    return { mine, shared };
  },

  /** Треки можно дописывать только в свои плейлисты — чужие сервер не отдаст. */
  editablePlaylists() { return get().splitPlaylists().mine; },

  async addTracksToPlaylist(playlistId, tracks, { silent = false } = {}) {
    const ids = (Array.isArray(tracks) ? tracks : [tracks])
      .map((t) => (typeof t === 'string' ? t : t?.id)).filter(Boolean);
    if (!ids.length) return false;
    const pl = get().playlists.find((x) => x.id === playlistId);
    try {
      await api.updatePlaylist(playlistId, { songIdToAdd: ids });
      get().loadPlaylists();
      if (!silent) {
        get().toast(
          ids.length === 1 ? `Добавлено в «${pl?.name || 'плейлист'}»` : `${ids.length} трека(ов) в «${pl?.name || 'плейлист'}»`,
          'success',
        );
      }
      return true;
    } catch (e) {
      get().toast('Не удалось добавить: ' + (e.message || e), 'error');
      return false;
    }
  },

  async createPlaylistWith(name, tracks = []) {
    const ids = (Array.isArray(tracks) ? tracks : [tracks])
      .map((t) => (typeof t === 'string' ? t : t?.id)).filter(Boolean);
    try {
      const pl = await api.createPlaylist(name, ids);
      await get().loadPlaylists();
      get().toast(ids.length ? `Плейлист «${name}» создан с ${ids.length} треком(ами)` : `Плейлист «${name}» создан`, 'success');
      return pl;
    } catch (e) {
      get().toast('Не удалось создать плейлист: ' + (e.message || e), 'error');
      return null;
    }
  },

  /* ---------- свой порядок плейлистов ----------
     Navidrome отдаёт плейлисты своим порядком (по алфавиту), а переставить их
     на сервере нельзя: в Subsonic API нет «move playlist». Поэтому порядок
     хранится локально — в settings.playlistOrder — и применяется везде, где
     плейлисты показываются списком: медиатека слева, «Мои плейлисты», окно
     «Добавить в плейлист». */

  /** Плейлисты в сохранённом порядке; те, кого в списке ещё нет, — в конец. */
  orderPlaylists(list) {
    const arr = Array.isArray(list) ? list : get().playlists;
    const order = get().settings.playlistOrder || [];
    const rank = new Map(order.map((id, i) => [String(id), i]));
    const tail = order.length + arr.length + 1;   // «неизвестные» идут после известных
    return arr
      .map((p, i) => ({ p, i, r: rank.has(String(p.id)) ? rank.get(String(p.id)) : tail }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map((o) => o.p);
  },

  /**
   * Переставить плейлист: поставить dragId перед/после targetId.
   * targetId = null — в конец списка. before = true — перед целевой строкой.
   */
  movePlaylist(dragId, targetId, before = true) {
    if (dragId == null || String(dragId) === String(targetId)) return false;
    const all = get().playlists;
    const order = (get().settings.playlistOrder || []).filter((id) => all.some((p) => String(p.id) === String(id)));
    const missing = all.filter((p) => !order.some((id) => String(id) === String(p.id))).map((p) => p.id);
    const ids = [...order, ...missing].filter((id) => String(id) !== String(dragId));
    let at = targetId == null ? ids.length : ids.findIndex((id) => String(id) === String(targetId));
    if (at < 0) at = ids.length;
    ids.splice(before ? at : at + 1, 0, dragId);
    get().updateSettings({ playlistOrder: ids });
    return true;
  },

  resetPlaylistOrder() {
    if (!(get().settings.playlistOrder || []).length) return false;
    get().updateSettings({ playlistOrder: [] });
    get().toast('Порядок плейлистов сброшен — как отдаёт сервер', 'success');
    return true;
  },

  /* ---------- закреплённое ---------- */

  isPinned(kind, id) { return (get().settings.pins || []).includes(`${kind}:${id}`); },

  /** Порядковый номер закрепления (для сортировки), -1 если не закреплён. */
  pinIndex(kind, id) { return (get().settings.pins || []).indexOf(`${kind}:${id}`); },

  togglePin(kind, id, name = '') {
    const key = `${kind}:${id}`;
    const pins = get().settings.pins || [];
    const on = pins.includes(key);
    get().updateSettings({ pins: on ? pins.filter((k) => k !== key) : [...pins, key] });
    get().toast(on ? `${name || 'Элемент'} откреплён` : `${name || 'Элемент'} закреплён вверху медиатеки`, 'success');
    return !on;
  },
  async loadStarred() {
    try {
      const s = await api.getStarred();
      set({ starredIds: {
        song: new Set(s.songs.map((x) => x.id)),
        album: new Set(s.albums.map((x) => x.id)),
        artist: new Set(s.artists.map((x) => x.id)),
      } });
    } catch {}
  },
  isStarred(id, kind = 'song') { return get().starredIds[kind]?.has(id); },
  async toggleStar(item, kind = 'song') {
    const has = get().isStarred(item.id, kind);
    const next = { ...get().starredIds, [kind]: new Set(get().starredIds[kind]) };
    has ? next[kind].delete(item.id) : next[kind].add(item.id);
    set({ starredIds: next });
    try {
      has ? await api.unstar(item.id, kind) : await api.star(item.id, kind);
      get().toast(has ? 'Удалено из любимых' : 'Добавлено в любимые', 'success');
    } catch (e) {
      // сервер отказал — возвращаем как было, иначе сердечко врёт до перезапуска
      const back = { ...get().starredIds, [kind]: new Set(get().starredIds[kind]) };
      has ? back[kind].add(item.id) : back[kind].delete(item.id);
      set({ starredIds: back });
      get().toast('Не удалось сохранить: ' + e.message, 'error');
    }
  },

  /**
   * Массовое «в любимые» / «убрать из любимых» для пачки выделенных треков.
   * Один запрос на трек, но один тост на всю пачку: по тосту на трек всплывает
   * гора плашек, которая перекрывает список.
   */
  async setStarMany(items, on, kind = 'song') {
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
    const todo = list.filter((t) => get().isStarred(t.id, kind) !== !!on);
    if (!todo.length) { get().toast(on ? 'Уже в любимых' : 'И так не в любимых', 'info'); return true; }

    // оптимистично перекрашиваем сердечки, как в одиночном toggleStar
    const next = { ...get().starredIds, [kind]: new Set(get().starredIds[kind]) };
    todo.forEach((t) => (on ? next[kind].add(t.id) : next[kind].delete(t.id)));
    set({ starredIds: next });

    let ok = 0;
    for (const t of todo) {
      try { on ? await api.star(t.id, kind) : await api.unstar(t.id, kind); ok++; } catch { /* один не удался — остальные всё равно дожимаем */ }
    }
    const failed = todo.length - ok;
    if (failed) {
      // сердечки, которые сервер не принял, возвращаем на место
      get().loadStarred();
      get().toast(`Не удалось изменить: ${failed} из ${todo.length}`, 'error');
    } else {
      get().toast(on ? `${todo.length} в любимых` : `${todo.length} удалено из любимых`, 'success');
    }
    return !failed;
  },

  /* ---------- playback ---------- */
  current() { const { queue, index } = get(); return index >= 0 ? queue[index] : null; },

  srcFor(track) {
    const off = get().offline[track.id];
    if (off?.url) return off.url;
    const { maxBitRate, format } = get().settings;
    return api.streamUrl(track.id, { maxBitRate, format });
  },

  async playQueue(tracks, startIndex = 0, context = null) {
    if (!tracks?.length) return;
    const raw = tracks.filter(Boolean);
    const wanted = raw[startIndex] || raw[0];
    let list = get().filterDisliked(raw);
    // явный запуск конкретного трека уважаем, даже если он исключён
    if (wanted && !list.some((t) => t.id === wanted.id)) list = [wanted, ...list];
    if (!list.length) { get().toast('Все треки из этого списка исключены', 'info'); return; }
    startIndex = Math.max(0, list.findIndex((t) => t.id === wanted?.id));
    const shuffle = get().shuffle;
    const queue = shuffle ? shuffled(list, startIndex) : list;
    const index = shuffle ? 0 : startIndex;
    set({ queueSource: list, queue, index, context, _scrobbled: false });
    await get().loadCurrent(true);
  },

  async loadCurrent(autoplay = true) {
    const track = get().current();
    if (!track) return;
    set({ time: 0, duration: track.duration || 0, _scrobbled: false, _playFrom: Date.now(), _playLogged: false });
    engine.setDemo(api.demo, track.duration || 0);
    await engine.load(get().srcFor(track), { duration: track.duration || 0, autoplay });
    if (get().settings.eq.enabled) { engine.setEqEnabled(true); engine.setPreamp(get().settings.eq.preamp); engine.applyBands(get().settings.eq.bands); }
    if (get().settings.scrobble) api.scrobble(track.id, false).catch(() => {});
    get().updateMediaSession(track);
    // заранее тянем обложки ближайших треков — переключение без мигания
    prefetchCovers(get().queue.slice(get().index, get().index + 8), 300);
    get().prefetchLyrics();                      // и тексты для следующих треков
    if (get().settings.autodj?.enabled) get().autoDjRefill();
  },

  /**
   * Держим тексты «про запас»: пока играет трек, в фоне (не чаще запроса в секунду
   * к LRCLIB) подтягиваем тексты для нескольких следующих треков очереди. За счёт
   * этого строка не появляется с задержкой при переключении — у трека уже есть текст.
   */
  async prefetchLyrics() {
    const st = get();
    if (!st.settings.lrclib || st.settings.lyricsPrefetch === false) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const upcoming = st.queue.slice(st.index + 1, st.index + 4).filter((t) => t && !lyricsWarmed.has(t.id));
    if (!upcoming.length) return;
    for (const t of upcoming) {
      lyricsWarmed.add(t.id);                    // помечаем заранее: не запускать дважды
      if (api.lyricsReady(t)) continue;
      await api.getLyrics(t, { light: true }).catch(() => null);
    }
    if (lyricsWarmed.size > 800) lyricsWarmed.clear();
  },

  async updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    const art = await resolveCover(track.coverArt || track.albumId, 512).catch(() => null);
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title, artist: track.artist, album: track.album,
        artwork: [{ src: art || api.coverUrl(track.coverArt || track.albumId, 512), sizes: '512x512' }],
      });
      navigator.mediaSession.setActionHandler('play', () => get().play());
      navigator.mediaSession.setActionHandler('pause', () => get().pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => get().next(true));
      navigator.mediaSession.setActionHandler('previoustrack', () => get().prev());
    } catch {}
  },

  play() { engine.play(); },
  pause() { engine.pause(); },
  togglePlay() { get().playing ? engine.pause() : engine.play(); },
  seek(t) { engine.seek(t); set({ time: t }); },

  async next(manual = false) {
    const { queue, index, repeat } = get();
    if (!queue.length) return;
    if (!manual && repeat === 'one') { engine.seek(0); engine.play(); return; }
    let i = index + 1;
    if (i >= queue.length && repeat !== 'all' && get().settings.autodj?.enabled) {
      await get().autoDjRefill(true);              // AutoDJ: очередь не должна кончаться
      if (i < get().queue.length) { set({ index: i }); await get().loadCurrent(true); return; }
    }
    if (i >= queue.length) {
      if (repeat === 'all' || (!manual && repeat === 'all')) i = 0;
      else if (manual) i = 0;
      else { engine.pause(); engine.seek(0); return; }
    }
    // страховка: исключённые треки не должны играть, даже если попали в очередь.
    // Очередь перечитываем: AutoDJ мог добавить в неё треки, пока мы ждали ответа.
    const ids = get().dislikedIds;
    if (ids.size && get().settings.hideDisliked) {
      const q = get().queue;
      let guard = 0;
      while (q[i] && ids.has(q[i].id) && guard++ < q.length) i += 1;
      if (i >= q.length) { engine.pause(); engine.seek(0); return; }
    }
    set({ index: i });
    await get().loadCurrent(true);
  },

  async prev() {
    const { index, time } = get();
    if (time > 4) { engine.seek(0); return; }
    const i = Math.max(0, index - 1);
    set({ index: i });
    await get().loadCurrent(true);
  },

  async jumpTo(i) { set({ index: i }); await get().loadCurrent(true); },

  onEnded() {
    const { repeat } = get();
    if (repeat === 'one') { engine.seek(0); engine.play(); return; }
    get().next(false);
  },

  toggleShuffle() {
    const shuffle = !get().shuffle;
    const { queue, index, queueSource } = get();
    const cur = queue[index];
    if (shuffle) {
      const rest = queue.filter((t, i) => i !== index);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      set({ shuffle, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const src = queueSource.length ? queueSource : queue;
      set({ shuffle, queue: src, index: cur ? Math.max(0, src.findIndex((t) => t.id === cur.id)) : -1 });
    }
  },

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
  },

  addToQueue(tracks, next = false) {
    const list = get().filterDisliked(Array.isArray(tracks) ? tracks : [tracks]);
    if (!list.length) { get().toast('Трек исключён из подборок', 'info'); return; }
    const { queue, index } = get();
    if (!queue.length) { get().playQueue(list, 0, { type: 'queue', name: 'Очередь' }); return; }
    const q = [...queue];
    q.splice(next ? index + 1 : q.length, 0, ...list);
    set({ queue: q, queueSource: q });
    get().toast(next ? 'Играет следующим' : `Добавлено в очередь: ${list.length}`, 'success');
  },

  removeFromQueue(i) {
    const { queue, index } = get();
    const q = queue.filter((_, k) => k !== i);
    if (!q.length) { get().clearQueue(); return; }
    if (i === index) {
      // убрали то, что играет: ставим на его место следующий, а не глушим звук
      const nextIndex = Math.min(index, q.length - 1);
      set({ queue: q, queueSource: q, index: nextIndex });
      get().loadCurrent(true);
    } else {
      set({ queue: q, queueSource: q, index: i < index ? index - 1 : index });
    }
    if (get().settings.autodj?.enabled) get().autoDjRefill();
  },

  moveInQueue(from, to) {
    const { queue, index } = get();
    const q = [...queue];
    const [item] = q.splice(from, 1);
    q.splice(to, 0, item);
    let idx = index;
    if (from === index) idx = to;
    else if (from < index && to >= index) idx = index - 1;
    else if (from > index && to <= index) idx = index + 1;
    set({ queue: q, queueSource: q, index: idx });
  },

  /** Случайный трек без анимации (используется как запасной путь) */
  async playRandomTrack() {
    if (get().randomBusy) return;
    set({ randomBusy: true });
    try {
      const songs = await api.getRandomSongs(50);
      if (!songs.length) { get().toast('В библиотеке нечего играть', 'error'); return; }
      // playQueue уважает включённый шаффл, поэтому порядок и так будет случайным
      await get().playQueue(songs, 0, { type: 'random', name: 'Случайные треки' });
      const t = get().current();
      if (t) get().toast(`Случайный трек: ${t.title} — ${t.artist}`, 'success');
    } catch (e) {
      get().toast('Не удалось получить случайные треки: ' + e.message, 'error');
    } finally {
      set({ randomBusy: false });
    }
  },

  /**
   * Бросок кубика: кубик вылетает из кнопки, крутится, «приземляется»
   * обложкой выпавшего трека и раскрывается в полноэкранный плеер.
   * @param {DOMRect|null} origin — прямоугольник кнопки, из которой летит кубик
   */
  async rollDice(origin = null) {
    if (get().dice || get().randomBusy) return;

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || get().settings.rollAnim === 'off') {   // системная настройка / выбор пользователя
      await get().playRandomTrack();
      if (get().current()) set({ nowPlayingOpen: true });
      return;
    }

    const rect = origin && { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 };
    const face = 1 + Math.floor(Math.random() * 6);
    const kind = get().settings.rollAnim === 'dice' ? 'dice' : 'vinyl';
    const T = kind === 'dice' ? DICE : VINYL;
    const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
    const frames = (n = 1) => new Promise((r) => {
      const step = (k) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
      step(n);
    });
    /** сменить фазу, если бросок ещё не прерван пользователем */
    const go = (phase, patch = {}) => {
      const d = get().dice;
      if (!d) return false;
      set({ dice: { ...d, phase, ...patch } });
      return true;
    };

    set({
      randomBusy: true,
      dice: { kind, phase: 'idle', origin: rect, track: null, face, recover: false },
    });

    let balanceTimer = 0;
    try {
      // запрос стартует сразу — вращение живёт ровно столько, сколько идёт поиск
      const songsP = api.getRandomSongs(50);
      songsP.catch(() => {});                    // без unhandled rejection

      await wait(T.intro);                    // 1. кубик прилетел и «дышит»
      if (!go('spin')) return;                   // 2. плавный разгон и вращение
      const spinStart = Date.now();

      // 3. поиск затянулся — кубик уходит в баланс на ребре
      balanceTimer = setTimeout(() => {
        if (get().dice?.phase === 'spin') go('balance');
      }, T.balanceAfter);

      const songs = await songsP;
      if (!songs.length) throw new Error('В библиотеке нечего играть');
      const track = songs[0];

      // обложка должна быть готова до «приземления», иначе будет пустая грань
      await Promise.all([
        resolveCover(track.coverArt || track.albumId, 600).catch(() => null),
        wait(T.minSpin - (Date.now() - spinStart)),
      ]);
      clearTimeout(balanceTimer);

      // 4. остановка на результате (из баланса — с возвратом на грань)
      const recover = get().dice?.phase === 'balance';
      if (!go('settle', { track, recover })) return;
      await wait(recover ? T.settleFromBalance : T.settle);

      // 5. облёт камеры на вид сверху; музыка стартует, плеер монтируется скрытым
      if (!go('top')) return;
      get().playQueue(songs, 0, { type: 'random', name: 'Случайные треки' });
      set({ nowPlayingOpen: true });
      await wait(T.camera + T.reveal + T.hold);
      await frames(2);

      // 6. обложка перелетает с верхней грани в обложку плеера
      if (!go('expand')) return;
      await wait(T.expand);
      if (get().dice) set({ dice: null });
    } catch (e) {
      set({ dice: null });
      get().toast(e.message || 'Не удалось получить случайные треки', 'error');
    } finally {
      clearTimeout(balanceTimer);
      set({ randomBusy: false });
    }
  },

  /** Досрочно прервать анимацию (Esc / клик) — трек всё равно включится */
  skipDice() {
    const d = get().dice;
    if (!d) return;
    set({ dice: null });
    if (d.track && get().current()?.id !== d.track.id) {
      get().playQueue([d.track], 0, { type: 'random', name: 'Случайные треки' })
        .then(() => set({ nowPlayingOpen: true }));
    } else if (get().current()) {
      set({ nowPlayingOpen: true });
    }
  },

  /* ---------- AutoDJ ---------- */
  setAutoDj(patch, silent = true) {
    const prev = get().settings.autodj || {};
    const autodj = { ...prev, ...patch };
    get().updateSettings({ autodj });
    if (patch.enabled === false) return autodj;
    if (patch.mode || patch.enabled === true) set({ djSeen: [] });
    if (patch.mode && patch.mode !== prev.mode) {
      // сменили режим — хвост, набранный старым режимом, больше не актуален
      const { queue, index } = get();
      const q = queue.filter((t, i) => i <= index || !t._dj);
      if (q.length !== queue.length) set({ queue: q, queueSource: q });
    }
    if (autodj.enabled) get().autoDjRefill(true);
    if (!silent && patch.mode) get().toast(`AutoDJ: ${modeName(patch.mode)}`, 'success');
    return autodj;
  },

  toggleAutoDj() {
    const on = !(get().settings.autodj?.enabled);
    get().setAutoDj({ enabled: on });
    if (!on) {
      // выключили — убираем ещё не сыгранные автотреки из хвоста
      const { queue, index } = get();
      const q = queue.filter((t, i) => i <= index || !t._dj);
      set({ queue: q, queueSource: q });
      get().toast('AutoDJ выключен', 'info');
    } else {
      get().toast(`AutoDJ включён · ${modeName(get().settings.autodj.mode)}`, 'success');
    }
  },

  async autoDjRefill(force = false) {
    const dj = get().settings.autodj || {};
    if (!dj.enabled || get().autodjBusy) return 0;

    const { queue, index } = get();
    const buffer = Math.max(1, Number(dj.buffer) || 5);
    const remaining = queue.length - index - 1;
    const more = force === 'more';                 // явное «Добавить сейчас»
    if (!force && remaining >= buffer) return 0;

    const seed = get().current() || queue[queue.length - 1] || null;
    if (!seed && !force) return 0;

    // при проверке буфера добираем только недостающее, по кнопке — целую порцию
    const need = more ? buffer : buffer - Math.max(0, remaining);
    if (need <= 0) return 0;
    set({ autodjBusy: true });
    try {
      const exclude = new Set(queue.map((t) => t.id));
      if (dj.noRepeat) get().djSeen.forEach((id) => exclude.add(id));
      get().dislikedIds.forEach((id) => exclude.add(id));   // исключённые не подмешиваем
      const picks = await pickAutoDj({ api, mode: dj.mode || 'mix', seed, need, exclude });
      if (!picks.length) {
        if (force) get().toast('AutoDJ: подходящих треков не нашлось', 'error');
        return 0;
      }
      const tagged = picks.map((t) => ({ ...t, _dj: dj.mode || 'mix' }));
      const q = [...get().queue, ...tagged];
      set({
        queue: q,
        queueSource: q,
        djSeen: [...get().djSeen, ...picks.map((t) => t.id)].slice(-500),
      });
      return tagged.length;
    } catch (e) {
      if (force) get().toast('AutoDJ: ' + e.message, 'error');
      return 0;
    } finally {
      set({ autodjBusy: false });
    }
  },

  /** «Радио» по треку/альбому/исполнителю: играем затравку и включаем AutoDJ */
  async startRadio(seed, mode = 'similar', name = '') {
    const list = (Array.isArray(seed) ? seed : [seed]).filter(Boolean);
    if (!list.length) return;
    set({ djSeen: [] });
    get().setAutoDj({ enabled: true, mode });
    const title = name || list[0].title || list[0].name || 'радио';
    await get().playQueue(list, 0, { type: 'radio', name: `Радио · ${title}` });
    const added = await get().autoDjRefill(true);
    get().toast(added ? `Радио «${title}» · +${added} треков` : `Радио «${title}»`, 'success');
  },

  clearQueue() { engine.pause(); set({ queue: [], queueSource: [], index: -1, time: 0, duration: 0 }); },

  setUI(patch) {
    /* Заголовок, «играть страницу» и цвет героя принадлежат конкретному
       маршруту: запоминаем, с какого адреса их поставили. Иначе перешёл
       с альбома на главную — а в шапке при прокрутке всплывает старое название. */
    if ('pageTitle' in patch || 'pagePlay' in patch || 'heroColor' in patch) set({ ...patch, pageRoute: routeNow });
    else set(patch);
  },

  /* ---------- мини-плеер ---------- */
  enterMini() {
    set({ nowPlayingOpen: false, queueOpen: false, settingsOpen: false, eqOpen: false, contextMenu: null });
    const d = typeof window !== 'undefined' ? window.desktop : null;
    if (d?.setMini) d.setMini(true).catch(() => {});
    else set({ miniForced: true });
  },
  exitMini() {
    const d = typeof window !== 'undefined' ? window.desktop : null;
    if (d?.setMini) d.setMini(false).catch(() => {});
    set({ miniForced: false });
  },
  toggleMini() {
    const small = typeof window !== 'undefined'
      && (window.innerWidth < 760 || window.innerHeight < 560);
    if (get().miniForced || small) get().exitMini(); else get().enterMini();
  },
}));

export default useStore;

// В режиме разработки удобно дёргать состояние из консоли и автотестов
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__store = useStore;
  window.__engine = engine;
}
