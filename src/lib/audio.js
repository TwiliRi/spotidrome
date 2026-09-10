/* Аудио-движок: HTMLAudioElement + WebAudio (10-полосный эквалайзер, преамп, анализатор).
   В демо-режиме используется виртуальный таймер вместо реального потока. */

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/* Громкость: положение ползунка (0..1) — это не коэффициент усиления.
 * Слух воспринимает громкость логарифмически, поэтому линейная шкала «орёт»
 * уже на 20-30% ползунка. Переводим положение в усиление по степенной кривой:
 *   50%  → 0.21 (примерно -13 дБ)
 *   25%  → 0.046 (-27 дБ)
 * Внизу шкалы появляется нормальный запас для тихой настройки. */
export const VOLUME_CURVE = 2.25;
export function volumeToGain(pos) {
  const p = Math.max(0, Math.min(1, Number(pos) || 0));
  return p <= 0 ? 0 : Math.pow(p, VOLUME_CURVE);
}
/** Обратное преобразование: усиление → положение ползунка. */
export function gainToVolume(gain) {
  const g = Math.max(0, Math.min(1, Number(gain) || 0));
  return g <= 0 ? 0 : Math.pow(g, 1 / VOLUME_CURVE);
}
/** Подпись для подсказки на ползунке. */
export function volumeLabel(pos) {
  return `${Math.round(Math.max(0, Math.min(1, pos || 0)) * 100)}%`;
}

export const EQ_PRESETS = {
  'Плоский': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Бас-буст': [7, 6, 5, 2, 0, 0, 0, 0, 0, 0],
  'Вокал': [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
  'Рок': [5, 4, 2, 0, -1, 0, 2, 4, 5, 5],
  'Электроника': [6, 5, 1, 0, -2, 1, 2, 4, 5, 6],
  'Классика': [4, 3, 2, 0, 0, 0, -1, -1, 2, 3],
  'Ночь': [-3, -2, 0, 2, 3, 3, 1, -1, -3, -4],
};

class AudioEngine {
  constructor() {
    this.el = null;
    this.ctx = null;
    this.source = null;
    this.filters = [];
    this.preamp = null;
    this.analyser = null;
    this.listeners = new Set();
    this.demo = false;
    this.demoTimer = null;
    this.demoTime = 0;
    this.demoDuration = 0;
    this.demoPlaying = false;
    this.eqEnabled = false;
    this.bands = [];              // последние значения полос, чтобы вернуть их при включении
    this.preampDb = 0;
    this.graphError = '';         // почему не удалось построить граф (пусто — всё хорошо)
    this.volumePos = 1;
  }

  init() {
    if (this.el) return;
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.volume = volumeToGain(this.volumePos);
    this.el = el;
    el.addEventListener('timeupdate', () => this.emit('time', el.currentTime));
    el.addEventListener('durationchange', () => this.emit('duration', el.duration || 0));
    el.addEventListener('ended', () => this.emit('ended'));
    el.addEventListener('play', () => this.emit('playing', true));
    el.addEventListener('pause', () => this.emit('playing', false));
    el.addEventListener('waiting', () => this.emit('buffering', true));
    el.addEventListener('canplay', () => this.emit('buffering', false));
    el.addEventListener('error', () => this.emit('error', el.error?.message || 'Ошибка воспроизведения'));
  }

  ensureGraph() {
    if (this.ctx || !this.el) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.source = this.ctx.createMediaElementSource(this.el);
      this.preamp = this.ctx.createGain();
      this.filters = EQ_FREQS.map((f, i) => {
        const b = this.ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.0;
        b.gain.value = 0;
        return b;
      });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.8;

      let node = this.source;
      node.connect(this.preamp);
      node = this.preamp;
      for (const f of this.filters) { node.connect(f); node = f; }
      node.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.graphError = '';
      // контекст мог появиться уже после того, как эквалайзер настроили
      if (this.eqEnabled) { this.applyBands(this.bands); this.setPreamp(this.preampDb); }
    } catch (e) {
      // создать AudioContext не вышло (например, не хватило ресурсов) —
      // пробуем позже при следующем воспроизведении, звук идёт мимо фильтров
      this.ctx = null;
      this.filters = [];
      this.graphError = e?.message || String(e);
    }
  }

  on(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit(type, payload) { this.listeners.forEach((l) => l(type, payload)); }

  setDemo(on, duration = 0) {
    this.demo = on;
    if (on) { this.demoDuration = duration; this.demoTime = 0; }
    else this.stopDemoTimer();
  }

  startDemoTimer() {
    this.stopDemoTimer();
    this.demoPlaying = true;
    this.emit('playing', true);
    let last = performance.now();
    this.demoTimer = setInterval(() => {
      const now = performance.now();
      this.demoTime += (now - last) / 1000;
      last = now;
      if (this.demoTime >= this.demoDuration) { this.stopDemoTimer(); this.emit('ended'); return; }
      this.emit('time', this.demoTime);
    }, 250);
  }

  stopDemoTimer() {
    if (this.demoTimer) clearInterval(this.demoTimer);
    this.demoTimer = null;
    if (!this.demoPlaying) return;              // иначе заглушки вроде setDemo(false)
    this.demoPlaying = false;                   // роняют «паузу» во время реальной игры
    this.emit('playing', false);
  }

  async load(url, { duration = 0, autoplay = true } = {}) {
    this.init();
    if (this.demo) {
      this.demoDuration = duration || 210;
      this.demoTime = 0;
      this.emit('duration', this.demoDuration);
      this.emit('time', 0);
      if (autoplay) this.startDemoTimer(); else this.stopDemoTimer();
      return;
    }
    // пустая ссылка — это ошибка, а не «демо»: иначе таймер показывает прогресс,
    // а звука нет, и пользователь думает, что плеер сломался
    if (!url) {
      this.emit('error', 'Нет ссылки на трек: проверьте доступ к серверу или офлайн-файл');
      return;
    }
    this.demo = false;
    this.stopDemoTimer();
    this.el.src = url;
    this.el.load();
    if (autoplay) await this.play();
  }

  async play() {
    if (this.demo) { if (!this.demoPlaying) this.startDemoTimer(); return; }
    this.init();
    this.ensureGraph();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    try { await this.el.play(); } catch (e) { this.emit('error', 'Не удалось запустить воспроизведение'); }
  }

  pause() {
    if (this.demo) { this.stopDemoTimer(); return; }
    this.el?.pause();
  }

  get playing() { return this.demo ? this.demoPlaying : !!(this.el && !this.el.paused && !this.el.ended); }
  get currentTime() { return this.demo ? this.demoTime : (this.el?.currentTime || 0); }
  get duration() { return this.demo ? this.demoDuration : (this.el?.duration || 0); }

  seek(t) {
    if (this.demo) { this.demoTime = Math.max(0, Math.min(t, this.demoDuration)); this.emit('time', this.demoTime); return; }
    if (this.el && isFinite(t)) this.el.currentTime = t;
  }

  /** Принимает ПОЛОЖЕНИЕ ползунка 0..1, кривую применяет сама. */
  setVolume(pos) {
    this.volumePos = Math.max(0, Math.min(1, Number(pos) || 0));
    if (this.el) this.el.volume = volumeToGain(this.volumePos);
  }
  setMuted(m) { if (this.el) this.el.muted = m; }

  setEqEnabled(on) {
    this.eqEnabled = !!on;
    this.ensureGraph();
    if (this.eqEnabled) this.applyBands(this.bands);
    else this.filters.forEach((f) => { f.gain.value = 0; });
    this.applyPreamp();
  }

  setBandGain(i, db) {
    this.ensureGraph();
    const f = this.filters[i];
    if (f && this.eqEnabled) f.gain.value = db;
  }

  applyBands(bands) {
    if (Array.isArray(bands)) this.bands = bands.slice();
    this.ensureGraph();
    if (!this.eqEnabled) return;
    const list = this.bands || [];
    list.forEach((db, i) => { if (this.filters[i]) this.filters[i].gain.value = db; });
  }

  /** Усиление до фильтров. При выключенном эквалайзере граф не должен трогать звук. */
  setPreamp(db) {
    this.preampDb = Number(db) || 0;
    this.ensureGraph();
    this.applyPreamp();
  }

  applyPreamp() {
    if (!this.preamp) return;
    const db = this.eqEnabled ? this.preampDb : 0;
    this.preamp.gain.value = Math.pow(10, db / 20);
  }

  getSpectrum(out) {
    if (!this.analyser) return null;
    const data = out || new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }
}

export const engine = new AudioEngine();
export default engine;
