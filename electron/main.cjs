const { app, BrowserWindow, dialog, ipcMain, session, shell, globalShortcut, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const http = require('node:http');

const isDev = !app.isPackaged;

// Windows опознаёт приложение в панели задач по AppUserModelID: без него
// кнопки на превью, всплывашки и группировка окна могут вести себя странно.
if (process.platform === 'win32') {
  try { app.setAppUserModelId('app.spotidrome.desktop'); } catch { /* no-op */ }
}
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const userDir = () => app.getPath('userData');
const cfgPath = () => path.join(userDir(), 'config.json');
const cacheDir = () => path.join(userDir(), 'offline');
const coversDir = () => path.join(userDir(), 'covers');
// Исключённые («дизлайкнутые») треки лежат отдельной папкой — её удобно
// забэкапить, скопировать на другую машину или поправить руками.
const dislikesDir = () => path.join(userDir(), 'dislikes');
const dislikesFile = () => path.join(dislikesDir(), 'dislikes.json');
const mediaControls = require('./mediaControls.cjs');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(obj) {
  try {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(cfgPath(), JSON.stringify(obj, null, 2));
    return true;
  } catch (e) { return false; }
}

let win = null;

/* ---------- мини-плеер ---------- */
// До каких размеров вообще разрешено ужимать окно
const MINI_MIN_W = 248;
const MINI_MIN_H = 96;
// Размер окна, который включается кнопкой «мини-плеер»
const MINI_W = 360;
const MINI_H = 452;
// Размеры «обычного» окна, если возвращаться из мини-режима некуда
const FULL_W = 1280;
const FULL_H = 820;
let fullBounds = null;   // куда вернуться из мини-режима

function isMini() {
  if (!win) return false;
  const [w, h] = win.getSize();
  return w <= MINI_W + 60 && h <= MINI_H + 60;
}

function setMini(on, opts = {}) {
  if (!win || win.isDestroyed()) return false;
  if (win.isFullScreen()) win.setFullScreen(false);
  if (on) {
    if (!isMini()) fullBounds = win.getBounds();
    if (win.isMaximized()) win.unmaximize();
    const w = Math.max(MINI_MIN_W, Math.round(opts.width || MINI_W));
    const h = Math.max(MINI_MIN_H, Math.round(opts.height || MINI_H));
    // прижимаем к правому нижнему углу текущего экрана
    const { screen } = require('electron');
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds({
      x: Math.round(area.x + area.width - w - 24),
      y: Math.round(area.y + area.height - h - 24),
      width: w,
      height: h,
    }, false);
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    const b = fullBounds || { width: FULL_W, height: FULL_H };
    if (fullBounds) {
      win.setBounds(fullBounds, false);
    } else {
      win.setSize(b.width, b.height, false);
      win.center();
    }
    fullBounds = null;
  }
  return on;
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Окно можно ужать до полоски мини-плеера: интерфейс сам переключится
    // на компактную раскладку (см. src/lib/useCompact.js).
    minWidth: MINI_MIN_W,
    minHeight: MINI_MIN_H,
    backgroundColor: '#000000',
    // Своя рамка: на macOS оставляем «светофор», на Windows/Linux рисуем кнопки сами
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 18, y: 22 } : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // управление треком снаружи окна: панель задач / трей / MPRIS / док
  mediaControls.setup(win, { coversDir: coversDir() });

  const sendState = () => {
    if (!win || win.isDestroyed()) return;
    const [w, h] = win.getSize();
    win.webContents.send('win:state', {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
      focused: win.isFocused(),
      alwaysOnTop: win.isAlwaysOnTop(),
      width: w,
      height: h,
    });
  };
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'always-on-top-changed', 'resized'].forEach((ev) => win.on(ev, sendState));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// Navidrome обычно не отдаёт CORS-заголовки для произвольного origin.
// Подменяем заголовки ответов, чтобы работал fetch + Web Audio (эквалайзер).
function patchCors() {
  const filter = { urls: ['*://*/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, cb) => {
    const headers = details.responseHeaders || {};
    for (const k of Object.keys(headers)) {
      if (/^access-control-allow-(origin|headers|methods|credentials)$/i.test(k)) delete headers[k];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET,POST,OPTIONS'];
    cb({ responseHeaders: headers });
  });
}

function registerMediaKeys() {
  const map = {
    MediaPlayPause: 'playpause',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  };
  for (const [key, action] of Object.entries(map)) {
    try { globalShortcut.register(key, () => win && win.webContents.send('media-key', action)); } catch {}
  }
}

/* ---------- offline download ---------- */
const MAX_REDIRECTS = 5;

/**
 * Скачивание в tmp-файл с последующей атомарной заменой.
 * Ходим только по http/https (main-процесс не должен открывать по запросу
 * интерфейса произвольные схемы), редиректы считаем и не уходим в цикл.
 */
function download(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Некорректный адрес загрузки')); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return reject(new Error('Разрешены только http/https'));
    if (depth > MAX_REDIRECTS) return reject(new Error('Слишком много редиректов'));

    const mod = parsed.protocol === 'https:' ? https : http;
    const tmp = dest + '.part';
    const cleanup = () => fs.unlink(tmp, () => {});
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return download(next, dest, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        try {
          if (fs.statSync(tmp).size === 0) { cleanup(); return reject(new Error('Пустой ответ сервера')); }
          fs.renameSync(tmp, dest);
          resolve(dest);
        } catch (e) { cleanup(); reject(e); }
      }));
      file.on('error', (e) => { cleanup(); reject(e); });
      res.on('error', (e) => { file.destroy(); cleanup(); reject(e); });
    });
    req.on('error', (e) => { cleanup(); reject(e); });
    req.setTimeout(60000, () => { req.destroy(new Error('Таймаут загрузки')); });
  });
}

/**
 * Имя файла из URL кастомной схемы.
 * Важно: для «стандартных» схем Chromium превращает `cover:///name.img`
 * в `cover://name.img/`, поэтому имя может оказаться и в host, и в pathname.
 */
function fileFromUrl(rawUrl) {
  const u = new URL(rawUrl);
  const joined = `${u.hostname || ''}/${u.pathname || ''}`;
  const name = decodeURIComponent(joined).split('/').filter(Boolean).pop() || '';
  return path.basename(name);
}

// Кастомная схема offline:// для проигрывания скачанных треков
protocol.registerSchemesAsPrivileged([
  { scheme: 'offline', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);

function registerOfflineProtocol() {
  protocol.handle('offline', async (request) => {
    try {
      const name = fileFromUrl(request.url);
      const file = path.join(cacheDir(), name);
      if (!file.startsWith(cacheDir())) return new Response('forbidden', { status: 403 });
      return net.fetch('file://' + file.split(path.sep).join('/'));
    } catch (e) {
      return new Response('not found', { status: 404 });
    }
  });
}

/** Определяем тип картинки по сигнатуре — сервер мог отдать что угодно */
function sniffImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 3 && buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 5).toString().trim().startsWith('<svg') || buf.slice(0, 5).toString().startsWith('<?xml')) return 'image/svg+xml';
  return 'image/jpeg';
}

function registerCoverProtocol() {
  protocol.handle('cover', async (request) => {
    try {
      const name = fileFromUrl(request.url);
      const file = path.join(coversDir(), name);
      if (!file.startsWith(coversDir()) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
      const buf = await fsp.readFile(file);
      return new Response(buf, {
        status: 200,
        headers: {
          'content-type': sniffImageType(buf),
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

app.whenReady().then(() => {
  patchCors();
  registerOfflineProtocol();
  registerCoverProtocol();
  createWindow();
  registerMediaKeys();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

/* ---------------- выгрузка текста в файл ----------------
   Список треков, список исключённых — всё, что клиент умеет отдать текстом.
   Диалог сохранения системный, поэтому человек сам выбирает, куда положить
   файл; отмена — не ошибка. */

ipcMain.handle('file:saveText', async (_e, { name = 'file.txt', text = '', ext = 'txt' } = {}) => {
  try {
    const res = await dialog.showSaveDialog(win, {
      title: 'Сохранить файл',
      defaultPath: path.join(app.getPath('downloads'), String(name)),
      filters: [{ name: 'Текстовый файл', extensions: [String(ext).replace(/^\./, '')] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    await fsp.writeFile(res.filePath, String(text), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_e, obj) => writeConfig(obj));

/* ---------------- исключённые треки ---------------- */

ipcMain.handle('dislikes:get', async () => {
  try {
    const raw = await fsp.readFile(dislikesFile(), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.tracks || []);
  } catch { return []; }
});

ipcMain.handle('dislikes:set', async (_e, list) => {
  try {
    await fsp.mkdir(dislikesDir(), { recursive: true });
    const payload = {
      app: 'Spotidrome',
      note: 'Треки, исключённые из подборок и очереди. Можно править вручную.',
      updated: new Date().toISOString(),
      count: Array.isArray(list) ? list.length : 0,
      tracks: Array.isArray(list) ? list : [],
    };
    const tmp = dislikesFile() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2));
    await fsp.rename(tmp, dislikesFile());          // атомарная замена
    return true;
  } catch { return false; }
});

ipcMain.handle('dislikes:path', () => dislikesFile());

ipcMain.handle('dislikes:reveal', async () => {
  try {
    await fsp.mkdir(dislikesDir(), { recursive: true });
    if (fs.existsSync(dislikesFile())) shell.showItemInFolder(dislikesFile());
    else shell.openPath(dislikesDir());
    return true;
  } catch { return false; }
});

ipcMain.handle('offline:list', async () => {
  try {
    await fsp.mkdir(cacheDir(), { recursive: true });
    const files = await fsp.readdir(cacheDir());
    const out = {};
    for (const f of files) {
      if (f.endsWith('.part')) continue;
      const st = await fsp.stat(path.join(cacheDir(), f));
      out[path.parse(f).name] = { size: st.size, file: f, url: `offline:///${encodeURIComponent(f)}` };
    }
    return out;
  } catch { return {}; }
});

ipcMain.handle('offline:save', async (_e, { id, url, ext }) => {
  await fsp.mkdir(cacheDir(), { recursive: true });
  // id приходит с сервера — имя файла чистим, чтобы «../» не утащило запись за пределы кэша
  const safeId = String(id == null ? '' : id).replace(/[^a-z0-9_-]/gi, '');
  if (!safeId) return { ok: false, error: 'bad id' };
  const dest = path.join(cacheDir(), `${safeId}.${(ext || 'mp3').replace(/[^a-z0-9]/gi, '')}`);
  if (fs.existsSync(dest)) return { ok: true, file: path.basename(dest), url: `offline:///${encodeURIComponent(path.basename(dest))}`, size: fs.statSync(dest).size };
  await download(url, dest);
  const st = await fsp.stat(dest);
  return { ok: true, file: path.basename(dest), url: `offline:///${encodeURIComponent(path.basename(dest))}`, size: st.size };
});

ipcMain.handle('audio:base64', async (_e, { url, maxBytes } = {}) => {
  // интерфейс не может вытянуть звук через fetch: сервер Navidrome не отдаёт
  // CORS-заголовки. Из main-процесса запрос идёт мимо браузерных правил.
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return { ok: false, error: 'Некорректный адрес' }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, error: 'Разрешены только http/https' };
  const cap = Math.min(Math.max(Number(maxBytes) || 0, 0) || 150 * 1024 * 1024, 400 * 1024 * 1024);
  try {
    const buf = await getBuffer(parsed.toString(), cap);
    return { ok: true, base64: buf.toString('base64'), mime: 'audio/mpeg', size: buf.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

/** Скачиваем <= cap байт в память; больше лимита — обрываем и говорим об этом. */
function getBuffer(url, cap, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > MAX_REDIRECTS) return reject(new Error('Слишком много редиректов'));
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return getBuffer(new URL(res.headers.location, url).toString(), cap, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > cap) { req.destroy(); return reject(new Error('Файл больше лимита')); }
        chunks.push(c);
      });
      res.on('end', () => (size ? resolve(Buffer.concat(chunks)) : reject(new Error('Пустой ответ сервера'))));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Таймаут загрузки')));
  });
}

ipcMain.handle('offline:remove', async (_e, id) => {
  const files = await fsp.readdir(cacheDir()).catch(() => []);
  for (const f of files) if (path.parse(f).name === id) await fsp.unlink(path.join(cacheDir(), f)).catch(() => {});
  return true;
});

ipcMain.handle('offline:clear', async () => {
  await fsp.rm(cacheDir(), { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(cacheDir(), { recursive: true }).catch(() => {});
  return true;
});

/* ---------- кэш обложек ---------- */
const coverJobs = new Map();

ipcMain.handle('cover:get', async (_e, { key, url }) => {
  const safe = String(key || '').replace(/[^a-z0-9_-]/gi, '');
  if (!safe || !url) return { ok: false };
  const dest = path.join(coversDir(), `${safe}.img`);
  const localUrl = `cover:///${encodeURIComponent(path.basename(dest))}`;
  if (fs.existsSync(dest)) return { ok: true, url: localUrl, cached: true };

  if (!coverJobs.has(safe)) {
    coverJobs.set(safe, (async () => {
      await fsp.mkdir(coversDir(), { recursive: true });
      await download(url, dest);
      if ((await fsp.stat(dest)).size === 0) throw new Error('empty');
      })().finally(() => coverJobs.delete(safe)));
  }
  try {
    await coverJobs.get(safe);
    return { ok: true, url: localUrl, cached: false };
  } catch {
    await fsp.unlink(dest).catch(() => {});
    return { ok: false };
  }
});

ipcMain.handle('cover:stats', async () => {
  try {
    const files = await fsp.readdir(coversDir()).catch(() => []);
    let bytes = 0, count = 0;
    for (const f of files) {
      const st = await fsp.stat(path.join(coversDir(), f)).catch(() => null);
      if (st?.isFile()) { bytes += st.size; count++; }
    }
    return { count, bytes };
  } catch { return { count: 0, bytes: 0 }; }
});

ipcMain.handle('cover:clear', async () => {
  await fsp.rm(coversDir(), { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(coversDir(), { recursive: true }).catch(() => {});
  return true;
});

ipcMain.handle('win:toggleFullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
/* из полноэкранного режима окно сворачивается только после выхода из него:
   иначе (прежде всего на macOS) вызов просто игнорируется */
ipcMain.handle('win:minimize', () => {
  if (!win) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  win.minimize();
});
ipcMain.handle('win:maximizeToggle', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('win:isMaximized', () => !!win && win.isMaximized());

/* мини-плеер: ужать окно в угол экрана поверх остальных и обратно */
ipcMain.handle('win:mini', (_e, payload = {}) => {
  const on = payload.on == null ? !isMini() : !!payload.on;
  setMini(on, payload);
  return on;
});
ipcMain.handle('win:isMini', () => isMini());
ipcMain.handle('win:setAlwaysOnTop', (_e, on) => {
  if (!win) return false;
  const v = on == null ? !win.isAlwaysOnTop() : !!on;
  win.setAlwaysOnTop(v, v ? 'floating' : 'normal');
  return v;
});
ipcMain.handle('win:isAlwaysOnTop', () => !!win && win.isAlwaysOnTop());
/* точный размер окна из renderer'а — для «ужать ещё» кнопками мини-плеера */
ipcMain.handle('win:resize', (_e, { width, height } = {}) => {
  if (!win) return false;
  const w = Math.max(MINI_MIN_W, Math.round(width || win.getSize()[0]));
  const h = Math.max(MINI_MIN_H, Math.round(height || win.getSize()[1]));
  if (win.isMaximized()) win.unmaximize();
  win.setSize(w, h, false);
  return true;
});

ipcMain.handle('win:taskbarStatus', () => mediaControls.status());

/* состояние плеера из renderer'а — для кнопок на панели задач, трея и MPRIS */
ipcMain.on('player:state', (_e, state) => mediaControls.update(state));
