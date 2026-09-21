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
const VOLUME_KEY = 'draug:volume';
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

function readVolume(fallback) {
  try {
    const stored = Number.parseFloat(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : fallback;
  } catch {
    return fallback;
  }
}

function writeVolume(volume) {
  try {
    localStorage.setItem(VOLUME_KEY, volume.toFixed(3));
  } catch {
    // jak wyżej
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
   * @param {{volume?: number, fftSize?: number, bpm?: number, downbeat?: number}} [options]
   *   `bpm` i `downbeat` (czas pierwszej „raz” w pliku, w sekundach) opisują
   *   siatkę rytmiczną tego konkretnego utworu — bez nich `beatPosition()`
   *   zwraca null.
   */
  constructor(src, { volume = 0.5, fftSize = 4096, bpm = 0, downbeat = 0 } = {}) {
    this.audio = new Audio();
    this.audio.src = src;
    this.audio.loop = true;
    // Sam nagłówek pliku — odtwarzacz w nagłówku strony pokazuje długość
    // utworu, zanim ktokolwiek go włączy. Resztę (7,6 MB) przeglądarka
    // pobiera strumieniowo dopiero przy odtwarzaniu.
    this.audio.preload = 'metadata';
    /** wartość domyślna gałki — do niej wraca dwuklik */
    this.defaultVolume = volume;
    this.volume = readVolume(volume);
    this.output = null;
    this.fftSize = fftSize;
    this.bpm = bpm;
    this.downbeat = downbeat;
    this.enabled = readPreference();
    this.ctx = null;
    this.analysers = null;
    /** bufory widma na bieżącą klatkę, po jednym na kanał */
    this.frames = {};
    this.listeners = new Set();
    this.resumeOnShow = false;

    this._onGesture = this._onGesture.bind(this);
    for (const type of ['play', 'playing', 'pause', 'ended']) {
      this.audio.addEventListener(type, () => this._emit());
    }
    document.addEventListener('visibilitychange', () => this._onVisibility());
    if (this.enabled) this._bindGestures();
  }

  /**
   * Odtwarzanie zlecone — `paused` przestawia się synchronicznie w `play()`,
   * zanim ruszy dźwięk. Do decyzji „play czy pauza” pod przyciskiem, gdzie
   * `isPlaying()` potrafi jeszcze przez chwilę mówić „nie”.
   */
  isActive() {
    return !this.audio.paused;
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
   * Widmo kanału ('left', 'right' albo 'mid' — suma) dla danej klatki.
   * Wartości 0–255 w skali decybelowej między `minDecibels` a `maxDecibels`.
   *
   * Kilka scen w tej samej klatce dostaje ten sam bufor: `stamp` to znacznik
   * czasu z `requestAnimationFrame`, wspólny dla wszystkich wywołań zwrotnych
   * jednej klatki, więc analiza każdego kanału liczy się raz, nawet gdy na
   * ekranie są i hero, i sekcja agenta. Bufor jest współdzielony — tylko
   * do odczytu.
   * @returns {Uint8Array | null} null, gdy nic nie gra
   */
  frameSpectrum(channel, stamp) {
    const analyser = this.analysers?.[channel];
    if (!analyser || !this.isPlaying()) return null;
    let slot = this.frames[channel];
    if (!slot) {
      slot = { stamp: -1, data: new Uint8Array(analyser.frequencyBinCount) };
      this.frames[channel] = slot;
    }
    if (slot.stamp !== stamp) {
      analyser.getByteFrequencyData(slot.data);
      slot.stamp = stamp;
    }
    return slot.data;
  }

  /**
   * Pozycja w siatce rytmicznej: liczba uderzeń od pierwszej „raz” (ułamkowa),
   * więc `Math.floor(p) % 4` to numer uderzenia w takcie 4/4.
   *
   * Czas pomniejszony o opóźnienie wyjścia (`baseLatency + outputLatency`):
   * `currentTime` mówi, co dekoder oddał do grafu, a słychać to dopiero po tym
   * opóźnieniu — bez poprawki obraz wyprzedzałby dźwięk o kilkadziesiąt ms.
   * @returns {number | null} null, gdy nic nie gra albo utwór nie ma tempa
   */
  beatPosition() {
    if (!this.bpm || !this.isPlaying()) return null;
    const latency = this.ctx ? (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0) : 0;
    return ((this.audio.currentTime - latency - this.downbeat) * this.bpm) / 60;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** głośność 0–1, liniowo — 0,5 to połowa amplitudy */
  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    writeVolume(this.volume);
    if (this.output) {
      // krótki poślizg zamiast skoku — skok wzmocnienia słychać jako trzask
      this.output.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    } else if (this.ctx === false) {
      this.audio.volume = this.volume;
    }
    this._emit();
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
    button.dataset.soundControl = '';
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

  _onGesture(event) {
    // Przyciski sterujące dźwiękiem same decydują, co zrobić. Bez tego
    // `pointerdown` na „pauzie” najpierw startowałby muzykę, a `click` zaraz
    // potem ją zatrzymywał — albo odwrotnie, zależnie od tego, czy kontekst
    // audio zdążył ruszyć między tymi zdarzeniami.
    if (event.target instanceof Element && event.target.closest('[data-sound-control]')) return;
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
    if (this.ctx) this.ctx.resume().catch(() => {});
    this.audio.play().then(
      () => this._unbindGestures(),
      () => {}, // brak aktywacji albo przerwane pauzą — czekamy na następny gest
    );
  }

  _ensureGraph() {
    if (this.ctx !== null) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      // bez Web Audio: sama muzyka, pierścienie zostają w spoczynku;
      // `false` odróżnia „brak obsługi” od „jeszcze nie utworzono”
      this.ctx = false;
      this.audio.volume = this.volume;
      return;
    }

    const ctx = new Context();
    const source = ctx.createMediaElementSource(this.audio);

    const out = ctx.createGain();
    out.gain.value = this.volume;
    source.connect(out).connect(ctx.destination);
    this.output = out;

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
