/**
 * Управление воспроизведением снаружи окна.
 *
 *  • Windows — кнопки на превью в панели задач (thumbnail toolbar): в любимые,
 *    больше не играть, назад, пауза/пуск, вперёд; бейдж состояния и полоса
 *    прогресса на значке. (Windows разрешает не больше семи кнопок.)
 *  • Linux   — MPRIS (D-Bus): контролы в панели GNOME/KDE, в наушниках и в
 *    виджетах громкости; плюс прогресс на значке в Unity-совместимых панелях.
 *  • macOS   — меню в доке (правый клик по значку).
 *  • Везде   — иконка в трее: подсказка с текущим треком и меню управления.
 *
 * Команды уходят в renderer по уже существующему каналу `media-key`
 * ('playpause' | 'next' | 'prev' | 'stop' | 'like' | 'dislike'), который стор
 * умеет обрабатывать.
 */

const { app, Menu, Tray } = require('electron');
const fs = require('fs');
const path = require('path');
const { icon } = require('./mediaIcons.cjs');

let win = null;
let tray = null;
let mpris = null;
let coversDir = null;

/** Текущее состояние плеера, присылаемое renderer'ом */
let S = {
  id: null, title: '', artist: '', album: '',
  playing: false, hasNext: false, hasPrev: false,
  liked: false, disliked: false,
  time: 0, duration: 0, coverKey: null,
};

const has = () => !!S.title;
const send = (action) => {
  if (win && !win.isDestroyed()) win.webContents.send('media-key', action);
};

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ------------------------- панель задач (Windows) ------------------------ */

/*
  Важно: Windows принимает кнопки превью (ITaskbarList3::ThumbBarAddButtons)
  только когда у окна уже есть кнопка в панели задач, то есть после первого
  показа окна. Если позвать setThumbarButtons раньше (у нас окно создаётся
  скрытым, show: false), вызов молча проваливается, но Electron запоминает,
  что кнопки «уже добавлены», и дальше шлёт ThumbBarUpdateButtons — который
  обновляет несуществующую панель. В итоге кнопок не видно до перезапуска.

  Поэтому регистрируем их только у видимого окна, проверяем результат и
  повторяем попытки, пока Windows не согласится.
*/
let thumbStarted = false;    // окно уже показывалось — можно регистрировать
let thumbOk = false;         // Windows принял кнопки
let thumbTries = 0;
let thumbTimer = null;

function thumbarButtons() {
  const off = has() ? [] : ['disabled'];
  return [
    {
      // как в Spotify: первой идёт кнопка «в любимые»
      tooltip: !has() ? 'В любимые' : (S.liked ? 'Убрать из любимых' : 'Добавить в любимые'),
      icon: icon(S.liked ? 'likeOn' : 'like'),
      flags: off,
      click: () => send('like'),
    },
    {
      // «больше не играть»: трек уходит в исключённые и включается следующий
      tooltip: !has() ? 'Больше не играть'
        : (S.disliked ? 'Вернуть трек в подборки' : 'Больше не играть этот трек'),
      icon: icon(S.disliked ? 'dislikeOn' : 'dislike'),
      flags: off,
      click: () => send('dislike'),
    },
    {
      tooltip: 'Предыдущий трек',
      icon: icon('prev'),
      flags: S.hasPrev ? [] : ['disabled'],
      click: () => send('prev'),
    },
    {
      tooltip: S.playing ? 'Пауза' : 'Воспроизвести',
      icon: icon(S.playing ? 'pause' : 'play'),
      flags: off,
      click: () => send('playpause'),
    },
    {
      tooltip: 'Следующий трек',
      icon: icon('next'),
      flags: S.hasNext ? [] : ['disabled'],
      click: () => send('next'),
    },
  ];
}

/** Окно видно и у него есть кнопка в панели задач? */
function thumbReady() {
  return process.platform === 'win32'
    && !!win && !win.isDestroyed()
    && thumbStarted && win.isVisible() && !win.isMinimized();
}

function updateThumbar() {
  if (!thumbReady()) return;
  clearTimeout(thumbTimer);
  // кнопки — отдельно от подписи и бейджа: если бейдж не поддержан, кнопки
  // всё равно должны считаться успешно зарегистрированными
  let ok = false;
  try { ok = win.setThumbarButtons(thumbarButtons()) !== false; } catch { ok = false; }
  try {
    win.setThumbnailToolTip(has() ? `${S.title} — ${S.artist}` : 'Spotidrome');
  } catch { /* только Windows */ }
  try {
    win.setOverlayIcon(
      has() ? icon(S.playing ? 'badgePlay' : 'badgePause') : null,
      has() ? (S.playing ? 'Играет' : 'На паузе') : '',
    );
  } catch { /* только Windows */ }

  if (ok) {
    if (!thumbOk) console.log('[taskbar] кнопки на превью окна зарегистрированы');
    thumbOk = true;
    thumbTries = 0;
  } else if (thumbTries++ < 12) {
    // панель задач может быть ещё не готова (перезапуск explorer.exe, вход в систему)
    thumbTimer = setTimeout(updateThumbar, 1000 + thumbTries * 500);
  } else if (thumbTries === 13) {
    console.warn('[taskbar] Windows не принял кнопки превью — пробовали 12 раз');
  }
}

/** Первый показ окна: только теперь Windows готов принять кнопки. */
function startThumbar() {
  if (process.platform !== 'win32' || thumbStarted) return;
  thumbStarted = true;
  thumbTries = 0;
  setTimeout(updateThumbar, 400);   // даём панели задач создать кнопку окна
}

/** Полоса прогресса поверх значка: Windows и Unity-совместимые панели Linux */
function updateProgress() {
  if (!win || win.isDestroyed()) return;
  try {
    if (!has() || !S.duration) { win.setProgressBar(-1); return; }
    const p = Math.max(0, Math.min(1, S.time / S.duration));
    win.setProgressBar(p, { mode: S.playing ? 'normal' : 'paused' });
  } catch { /* no-op */ }
}

/* --------------------------------- трей --------------------------------- */

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: has() ? S.title : 'Ничего не играет', enabled: false },
    ...(has() ? [{ label: S.artist, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Предыдущий', enabled: S.hasPrev, click: () => send('prev') },
    { label: S.playing ? 'Пауза' : 'Воспроизвести', enabled: has(), click: () => send('playpause') },
    { label: 'Следующий', enabled: S.hasNext, click: () => send('next') },
    { type: 'separator' },
    {
      label: S.liked ? 'Убрать из любимых' : 'В любимые',
      enabled: has(),
      type: 'checkbox',
      checked: !!S.liked,
      click: () => send('like'),
    },
    {
      label: S.disliked ? 'Вернуть трек' : 'Больше не играть',
      enabled: has(),
      type: 'checkbox',
      checked: !!S.disliked,
      click: () => send('dislike'),
    },
    { type: 'separator' },
    { label: 'Показать Spotidrome', click: showWindow },
    { label: 'Выход', click: () => app.quit() },
  ]);
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(icon('tray'));
    tray.setToolTip('Spotidrome');
    tray.on('click', () => {
      if (!win || win.isDestroyed()) return;
      if (win.isVisible() && !win.isMinimized()) win.hide(); else showWindow();
    });
    tray.on('double-click', showWindow);
  } catch {
    tray = null;      // в системе может не быть области уведомлений
  }
}

function updateTray() {
  if (!tray) return;
  try {
    tray.setToolTip(has() ? `${S.title}\n${S.artist}${S.playing ? '' : ' (пауза)'}` : 'Spotidrome');
    tray.setContextMenu(trayMenu());
  } catch { /* no-op */ }
}

/* --------------------------------- док ---------------------------------- */

function updateDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  try {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: has() ? `${S.title} — ${S.artist}` : 'Ничего не играет', enabled: false },
      { type: 'separator' },
      { label: 'Предыдущий', enabled: S.hasPrev, click: () => send('prev') },
      { label: S.playing ? 'Пауза' : 'Воспроизвести', enabled: has(), click: () => send('playpause') },
      { label: 'Следующий', enabled: S.hasNext, click: () => send('next') },
      { type: 'separator' },
      { label: S.liked ? 'Убрать из любимых' : 'В любимые', enabled: has(), click: () => send('like') },
      { label: S.disliked ? 'Вернуть трек' : 'Больше не играть', enabled: has(), click: () => send('dislike') },
    ]));
  } catch { /* no-op */ }
}

/* ----------------------------- MPRIS (Linux) ---------------------------- */

function setupMpris() {
  if (process.platform !== 'linux') return;
  let Player;
  try {
    // необязательная зависимость: без D-Bus просто живём без MPRIS
    Player = require('mpris-service');
  } catch { return; }

  try {
    mpris = Player({
      name: 'spotidrome',
      identity: 'Spotidrome',
      supportedInterfaces: ['player'],
      supportedUriSchemes: [],
      supportedMimeTypes: [],
    });
    mpris.canRaise = true;
    mpris.canQuit = true;
    mpris.canControl = true;
    mpris.canSeek = false;
    mpris.rate = 1;
    mpris.minimumRate = 1;
    mpris.maximumRate = 1;

    mpris.on('error', () => {});          // без обработчика EventEmitter кинет исключение
    mpris.on('raise', showWindow);
    mpris.on('quit', () => app.quit());
    mpris.on('playpause', () => send('playpause'));
    mpris.on('play', () => { if (!S.playing) send('playpause'); });
    mpris.on('pause', () => { if (S.playing) send('playpause'); });
    mpris.on('stop', () => send('stop'));
    mpris.on('next', () => send('next'));
    mpris.on('previous', () => send('prev'));
  } catch {
    mpris = null;
  }
}

function coverFileUrl() {
  if (!S.coverKey || !coversDir) return null;
  try {
    const f = path.join(coversDir, `${S.coverKey}.img`);
    if (!fs.existsSync(f)) return null;
    return `file://${f}`;
  } catch { return null; }
}

function updateMpris() {
  if (!mpris) return;
  try {
    mpris.playbackStatus = has() ? (S.playing ? 'Playing' : 'Paused') : 'Stopped';
    mpris.canGoNext = !!S.hasNext;
    mpris.canGoPrevious = !!S.hasPrev;
    mpris.canPlay = has();
    mpris.canPause = has();

    const art = coverFileUrl();
    const safeId = String(S.id || 'none').replace(/[^A-Za-z0-9_]/g, '');
    mpris.metadata = {
      'mpris:trackid': mpris.objectPath(`track/${safeId || 'none'}`),
      'mpris:length': Math.round((S.duration || 0) * 1e6),   // микросекунды
      'xesam:title': S.title || '',
      'xesam:artist': [S.artist || ''],
      'xesam:album': S.album || '',
      ...(art ? { 'mpris:artUrl': art } : {}),
    };
    if (typeof mpris.getPosition === 'function') mpris.position = Math.round((S.time || 0) * 1e6);
  } catch { /* D-Bus мог отвалиться — молча продолжаем */ }
}

/* --------------------------------- API ---------------------------------- */

function setup(browserWindow, opts = {}) {
  win = browserWindow;
  coversDir = opts.coversDir || null;
  createTray();
  setupMpris();
  update({});
  if (win) {
    // кнопки превью регистрируем только после появления окна на экране
    if (win.isVisible()) startThumbar();
    win.on('show', () => { startThumbar(); updateThumbar(); });
    win.on('restore', updateThumbar);
    win.on('focus', updateThumbar);
    win.on('closed', () => {
      clearTimeout(thumbTimer);
      try { tray?.destroy(); } catch {}
      tray = null;
    });
  }
}

function update(next) {
  S = { ...S, ...(next || {}) };
  updateThumbar();
  updateProgress();
  updateTray();
  updateDock();
  updateMpris();
}

/** Диагностика для окна «О программе»: приняла ли система кнопки превью. */
function status() {
  return {
    platform: process.platform,
    supported: process.platform === 'win32',
    started: thumbStarted,
    ok: thumbOk,
    tries: thumbTries,
    tray: !!tray,
    mpris: !!mpris,
  };
}

module.exports = { setup, update, status };
