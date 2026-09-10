import md5 from './md5.js';
import { buildMockLibrary, cover as mockCover, LYRICS_LINES, MOCK_FOLDERS } from './mock.js';
import { lrclibLyrics, peekLyrics, sameLyrics, clearLyricsCache as dropLyricsCache, lrclibStats as readLyricsStats } from './lyrics.js';

const CLIENT = 'Spotidrome';
const API_VERSION = '1.16.1';
const REQUEST_TIMEOUT = 20000;   // мс, сколько ждём ответ сервера

function randSalt() {
  const a = new Uint8Array(8);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/* Приводим введённый пользователем адрес к базовому URL сервера:
   убираем hash-роут (#/album/...), query, хвост /rest, /app и слэши. */
export function normalizeServerUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    url.hash = '';
    url.search = '';
    let path = url.pathname
      .replace(/\/+$/, '')
      .replace(/\/rest(\/.*)?$/i, '')
      .replace(/\/app\/?$/i, '');
    url.pathname = path;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return u.replace(/[#?].*$/, '').replace(/\/+$/, '');
  }
}

class SubsonicClient {
  constructor() {
    this.creds = null;         // { url, username, password }
    this.demo = false;
    this.mock = null;
    this.musicFolderId = null; // выбранная музыкальная папка (библиотека)
  }

  setMusicFolder(id) {
    this.musicFolderId = (id === null || id === undefined || id === '') ? null : String(id);
  }

  configure(creds) {
    this.sessionSalt = null;
    this._skip = null;            // новый сервер — заново проверяем, какие эндпоинты текстов он умеет
    this.demo = !!creds?.demo;
    if (this.demo) {
      this.creds = { url: 'demo://', username: 'demo' };
      if (!this.mock) this.mock = buildMockLibrary();
      return;
    }
    const url = normalizeServerUrl(creds.url);
    this.creds = { ...creds, url };
  }

  get baseUrl() { return this.creds?.url || ''; }

  /**
   * @param {boolean} stable — использовать постоянную соль сессии.
   * Для картинок/стримов URL обязан быть стабильным, иначе ни HTTP-кэш,
   * ни наш дисковый кэш не сработают (каждый рендер давал бы новый адрес).
   */
  authParams(stable = false) {
    const salt = stable ? (this.sessionSalt || (this.sessionSalt = randSalt())) : randSalt();
    return {
      u: this.creds.username,
      t: md5((this.creds.password || '') + salt),
      s: salt,
      v: API_VERSION,
      c: CLIENT,
      f: 'json',
    };
  }

  /* Методы Subsonic, которые умеют фильтровать по музыкальной папке */
  static FOLDER_AWARE = new Set([
    'getAlbumList', 'getAlbumList2', 'getArtists', 'getIndexes', 'search2', 'search3',
    'getStarred', 'getStarred2', 'getRandomSongs', 'getSongsByGenre', 'getNowPlaying',
  ]);

  withFolder(method, params) {
    if (this.musicFolderId != null && SubsonicClient.FOLDER_AWARE.has(method) && params.musicFolderId == null) {
      return { ...params, musicFolderId: this.musicFolderId };
    }
    return params;
  }

  buildUrl(method, params = {}, stable = false) {
    const qs = new URLSearchParams({ ...this.authParams(stable), ...this.withFolder(method, params) });
    return `${this.baseUrl}/rest/${method}?${qs.toString()}`;
  }

  /** Стабильный ключ обложки для дискового кэша (без секретов в имени файла) */
  coverKey(coverArt, size = 300) {
    const host = (this.creds?.url || 'demo').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '');
    return `${host}_${String(coverArt).replace(/[^a-z0-9_-]/gi, '')}_${size}`;
  }

  /**
   * Ответ сервера → объект subsonic-response. Общая часть для обычных вызовов
   * и для «ручных» запросов с повторяющимися параметрами (updatePlaylist).
   */
  async readResponse(res) {
    if (res.status === 401 || res.status === 403) throw new Error('Неверный логин или пароль');
    if (!res.ok) throw new Error(`Сервер ответил ${res.status} ${res.statusText}`);

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const looksHtml = /^\s*</.test(text);
      const title = (text.match(/<title[^>]*>([^<]{1,60})<\/title>/i) || [])[1];
      throw new Error(
        looksHtml
          ? `По адресу ${this.baseUrl} отвечает веб-страница${title ? ` («${title.trim()}»)` : ''}, а не Subsonic API Navidrome. `
            + 'Похоже, это другой веб-клиент, а не сам сервер — укажите адрес самого Navidrome (обычно порт 4533), без /#/… и без /rest'
          : 'Сервер вернул некорректный ответ (это точно Navidrome?)'
      );
    }

    const r = json['subsonic-response'];
    if (!r) throw new Error('Это не Subsonic API: в ответе нет subsonic-response');
    if (r.status === 'failed') {
      const code = r.error?.code;
      const msg = code === 40 ? 'Неверный логин или пароль'
        : code === 41 ? 'Сервер требует другую схему аутентификации (LDAP?)'
        : code === 30 ? 'Сервер не поддерживает эту версию API'
        : (r.error?.message || 'Ошибка Subsonic API');
      throw new Error(msg);
    }
    return r;
  }

  async call(method, params = {}, { timeout = REQUEST_TIMEOUT } = {}) {
    if (this.demo) return this.mockCall(method, this.withFolder(method, params));
    if (!this.creds?.url) throw new Error('Не указан адрес сервера');

    // сервер может «висеть» без ответа — без таймаута интерфейс ждёт вечно
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeout));
    let res;
    try {
      res = await fetch(this.buildUrl(method, params), { signal: ctrl.signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error(`Сервер ${this.baseUrl} не ответил за ${Math.round(timeout / 1000)} с`);
      throw new Error(
        `Не удалось соединиться с ${this.baseUrl}. Проверьте адрес и доступность сервера` +
        (typeof window !== 'undefined' && !window.desktop ? ' (в обычном браузере запрос может блокировать CORS — используйте десктоп-версию)' : '')
      );
    } finally {
      clearTimeout(timer);
    }
    return this.readResponse(res);
  }

  /* --------------------- URLs --------------------- */
  coverUrl(coverArt, size = 300) {
    if (!coverArt) return mockCover('unknown', '?');
    if (this.demo) {
      const l = this.mock.albums.find((a) => a.id === coverArt) ||
        this.mock.artists.find((a) => a.coverArt === coverArt) ||
        this.mock.playlists.find((p) => p.id === coverArt);
      return mockCover(coverArt, l?.name || coverArt);
    }
    return this.buildUrl('getCoverArt', { id: coverArt, size }, true);
  }

  streamUrl(id, { maxBitRate = 0, format = 'raw' } = {}) {
    if (this.demo) return '';
    const p = { id, format };
    if (maxBitRate) p.maxBitRate = String(maxBitRate);
    return this.buildUrl('stream', p, true);
  }

  downloadUrl(id) { return this.demo ? '' : this.buildUrl('download', { id }, true); }

  /* --------------------- API --------------------- */
  async getMusicFolders() {
    try {
      const r = await this.call('getMusicFolders');
      return arr(r.musicFolders?.musicFolder).map((f) => ({ id: String(f.id), name: f.name || `Папка ${f.id}` }));
    } catch { return []; }
  }

  async ping() { const r = await this.call('ping'); return { ok: true, version: r.version, type: r.type, serverVersion: r.serverVersion }; }

  async albumList(type = 'newest', size = 30, offset = 0, extra = {}) {
    const r = await this.call('getAlbumList2', { type, size, offset, ...extra });
    return arr(r.albumList2?.album);
  }

  async getAlbum(id) {
    const r = await this.call('getAlbum', { id });
    const album = r.album || {};
    return { album, songs: arr(album.song) };
  }

  async getArtists() {
    const r = await this.call('getArtists');
    return arr(r.artists?.index).flatMap((i) => arr(i.artist));
  }

  async getArtist(id) {
    const r = await this.call('getArtist', { id });
    const artist = r.artist || {};
    return { artist, albums: arr(artist.album) };
  }

  async getArtistInfo(id) {
    try { const r = await this.call('getArtistInfo2', { id, count: 12 }); return r.artistInfo2 || {}; }
    catch { return {}; }
  }

  async getTopSongs(artistName, count = 10) {
    try { const r = await this.call('getTopSongs', { artist: artistName, count }); return arr(r.topSongs?.song); }
    catch { return []; }
  }

  /**
   * «Сейчас играют» — проигрыватели того же пользователя на других устройствах.
   * Subsonic отдаёт это одной пачкой; ошибок тут быть не должно: сервер может
   * не поддерживать метод, тогда просто пустой список.
   */
  async getNowPlaying() {
    try {
      const r = await this.call('getNowPlaying', {});
      return arr(r.nowPlaying?.entry).map((e) => ({
        id: e.id != null ? String(e.id) : '',
        username: e.username || '—',
        artist: e.artist || '',
        title: e.title || '',
        album: e.album || '',
        albumId: e.albumId || null,
        coverArt: e.coverArt || e.albumId || null,
        minutesAgo: Number(e.minutesAgo) || 0,
        playing: e.playing !== false,
        entryCount: Number(e.entryCount) || 0,
      }));
    } catch { return []; }
  }

  async getPlaylists() { const r = await this.call('getPlaylists'); return arr(r.playlists?.playlist); }

  async getPlaylist(id) {
    const r = await this.call('getPlaylist', { id });
    const pl = r.playlist || {};
    return { playlist: pl, songs: arr(pl.entry) };
  }

  async createPlaylist(name, songIds = []) {
    const p = { name };
    const r = await this.call('createPlaylist', songIds.length ? { ...p, songId: songIds } : p);
    return r.playlist;
  }

  /**
   * Правка плейлиста. Повторяющиеся параметры (songIdToAdd / songIndexToRemove)
   * URLSearchParams собрать не может, поэтому запрос собирается вручную — но
   * ответ проверяется так же, как в call(): иначе ошибка сервера («плейлист не
   * найден», «нет прав») выглядела бы как успешное добавление.
   */
  async updatePlaylist(playlistId, { name, comment, songIdToAdd = [], songIndexToRemove = [] } = {}) {
    if (this.demo) return this.mockCall('updatePlaylist', { playlistId, name, comment, songIdToAdd, songIndexToRemove });
    const p = { playlistId };
    if (name != null) p.name = name;
    if (comment != null) p.comment = comment;
    const qs = new URLSearchParams({ ...this.authParams(), ...p });
    songIdToAdd.forEach((i) => qs.append('songIdToAdd', i));
    songIndexToRemove.forEach((i) => qs.append('songIndexToRemove', i));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/rest/updatePlaylist?${qs}`, { signal: ctrl.signal });
    } catch (e) {
      throw e?.name === 'AbortError' ? new Error('Сервер не ответил на запрос правки плейлиста') : e;
    } finally {
      clearTimeout(timer);
    }
    return this.readResponse(res);
  }

  async deletePlaylist(id) { return this.call('deletePlaylist', { id }); }

  async search(query, { songCount = 40, albumCount = 20, artistCount = 20 } = {}) {
    const r = await this.call('search3', { query, songCount, albumCount, artistCount });
    return {
      artists: arr(r.searchResult3?.artist),
      albums: arr(r.searchResult3?.album),
      songs: arr(r.searchResult3?.song),
    };
  }

  async getStarred() {
    const r = await this.call('getStarred2');
    return {
      songs: arr(r.starred2?.song),
      albums: arr(r.starred2?.album),
      artists: arr(r.starred2?.artist),
    };
  }

  async star(id, kind = 'song') {
    const key = kind === 'album' ? 'albumId' : kind === 'artist' ? 'artistId' : 'id';
    return this.call('star', { [key]: id });
  }
  async unstar(id, kind = 'song') {
    const key = kind === 'album' ? 'albumId' : kind === 'artist' ? 'artistId' : 'id';
    return this.call('unstar', { [key]: id });
  }
  async setRating(id, rating) { return this.call('setRating', { id, rating }); }

  async scrobble(id, submission = true) {
    return this.call('scrobble', { id, submission: String(submission), time: String(Date.now()) });
  }

  async getRandomSongs(size = 50, extra = {}) {
    const r = await this.call('getRandomSongs', { size, ...extra });
    return arr(r.randomSongs?.song);
  }

  async getSimilarSongs(id, count = 30) {
    try { const r = await this.call('getSimilarSongs2', { id, count }); return arr(r.similarSongs2?.song); }
    catch { return []; }
  }

  async getGenres() { const r = await this.call('getGenres'); return arr(r.genres?.genre); }

  async getSongsByGenre(genre, count = 60) {
    const r = await this.call('getSongsByGenre', { genre, count });
    return arr(r.songsByGenre?.song);
  }

  /* ---------------- тексты песен ----------------
     1. OpenSubsonic getLyricsBySongId — то, что Navidrome нашёл в тегах/.lrc (уже синхронно).
     2. Legacy getLyrics — несинхронный текст из старых тегов.
     3. LRCLIB (https://lrclib.net) — открытая база синхронных текстов; даёт строки
        с таймкодами, а при наличии карате-версии — и пословную подсветку. */

  /** Только локальные тексты сервера (теги / .lrc), без внешних сервисов. */
  async localLyrics(song) {
    if (!song) return null;
    // серверы без OpenSubsonic отвечают 404/501 на каждый трек: запоминаем и не ходим туда снова
    if (!this._skip?.structured) {
      try {
        const r = await this.call('getLyricsBySongId', { id: song.id });
        const list = arr(r.lyricsList?.structuredLyrics);
        if (list.length) {
          const l = list.find((x) => x.synced) || list[0];
          const lines = arr(l.line)
            .map((x) => ({ start: x.start ?? null, text: x.value || '' }))
            .filter((x) => x.text !== '' || x.start != null);
          if (lines.length) return { synced: !!l.synced, lines, source: this.demo ? 'demo' : 'server' };
        }
      } catch (e) {
        if (/404|405|501|not found/i.test(String(e?.message || ''))) this._markSkip('structured');
      }
    }
    if (!this._skip?.legacy) {
      try {
        const r = await this.call('getLyrics', { artist: song.artist, title: song.title });
        const text = r.lyrics?.value || r.lyrics?.['#text'] || '';
        if (text.trim()) return { synced: false, lines: text.split('\n').map((t) => ({ start: null, text: t })), source: this.demo ? 'demo' : 'server' };
      } catch (e) {
        if (/404|405|501|not found/i.test(String(e?.message || ''))) this._markSkip('legacy');
      }
    }
    return null;
  }

  _markSkip(which) {
    this._skip = { ...(this._skip || {}), [which]: true };
  }

  /**
   * Текст для трека: сервер + LRCLIB.
   * @param {object} song
   * @param {{ lrclib?: boolean, force?: boolean, light?: boolean }} opts
   *        lrclib:false — не ходить в сеть; force — забыть кэш и найти заново;
   *        light — минимум запросов (для предзагрузки следующих треков в очереди)
   */
  async getLyrics(song, opts = {}) {
    if (!song) return null;
    const local = await this.localLyrics(song).catch(() => null);
    const mayUseNet = opts.lrclib !== false && (!this.demo || opts.force);
    if (!mayUseNet) return local;

    // свой синхронный текст с сервера надёжнее чужого — LRCLIB не трогаем
    if (local?.synced && !opts.force) return local;

    const net = await lrclibLyrics(song, { force: opts.force, light: opts.light });
    if (!net) return local;
    // «инструментал» в базе не отменяет локальный текст
    if (net.instrumental && !net.lines?.length) return local || net;
    // был несинхронный текст из тегов: подменяем только если это те же самые слова
    if (local && !local.synced && net.synced && !sameLyrics(local.lines, net.lines)) return local;
    if (local && local.synced && !net.synced) return local;
    return net;
  }

  /** Есть ли уже готовый текст в кэше LRCLIB (для предзагрузки очереди). */
  lyricsReady(song) { return !!peekLyrics(song); }
  clearLyricsCache() { return dropLyricsCache(); }
  lyricsStats() { return { ...readLyricsStats(), demo: this.demo }; }


  /* --------------------- MOCK --------------------- */
  mockCall(method, p) {
    const m = this.mock;
    const wrap = (o) => ({ status: 'ok', version: API_VERSION, type: 'demo', ...o });
    const byId = (id) => m.songs.find((s) => s.id === id);
    const fid = p.musicFolderId != null ? String(p.musicFolderId) : null;
    const inFolder = (x) => !fid || String(x.folderId) === fid;
    const albums = m.albums.filter(inFolder);
    const songs = m.songs.filter(inFolder);
    const artistIds = new Set(albums.map((a) => a.artistId));
    const artists = m.artists.filter((a) => !fid || artistIds.has(a.id));
    switch (method) {
      case 'ping': return wrap({ serverVersion: 'demo' });
      case 'getMusicFolders': return wrap({ musicFolders: { musicFolder: MOCK_FOLDERS } });
      case 'getAlbumList2': {
        let list = [...albums];
        if (p.type === 'random') list.sort(() => Math.random() - 0.5);
        if (p.type === 'newest') list.sort((a, b) => b.year - a.year);
        if (p.type === 'frequent' || p.type === 'recent') list.sort(() => Math.random() - 0.5);
        if (p.type === 'starred') list = list.filter((a) => a.starred);
        if (p.type === 'alphabeticalByName') list.sort((a, b) => a.name.localeCompare(b.name));
        return wrap({ albumList2: { album: list.slice(p.offset || 0, (p.offset || 0) + (p.size || 30)) } });
      }
      case 'getAlbum': {
        const album = m.albums.find((a) => a.id === p.id);
        return wrap({ album: { ...album, song: m.songs.filter((s) => s.albumId === p.id) } });
      }
      case 'getArtists': return wrap({ artists: { index: [{ name: '#', artist: artists }] } });
      case 'getArtist': {
        const artist = m.artists.find((a) => a.id === p.id);
        return wrap({ artist: { ...artist, album: m.albums.filter((al) => al.artistId === p.id) } });
      }
      case 'getArtistInfo2': {
        const artist = m.artists.find((a) => a.id === p.id);
        return wrap({ artistInfo2: { biography: artist?.bio, similarArtist: m.artists.filter((a) => a.id !== p.id).slice(0, 8) } });
      }
      case 'getTopSongs': {
        const a = m.artists.find((x) => x.name === p.artist);
        return wrap({ topSongs: { song: m.songs.filter((s) => s.artistId === a?.id).slice(0, p.count || 10) } });
      }
      case 'getPlaylists': return wrap({ playlists: { playlist: m.playlists.map(({ entry, ...r }) => r) } });
      case 'getPlaylist': return wrap({ playlist: m.playlists.find((x) => x.id === p.id) });
      case 'getNowPlaying': {
        // демо: показываем, что трек играет ещё на одном «устройстве»
        const s0 = m.songs[(Date.now() / 60000 | 0) % m.songs.length];
        return wrap({ nowPlaying: { entry: [{ ...s0, username: 'demo-tv', minutesAgo: 0, playing: true, entryCount: 1, coverArt: s0.albumId }] } });
      }
      case 'createPlaylist': {
        const pl = { id: `pl-${m.playlists.length}`, name: p.name, owner: 'demo', public: false, coverArt: `pl-${m.playlists.length}`, songCount: 0, duration: 0, entry: [], created: new Date().toISOString() };
        // сервер умеет создать плейлист сразу с треками — и демо не должно их терять
        arr(p.songId).forEach((id) => { const s = byId(id); if (s) pl.entry.push(s); });
        pl.songCount = pl.entry.length;
        pl.duration = pl.entry.reduce((acc, x) => acc + (x.duration || 0), 0);
        m.playlists.push(pl); return wrap({ playlist: pl });
      }
      case 'updatePlaylist': {
        const pl = m.playlists.find((x) => x.id === p.playlistId);
        if (pl) {
          if (p.name) pl.name = p.name;
          if (p.comment != null) pl.comment = p.comment;
          (p.songIdToAdd || []).forEach((id) => { const s = byId(id); if (s) pl.entry.push(s); });
          (p.songIndexToRemove || []).slice().sort((a, b) => b - a).forEach((i) => pl.entry.splice(i, 1));
          pl.songCount = pl.entry.length;
          pl.duration = pl.entry.reduce((s, x) => s + x.duration, 0);
        }
        return wrap({});
      }
      case 'deletePlaylist': {
        const i = m.playlists.findIndex((x) => x.id === p.id);
        if (i >= 0) m.playlists.splice(i, 1);
        return wrap({});
      }
      case 'search3': {
        const q = String(p.query || '').toLowerCase().trim();
        if (!q) return wrap({ searchResult3: {} });
        return wrap({ searchResult3: {
          artist: artists.filter((a) => a.name.toLowerCase().includes(q)).slice(0, p.artistCount),
          album: albums.filter((a) => (a.name + a.artist).toLowerCase().includes(q)).slice(0, p.albumCount),
          song: songs.filter((s) => (s.title + s.artist + s.album).toLowerCase().includes(q)).slice(0, p.songCount),
        } });
      }
      case 'getStarred2': return wrap({ starred2: {
        song: songs.filter((s) => s.starred), album: albums.filter((a) => a.starred), artist: [],
      } });
      case 'star': case 'unstar': {
        const on = method === 'star' ? new Date().toISOString() : undefined;
        const id = p.id || p.albumId || p.artistId;
        [...m.songs, ...m.albums, ...m.artists].forEach((x) => { if (x.id === id) x.starred = on; });
        return wrap({});
      }
      case 'getRandomSongs': return wrap({ randomSongs: { song: [...songs].sort(() => Math.random() - 0.5).slice(0, p.size) } });
      case 'getSimilarSongs2': return wrap({ similarSongs2: { song: [...m.songs].sort(() => Math.random() - 0.5).slice(0, p.count) } });
      case 'getGenres': {
        const g = {};
        songs.forEach((s) => { g[s.genre] = (g[s.genre] || 0) + 1; });
        return wrap({ genres: { genre: Object.entries(g).map(([value, songCount]) => ({ value, songCount })) } });
      }
      case 'getSongsByGenre': return wrap({ songsByGenre: { song: songs.filter((s) => s.genre === p.genre).slice(0, p.count) } });
      case 'getLyricsBySongId': {
        const song = byId(p.id);
        // раскладываем строки по фактической длительности трека — как настоящий .lrc
        const total = Math.max(60, song?.duration || 180);
        const first = Math.round(total * 0.08) + 6;
        const last = Math.round(total * 0.9);
        const step = Math.max(4, (last - first) / Math.max(1, LYRICS_LINES.length - 1));
        const lines = LYRICS_LINES.map((text, i) => ({ start: Math.round((first + i * step) * 1000), value: text }));
        return wrap({ lyricsList: { structuredLyrics: [{ synced: true, displayTitle: song?.title, line: lines }] } });
      }
      case 'scrobble': case 'setRating': return wrap({});
      default: return wrap({});
    }
  }
}

export const api = new SubsonicClient();
export default api;
