import { clamp } from '../slider/math.js';
import { bandLevel } from './spectrum.js';

/**
 * Retro analizator widma za zdjęciem w sekcji „Jak powstał DAW”: siatka
 * poziomych segmentów „diod”, minimalnie jaśniejszych od tła, w której słupki
 * zapalają całe segmenty od dołu — jak w starym korektorze graficznym. Siatka
 * zaczyna się nad dolną krawędzią zdjęcia (odstęp `bottom`) i sięga dokładnie
 * górnej.
 *
 * Kolumny to pasma tercjowe ISO 266 od 31,5 Hz do 16 kHz, wiersze — poziom.
 * Nad słupkiem zostaje znacznik szczytu: trzyma się chwilę, potem opada.
 * Kalibracja widma ta sama co w pierścieniach (src/audio/spectrum.js), a bufor
 * widma na klatkę wspólny (`frameSpectrum`), więc wszystkie efekty czytają
 * utwór tak samo i analiza liczy się raz.
 *
 * Zdjęcie jest wycinanką na przezroczystym tle (43 % pikseli w pełni
 * przezroczystych), więc siatka prześwituje nad stanowiskiem, po bokach i pod
 * biurkiem — jak ściana za nim.
 */

/** środki pasm tercjowych ISO 266 — jak na korektorze graficznym */
const BANDS = [
  31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
];
/** połowa tercji: brzegi pasma to fc · 2^(±1/6) */
const EDGE = 2 ** (1 / 6);

const GRID = {
  /** szczelina między kolumnami jako ułamek podziałki poziomej */
  gap: 0.22,
  /**
   * Wysokość wiersza jako ułamek podziałki poziomej — segmenty są poziomymi
   * prostokątami, ok. 3 : 1. Liczba wierszy jest zaokrąglana tak, żeby
   * wypełniły wysokość co do piksela, więc ta wartość jest przybliżona.
   */
  row: 0.4,
  /** szczelina między wierszami jako ułamek podziałki pionowej */
  rowGap: 0.3,
  /** odstęp siatki od dolnej krawędzi zdjęcia, jako ułamek jego wysokości */
  bottom: 0.08,
  /** segment zgaszony — minimalnie jaśniejszy od tła sekcji */
  off: 'rgba(232, 236, 232, 0.035)',
  /**
   * Krycie zapalonych segmentów: najniższy i najwyższy wiersz. Dół musi być
   * wyraźny — zdjęcie odsłania go po bokach pod biurkiem, a przy 0,12
   * zapalony segment ledwie odróżniał się od zgaszonego (0,035).
   */
  lit: [0.24, 0.36],
  /** krycie znacznika szczytu */
  peak: 0.5,
  /** stałe czasowe słupka: narost i opadanie, s */
  attack: 0.03,
  release: 0.22,
  /** jak długo szczyt stoi, zanim zacznie opadać, s */
  hold: 0.5,
  /** tempo opadania szczytu, pełnej wysokości na sekundę */
  fall: 0.7,
  /** budżet pikseli canvasu */
  maxPixels: 3e6,
};
const LIME = '200,255,61';

export class SpectrumGrid {
  /**
   * @param {HTMLElement} stage pudełko zdjęcia — canvas kładzie się pod nim
   * @param {import('./BackgroundSound.js').BackgroundSound} sound
   */
  constructor(stage, sound, { reducedMotion = false } = {}) {
    this.stage = stage;
    this.sound = sound;
    this.reducedMotion = reducedMotion;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'spectrum-grid';
    this.canvas.setAttribute('aria-hidden', 'true');
    stage.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    // siatka zgaszonych segmentów rysowana raz, przy zmianie rozmiaru
    this.base = document.createElement('canvas');

    const n = BANDS.length;
    this.level = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.peakAge = new Float32Array(n);

    this.visible = false;
    this.raf = 0;
    this.last = 0;
    this._frame = this._frame.bind(this);

    new ResizeObserver(() => this.resize()).observe(stage);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (!this.visible && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.last = 0;
      }
      this._wake();
    }).observe(this.canvas);
    sound.onChange(() => this._wake());
    this.resize();
  }

  resize() {
    const box = this.stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const k = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(GRID.maxPixels / (box.width * box.height)));
    const W = Math.round(box.width * k);
    const H = Math.round(box.height * k);
    for (const c of [this.canvas, this.base]) {
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
    }

    // Segmenty w pikselach urządzenia i na całych pikselach — retro „dioda” ma
    // mieć ostre krawędzie. Kolumn tyle, ile pasm. Wiersze liczone od dołu:
    // wypełniają dokładnie pas od odstępu `bottom` do górnej krawędzi, a
    // szczelina leży pod każdym segmentem, więc najwyższy zaczyna się równo
    // na krawędzi.
    const cols = BANDS.length;
    const pitch = W / cols;
    const gap = Math.max(1, Math.round(pitch * GRID.gap));
    const floor = H - Math.round(H * GRID.bottom);
    const rows = Math.max(1, Math.round(floor / (pitch * GRID.row)));
    const rowPitch = floor / rows;
    const rowGap = Math.max(1, Math.round(rowPitch * GRID.rowGap));
    this.xs = Array.from({ length: cols }, (_, c) => {
      const x0 = Math.round(c * pitch + gap / 2);
      return [x0, Math.round((c + 1) * pitch - gap / 2) - x0];
    });
    this.ys = Array.from({ length: rows }, (_, r) => {
      const y0 = Math.round(floor - (r + 1) * rowPitch);
      return [y0, Math.round(floor - r * rowPitch) - rowGap - y0];
    });
    this.rows = rows;
    this.rowStyles = Array.from({ length: rows }, (_, r) => {
      const t = rows > 1 ? r / (rows - 1) : 0;
      return `rgba(${LIME},${(GRID.lit[0] + (GRID.lit[1] - GRID.lit[0]) * t).toFixed(3)})`;
    });

    const b = this.base.getContext('2d');
    b.clearRect(0, 0, W, H);
    b.fillStyle = GRID.off;
    for (const [y, h] of this.ys) for (const [x, w] of this.xs) b.fillRect(x, y, w, h);
    this._draw();
  }

  _wake() {
    if (this.raf || !this.visible || this.reducedMotion) return;
    this.raf = requestAnimationFrame(this._frame);
  }

  _frame(now) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;

    const data = this.sound.frameSpectrum('mid', now);
    const binHz = this.sound.binHz;
    const attack = 1 - Math.exp(-dt / GRID.attack);
    const release = 1 - Math.exp(-dt / GRID.release);
    let energy = 0;
    for (let i = 0; i < BANDS.length; i += 1) {
      const target = data ? bandLevel(data, binHz, BANDS[i] / EDGE, BANDS[i] * EDGE) : 0;
      const current = this.level[i];
      const value = current + (target - current) * (target > current ? attack : release);
      this.level[i] = value;

      // szczyt: skacze do słupka, stoi `hold`, potem opada
      if (value >= this.peak[i]) {
        this.peak[i] = value;
        this.peakAge[i] = 0;
      } else {
        this.peakAge[i] += dt;
        if (this.peakAge[i] > GRID.hold) this.peak[i] = Math.max(value, this.peak[i] - GRID.fall * dt);
      }
      energy += value + this.peak[i];
    }
    this._draw();

    // po zatrzymaniu muzyki słupki i szczyty opadają do zera, potem pętla gaśnie
    if (this.visible && (data || energy > 1e-3)) this.raf = requestAnimationFrame(this._frame);
    else this.last = 0;
  }

  _draw() {
    const { ctx, canvas, rows } = this;
    if (!this.xs) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0);

    // zapalone segmenty: słupek zapala całe segmenty, bez ułamków — jeden
    // kolor na wiersz, więc zmian stylu jest tyle, ile wierszy
    const lit = Array.from(this.level, (v) => Math.round(clamp(v, 0, 1) * rows));
    for (let r = 0; r < rows; r += 1) {
      const [y, h] = this.ys[r];
      let any = false;
      for (let c = 0; c < lit.length; c += 1) {
        if (lit[c] <= r) continue;
        if (!any) {
          ctx.fillStyle = this.rowStyles[r];
          any = true;
        }
        const [x, w] = this.xs[c];
        ctx.fillRect(x, y, w, h);
      }
      if (!any) break;
    }

    // znaczniki szczytu — jeden segment nad słupkiem
    ctx.fillStyle = `rgba(${LIME},${GRID.peak})`;
    for (let c = 0; c < lit.length; c += 1) {
      const p = Math.round(clamp(this.peak[c], 0, 1) * rows) - 1;
      if (p < lit[c] || p < 0) continue;
      const [x, w] = this.xs[c];
      const [y, h] = this.ys[Math.min(p, rows - 1)];
      ctx.fillRect(x, y, w, h);
    }
  }
}
