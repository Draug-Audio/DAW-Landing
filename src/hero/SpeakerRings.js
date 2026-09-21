import { clamp } from '../slider/math.js';

/**
 * Pierścienie w tle hero jako kolumny głośnikowe.
 *
 * Każda grupa współśrodkowych okręgów to jedna kolumna z wielodrożną zwrotnicą:
 * największy pierścień dostaje najniższe pasmo (woofer), najmniejszy najwyższe
 * (tweeter) — tak, jak dzieli pasmo fizyczna kolumna, gdzie wielkość membrany
 * odpowiada długości fali. Grupy ułożone od lewej do prawej grają kanał lewy,
 * sumę i prawy.
 *
 * Wzdłuż każdego pierścienia biegnie jego pasmo w skali logarytmicznej,
 * lustrzanie po obu stronach: najniższe częstotliwości pasma na dole, najwyższe
 * u góry. Do tego pierścień „oddycha” jak membrana — wychylenie rośnie z mocą
 * pasma i maleje ku tweeterowi, który w prawdziwej kolumnie prawie się nie rusza.
 *
 * Geometria jest czytana z SVG w markupie, więc układ okręgów żyje w jednym
 * miejscu, a bez JS strona pokazuje po prostu statyczne okręgi. W ciszy canvas
 * rysuje dokładnie to samo co SVG.
 */

const TAU = Math.PI * 2;

/** zakres, który dzielą między siebie przetworniki jednej kolumny */
const RANGE = [40, 15000];
/**
 * Korekcja nachylenia widma, w dB na oktawę względem 1 kHz. Muzyka traci
 * energię ku górze — w tym utworze ok. 4,7 dB/okt. poniżej 1 kHz i 7,7 powyżej
 * (zmierzone na średnich oktawowych). Bez korekcji tweeter prawie nie drgał
 * (średnio 0,02 przy 0,5 wooferu). 6 dB/okt. wyrównuje utwór do 0,39–0,47
 * w całym paśmie; analizatory studyjne stosują podobnie 3–6 dB/okt.
 */
const TILT_DB = 6;
/** zakres analizatora w dB (`maxDecibels - minDecibels` w BackgroundSound) */
const RANGE_DB = 70;
/**
 * Bramka ciszy przed korekcją, w jednostkach analizatora (0–255, ok. 0,27 dB
 * na jednostkę). Korekcja podnosi górę pasma nawet o 0,33 skali, więc bez
 * bramki pusty przedział — ponad pasmem mp3 albo w ciszy — przechodził próg
 * i tweeter stał na stałej, zerowej w rzeczywistości kresce.
 */
const SILENCE = 16;
/** okno odpowiedzi po korekcji (0–1 w skali dB analizatora): poniżej FLOOR —
 *  szum tła, od CEIL — pełne wychylenie */
const FLOOR = 0.22;
const CEIL = 0.7;
/** wygięcie odpowiedzi; powyżej 1 tłumi tło, a akcenty zostawia */
const CURVE = 1.6;
/** stałe czasowe: narost szybki jak transjent, opadanie jak wybrzmienie */
const ATTACK = 0.028;
const RELEASE = 0.2;
/** progi jasności kresek — każdy rysowany jedną ścieżką */
const BUCKETS = 5;
/** budżet pikseli canvasu; pierścienie są cienkie i dalekie od ostrości UI */
const MAX_PIXELS = 4.2e6;
const LIME = '200,255,61';

/**
 * Pasma zwrotnicy dla `n` przetworników — równe w skali logarytmicznej.
 * Dla trzech przetworników daje punkty podziału ok. 290 Hz i 2,1 kHz, czyli
 * w okolicy typowych wartości kolumn trójdrożnych.
 */
function crossover(n) {
  const [lo, hi] = RANGE;
  const ratio = hi / lo;
  return Array.from({ length: n }, (_, i) => [lo * ratio ** (i / n), lo * ratio ** ((i + 1) / n)]);
}

function readSpeakers(svg) {
  const groups = new Map();
  for (const circle of svg.querySelectorAll('circle')) {
    const cx = Number(circle.getAttribute('cx'));
    const cy = Number(circle.getAttribute('cy'));
    const key = `${cx},${cy}`;
    if (!groups.has(key)) groups.set(key, { cx, cy, rings: [] });
    groups.get(key).rings.push({
      r: Number(circle.getAttribute('r')),
      color: circle.getAttribute('stroke') || '#1c2118',
    });
  }

  const list = [...groups.values()].sort((a, b) => a.cx - b.cx);
  return list.map((group, index) => {
    // skrajne grupy grają swoje kanały, reszta — sumę
    let channel = 'mid';
    if (list.length >= 3 && index === 0) channel = 'left';
    else if (list.length >= 3 && index === list.length - 1) channel = 'right';

    group.rings.sort((a, b) => b.r - a.r);
    const bands = crossover(group.rings.length);
    const last = Math.max(1, group.rings.length - 1);
    const drivers = group.rings.map((ring, j) => makeDriver(ring, bands[j], j / last));
    return { cx: group.cx, cy: group.cy, channel, drivers, data: null };
  });
}

/**
 * @param {number} t pozycja w kolumnie: 0 = woofer, 1 = tweeter
 */
function makeDriver({ r, color }, band, t) {
  // kreska co ok. 14 px obwodu, parzyście, bo pierścień jest lustrzany
  const count = 2 * Math.round(clamp((TAU * r) / 14, 40, 200) / 2);
  const half = count / 2;
  const dirs = new Float32Array(half * 4);
  for (let k = 0; k < half; k += 1) {
    const frac = (k + 0.5) / half;
    // na dole (π/2) najniższe częstotliwości pasma, u góry najwyższe
    const right = Math.PI / 2 - frac * Math.PI;
    const left = Math.PI / 2 + frac * Math.PI;
    dirs[k * 4] = Math.cos(right);
    dirs[k * 4 + 1] = Math.sin(right);
    dirs[k * 4 + 2] = Math.cos(left);
    dirs[k * 4 + 3] = Math.sin(left);
  }
  const [f0, f1] = band;
  const edges = new Float32Array(half + 1);
  for (let k = 0; k <= half; k += 1) edges[k] = f0 * (f1 / f0) ** (k / half);

  return {
    r,
    color,
    band,
    half,
    dirs,
    edges,
    values: new Float32Array(half),
    level: 0,
    // nachylenie wyrównuje energię pasm; to lekkie podbicie jest tylko dla oka —
    // cienka kreska na małym pierścieniu czyta się słabiej niż gruba na dużym
    gain: 1 + 0.15 * t,
    reach: 12 + r * 0.06,
    excursion: 9 - 7.5 * t,
    alpha: 0.26 + 0.18 * t,
    width: 1.6 - 0.6 * t,
    map: null,
    mapHz: 0,
    tilt: null,
  };
}

/** pozycje brzegów pasm w indeksach FFT — liczone raz na częstotliwość próbkowania */
function binMap(driver, binHz) {
  const map = new Float32Array(driver.half * 2);
  const tilt = new Float32Array(driver.half);
  for (let k = 0; k < driver.half; k += 1) {
    map[k * 2] = driver.edges[k] / binHz;
    map[k * 2 + 1] = driver.edges[k + 1] / binHz;
    const center = Math.sqrt(driver.edges[k] * driver.edges[k + 1]);
    tilt[k] = (TILT_DB * Math.log2(center / 1000)) / RANGE_DB;
  }
  driver.map = map;
  driver.tilt = tilt;
  driver.mapHz = binHz;
}

export class SpeakerRings {
  /**
   * @param {SVGSVGElement} svg statyczne okręgi z markupu — źródło geometrii
   * @param {import('../audio/BackgroundSound.js').BackgroundSound} sound
   */
  constructor(svg, sound, { reducedMotion = false } = {}) {
    this.svg = svg;
    this.sound = sound;
    this.reducedMotion = reducedMotion;
    this.speakers = readSpeakers(svg);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hero__spectrum';
    this.canvas.setAttribute('aria-hidden', 'true');
    svg.after(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    // `visibility`, nie `hidden` — pudełko SVG zostaje, bo z niego liczymy
    // przeliczenie współrzędnych na canvas
    svg.style.visibility = 'hidden';

    for (const speaker of this.speakers) speaker.data = new Uint8Array(sound.binCount);

    this.visible = true;
    this.raf = 0;
    this.last = 0;
    this._frame = this._frame.bind(this);

    new ResizeObserver(() => this.resize()).observe(this.canvas);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this._wake();
    }).observe(this.canvas);
    sound.onChange(() => this._wake());
    this.resize();
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const svgBox = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;

    const k = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (box.width * box.height)));
    this.canvas.width = Math.round(box.width * k);
    this.canvas.height = Math.round(box.height * k);
    this.k = k;

    // preserveAspectRatio domyślnie xMidYMid meet: jedna skala, wyśrodkowanie
    const s = Math.min(svgBox.width / vb.width, svgBox.height / vb.height);
    this.s = s;
    this.ox = svgBox.left - box.left + (svgBox.width - vb.width * s) / 2 - vb.x * s;
    this.oy = svgBox.top - box.top + (svgBox.height - vb.height * s) / 2 - vb.y * s;
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

    const binHz = this.sound.binHz;
    let live = false;
    let energy = 0;
    for (const speaker of this.speakers) {
      const fresh = this.sound.spectrum(speaker.channel, speaker.data);
      if (fresh) live = true;
      for (const driver of speaker.drivers) {
        energy += this._update(driver, fresh ? speaker.data : null, binHz, dt);
      }
    }
    this._draw();

    // gdy muzyka stanie, pierścienie wybrzmiewają do zera i pętla gaśnie
    if (this.visible && (live || energy > 1e-3)) this.raf = requestAnimationFrame(this._frame);
    else this.last = 0;
  }

  _update(driver, data, binHz, dt) {
    if (data && driver.mapHz !== binHz) binMap(driver, binHz);
    const { values, map, tilt, half, gain } = driver;
    const top = data ? data.length - 2 : 0;
    const attack = 1 - Math.exp(-dt / ATTACK);
    const release = 1 - Math.exp(-dt / RELEASE);
    let sum = 0;

    for (let k = 0; k < half; k += 1) {
      let target = 0;
      if (data) {
        const lo = map[k * 2];
        const hi = map[k * 2 + 1];
        let v;
        if (hi - lo < 1) {
          // pasmo węższe niż przedział FFT (niskie tony) — interpolacja
          const c = clamp((lo + hi) / 2, 0, top);
          const i = Math.floor(c);
          v = data[i] + (data[i + 1] - data[i]) * (c - i);
        } else {
          // szersze — maksimum, żeby transjenty nie rozmywały się w średniej
          v = 0;
          const end = Math.min(Math.floor(hi), top);
          for (let i = Math.ceil(lo); i <= end; i += 1) if (data[i] > v) v = data[i];
        }
        if (v > SILENCE) {
          const x = clamp((v / 255 + tilt[k] - FLOOR) / (CEIL - FLOOR), 0, 1);
          target = Math.min(1, x ** CURVE * gain);
        }
      }
      const current = values[k];
      values[k] = current + (target - current) * (target > current ? attack : release);
      sum += values[k];
    }

    driver.level = sum / half;
    return driver.level;
  }

  _draw() {
    const { ctx, canvas, k, s } = this;
    if (!k) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k * s, 0, 0, k * s, k * this.ox, k * this.oy);
    const px = 1 / s; // 1 px CSS w jednostkach viewBoxa
    ctx.lineCap = 'butt';

    for (const speaker of this.speakers) {
      const { cx, cy } = speaker;
      for (const driver of speaker.drivers) {
        // membrana: wychylenie z mocą pasma
        const r = driver.r + driver.level * driver.excursion * px;
        ctx.lineWidth = px;
        ctx.strokeStyle = driver.color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();

        if (driver.level < 1e-3) continue;
        this._drawBars(driver, cx, cy, r + 3 * px, px);
      }
    }
  }

  /** kreski widma, pogrupowane jasnością — jedna ścieżka na próg */
  _drawBars(driver, cx, cy, base, px) {
    const { ctx } = this;
    const { values, dirs, half, reach, alpha, width } = driver;
    ctx.lineWidth = width * px;
    for (let b = 0; b < BUCKETS; b += 1) {
      const lo = b / BUCKETS;
      const hi = (b + 1) / BUCKETS;
      const top = b === BUCKETS - 1;
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < half; i += 1) {
        const v = values[i];
        if (v < 0.02 || v < lo || (v >= hi && !top)) continue;
        const end = base + v * reach * px;
        const o = i * 4;
        ctx.moveTo(cx + dirs[o] * base, cy + dirs[o + 1] * base);
        ctx.lineTo(cx + dirs[o] * end, cy + dirs[o + 1] * end);
        ctx.moveTo(cx + dirs[o + 2] * base, cy + dirs[o + 3] * base);
        ctx.lineTo(cx + dirs[o + 2] * end, cy + dirs[o + 3] * end);
        any = true;
      }
      if (!any) continue;
      ctx.strokeStyle = `rgba(${LIME},${(alpha * hi).toFixed(3)})`;
      ctx.stroke();
    }
  }
}
