/**
 * Muzyka w tle z analizą widma dla pierścieni w hero.
 *
 * Przeglądarki nie wypuszczają dźwięku bez gestu użytkownika, więc odtwarzanie
 * rusza przy pierwszym kliknięciu, dotknięciu albo klawiszu, a nie przy wejściu
 * na stronę. Do tego czasu nie powstaje nawet AudioContext — utworzony wcześniej
 * i tak zostałby wstrzymany, a Chrome zgłaszałby ostrzeżenie w konsoli.
 *
 * Analiza idzie PRZED regulacją głośności: pierścienie reagują na nagranie,
 * a nie na to, jak głośno gra.
 */

const STORAGE_KEY = 'draug:sound';
/** zdarzenia, które przeglądarka uznaje za aktywację; `pointerdown` wystarcza
 *  dla myszy, dla dotyku dopiero `pointerup` / `touchend` */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'];

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePreference(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // tryb prywatny / zablokowane dane strony — preferencja po prostu nie przetrwa
  }
}

export class BackgroundSound {
  /**
   * @param {string} src
   * @param {{volume?: number, fftSize?: number}} [options]
   */
  constructor(src, { volume = 0.5, fftSize = 4096 } = {}) {
    this.audio = new Audio();
    this.audio.src = src;
    this.audio.loop = true;
    // 7,6 MB — pobierany dopiero przy pierwszym odtworzeniu, strumieniowo
    this.audio.preload = 'none';
    this.volume = volume;
    this.fftSize = fftSize;
    this.enabled = readPreference();
    this.ctx = null;
    this.analysers = null;
    this.listeners = new Set();
    this.resumeOnShow = false;

    this._onGesture = this._onGesture.bind(this);
    for (const type of ['play', 'playing', 'pause', 'ended']) {
      this.audio.addEventListener(type, () => this._emit());
    }
    document.addEventListener('visibilitychange', () => this._onVisibility());
    if (this.enabled) this._bindGestures();
  }

  /** gra i kontekst audio faktycznie przetwarza próbki */
  isPlaying() {
    return !this.audio.paused && (!this.ctx || this.ctx.state === 'running');
  }

  /** szerokość jednego przedziału FFT w Hz; 0, dopóki nie ma kontekstu */
  get binHz() {
    return this.ctx ? this.ctx.sampleRate / this.fftSize : 0;
  }

  get binCount() {
    return this.fftSize / 2;
  }

  /**
   * Widmo kanału: 'left', 'right' albo 'mid' (suma). Wartości 0–255 w skali
   * decybelowej między `minDecibels` a `maxDecibels` analizatora.
   * @returns {boolean} czy dane są aktualne
   */
  spectrum(channel, out) {
    const analyser = this.analysers?.[channel];
    if (!analyser || !this.isPlaying()) return false;
    analyser.getByteFrequencyData(out);
    return true;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    writePreference(enabled);
    if (enabled) {
      this._bindGestures();
      this._start();
    } else {
      this._unbindGestures();
      this.audio.pause();
    }
    this._emit();
  }

  /**
   * Przycisk włącz / wyłącz. `aria-pressed` mówi o preferencji, a
   * `data-state` o tym, co naprawdę się dzieje — między kliknięciem
   * „włącz” a pierwszym gestem muzyka jeszcze czeka.
   */
  bindToggle(button) {
    if (!button) return;
    const sync = () => {
      const state = !this.enabled ? 'off' : this.isPlaying() ? 'playing' : 'waiting';
      button.dataset.state = state;
      button.setAttribute('aria-pressed', String(this.enabled));
      button.title = this.enabled ? 'Wyłącz muzykę w tle' : 'Włącz muzykę w tle';
    };
    button.addEventListener('click', () => this.setEnabled(!this.enabled));
    this.onChange(sync);
    sync();
  }

  // ── wewnętrzne ─────────────────────────────────────────────

  _emit() {
    for (const listener of this.listeners) listener(this);
  }

  _bindGestures() {
    for (const type of GESTURES) document.addEventListener(type, this._onGesture, true);
  }

  _unbindGestures() {
    for (const type of GESTURES) document.removeEventListener(type, this._onGesture, true);
  }

  _onGesture() {
    this._start();
  }

  _onVisibility() {
    if (document.hidden) {
      this.resumeOnShow = !this.audio.paused;
      this.audio.pause();
    } else if (this.resumeOnShow && this.enabled) {
      this.resumeOnShow = false;
      this._start();
    }
  }

  _start() {
    if (!this.enabled || document.hidden) return;
    this._ensureGraph();
    // Bez `await` na resume(): bez aktywacji Chrome zostawia tę obietnicę
    // w zawieszeniu aż do następnego gestu, więc czekanie na nią blokowałoby
    // kolejne próby. O powodzeniu rozstrzyga play(), które bez aktywacji
    // odrzuca od razu.
    this.ctx?.resume().catch(() => {});
    this.audio.play().then(
      () => this._unbindGestures(),
      () => {}, // brak aktywacji albo przerwane pauzą — czekamy na następny gest
    );
  }

  _ensureGraph() {
    if (this.ctx) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      // bez Web Audio: sama muzyka, pierścienie zostają w spoczynku
      this.audio.volume = this.volume;
      return;
    }

    const ctx = new Context();
    const source = ctx.createMediaElementSource(this.audio);

    const out = ctx.createGain();
    out.gain.value = this.volume;
    source.connect(out).connect(ctx.destination);

    const analyser = () => {
      const node = ctx.createAnalyser();
      node.fftSize = this.fftSize;
      node.smoothingTimeConstant = 0.7;
      node.minDecibels = -92;
      node.maxDecibels = -22;
      return node;
    };

    // Analizator sam miksuje wejście do mono, więc „środek” to wprost źródło.
    const mid = analyser();
    source.connect(mid);

    // Rozdzielacz kanałów interpretuje wejście dyskretnie: nagranie mono
    // trafiłoby wyłącznie na lewe wyjście, a prawy głośnik by milczał.
    // Węzeł z interpretacją 'speakers' rozkłada mono na oba kanały.
    const stereo = new GainNode(ctx, {
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    const split = ctx.createChannelSplitter(2);
    const left = analyser();
    const right = analyser();
    source.connect(stereo).connect(split);
    split.connect(left, 0);
    split.connect(right, 1);

    ctx.addEventListener('statechange', () => this._emit());
    this.ctx = ctx;
    this.analysers = { left, mid, right };
  }
}
