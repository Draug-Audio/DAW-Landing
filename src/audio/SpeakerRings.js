import { clamp } from '../slider/math.js';

/**
 * Dekoracyjne okręgi jako kolumny głośnikowe.
 *
 * Każda grupa współśrodkowych okręgów to jedna kolumna z wielodrożną zwrotnicą:
 * największy pierścień dostaje najniższe pasmo (woofer), najmniejszy najwyższe
 * (tweeter) — tak, jak dzieli pasmo fizyczna kolumna, gdzie wielkość membrany
 * odpowiada długości fali. Grupy ułożone od lewej do prawej grają kanał lewy,
 * sumę i prawy.
 *
 * Wzdłuż każdego pierścienia biegnie jego pasmo w skali logarytmicznej,
 * lustrzanie po obu stronach: najniższe częstotliwości pasma na dole, najwyższe
 * u góry. Widmo odkształca sam pierścień — w każdym kierunku promień rośnie
 * o wartość częstotliwości, która na ten kąt przypada — a linia jaśnieje
 * limonką w miarę głośności pasma. Do tego cały pierścień „oddycha” jak
 * membrana: wychylenie rośnie z mocą pasma i maleje ku tweeterowi, który
 * w prawdziwej kolumnie prawie się nie rusza.
 *
 * Każda kolumna to osobny `<svg data-speaker>` z okręgami wokół (0, 0),
 * pozycjonowany w CSS — tak samo w hero i w sekcji agenta, więc obie sekcje
 * renderuje ta sama ścieżka (`svgSpeakers`). Układ okręgów żyje w markupie
 * i CSS, a bez JS strona pokazuje po prostu statyczne SVG. W ciszy canvas
 * rysuje dokładnie to samo.
 *
 * Każda scena ma własną pętlę, bramkowaną widocznością — animuje się tylko
 * sekcja, która jest na ekranie (albo obie, gdy widać obie). Widmo liczy się
 * raz na klatkę, nawet gdy scen jest kilka (`BackgroundSound.frameSpectrum`).
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
/** budżet pikseli canvasu; pierścienie są cienkie i dalekie od ostrości UI */
const MAX_PIXELS = 4.2e6;
const LIME = '200,255,61';

/** maksymalne odkształcenie pierścienia widmem, w px */
const reachFor = (r) => 12 + r * 0.06;
/** maksymalne wychylenie całego pierścienia (membrana), w px */
const EXCURSION = 9;
/** ile miejsca pierścień potrzebuje ponad swój promień, żeby się nie przyciąć */
const ringMargin = (r) => reachFor(r) + EXCURSION + 2;

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

/**
 * Grupy okręgów → kolumny. Grupa to jeden SVG, więc podział jest jawny
 * w markupie, a nie zgadywany ze wspólnych środków.
 * @param {{cx: number, cy: number, rings: {r: number, color: string}[]}[]} groups w px canvasu
 */
function buildSpeakers(groups) {
  const sorted = [...groups].sort((a, b) => a.cx - b.cx);
  return sorted.map((group, index) => {
    // skrajne kolumny grają swoje kanały, reszta — sumę
    let channel = 'mid';
    if (sorted.length >= 3 && index === 0) channel = 'left';
    else if (sorted.length >= 3 && index === sorted.length - 1) channel = 'right';

    const rings = [...group.rings].sort((a, b) => b.r - a.r);
    const bands = crossover(rings.length);
    const last = Math.max(1, rings.length - 1);
    const drivers = rings.map((ring, j) => makeDriver(ring, bands[j], j / last));
    return { cx: group.cx, cy: group.cy, channel, drivers };
  });
}

/**
 * @param {number} t pozycja w kolumnie: 0 = woofer, 1 = tweeter
 */
function makeDriver({ r, color }, band, t) {
  // próbka co ok. 14 px obwodu, parzyście, bo pierścień jest lustrzany
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
    /** wartości po wygładzeniu przestrzennym — z nich liczony jest kształt */
    shape: new Float32Array(half),
    /** punkty obrysu: prawa strona od dołu do góry, lewa z góry na dół */
    pts: new Float32Array(count * 2),
    level: 0,
    // nachylenie wyrównuje energię pasm; to lekkie podbicie jest tylko dla oka —
    // cienka linia na małym pierścieniu czyta się słabiej niż gruba na dużym
    gain: 1 + 0.15 * t,
    reach: reachFor(r),
    excursion: EXCURSION - 7.5 * t,
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

// ── źródło geometrii ─────────────────────────────────────────

/**
 * Kolumny z `svg[data-speaker]` w kontenerze — hero i sekcja agenta są
 * zbudowane identycznie, więc to jedyne źródło geometrii.
 *
 * Kontener dostaje jeden canvas na szerokość okna; jego pion jest dopasowywany
 * do zasięgu pierścieni razem z zapasem na odkształcenie, bo kolumny wychodzą
 * poza sekcję (w hero — nad nią, w sekcji agenta — w rogach i szerokością).
 * Kolor okręgu czytany raz z wyliczonego `stroke`, więc może pochodzić z
 * atrybutu albo z CSS. Klasa `is-live` chowa SVG (`visibility`, nie
 * `display` — ich pudełka są potrzebne do pomiaru).
 */
export function svgSpeakers(container) {
  const groups = [...container.querySelectorAll('svg[data-speaker]')].map((svg) => ({
    svg,
    rings: [...svg.querySelectorAll('circle')].map((circle) => ({
      cx: Number(circle.getAttribute('cx') || 0),
      cy: Number(circle.getAttribute('cy') || 0),
      r: Number(circle.getAttribute('r')),
      color: getComputedStyle(circle).stroke,
    })),
  }));

  const canvas = document.createElement('canvas');
  canvas.className = 'speakers__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  container.classList.add('is-live');

  return {
    canvas,
    watch: [container],
    measure() {
      const cb = container.getBoundingClientRect();
      const placed = [];
      let top = Infinity;
      let bottom = -Infinity;
      for (const { svg, rings } of groups) {
        const box = svg.getBoundingClientRect();
        if (!box.width || !rings.length) continue; // kolumna schowana na tej szerokości
        const vb = svg.viewBox.baseVal;
        // preserveAspectRatio domyślnie xMidYMid meet: jedna skala, wyśrodkowanie
        const s = Math.min(box.width / vb.width, box.height / vb.height);
        const ox = box.left - cb.left + (box.width - vb.width * s) / 2 - vb.x * s;
        const oy = box.top - cb.top + (box.height - vb.height * s) / 2 - vb.y * s;
        const mapped = rings.map((ring) => ({
          cx: ox + ring.cx * s, cy: oy + ring.cy * s, r: ring.r * s, color: ring.color,
        }));
        for (const ring of mapped) {
          const m = ring.r + ringMargin(ring.r);
          top = Math.min(top, ring.cy - m);
          bottom = Math.max(bottom, ring.cy + m);
        }
        placed.push(mapped);
      }
      if (!placed.length) return [];

      top = Math.floor(top);
      canvas.style.top = `${top}px`;
      canvas.style.height = `${Math.ceil(bottom) - top}px`;
      const left = canvas.getBoundingClientRect().left - cb.left;
      return placed.map((rings) => ({
        cx: rings[0].cx - left,
        cy: rings[0].cy - top,
        rings: rings.map((ring) => ({ r: ring.r, color: ring.color })),
      }));
    },
  };
}

// ── scena ────────────────────────────────────────────────────

export class SpeakerRings {
  /**
   * @param {ReturnType<typeof svgSpeakers>} source
   * @param {import('./BackgroundSound.js').BackgroundSound} sound
   */
  constructor(source, sound, { reducedMotion = false } = {}) {
    this.source = source;
    this.sound = sound;
    this.reducedMotion = reducedMotion;
    this.canvas = source.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.speakers = [];

    this.visible = false;
    this.raf = 0;
    this.last = 0;
    this._frame = this._frame.bind(this);

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(this.canvas);
    for (const el of source.watch) resize.observe(el);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (!this.visible) this._sleep();
      this._wake();
    }).observe(this.canvas);
    sound.onChange(() => this._wake());
    this.resize();
  }

  resize() {
    // źródło przestawia pion canvasu, więc jego pudełko czytamy po pomiarze
    const groups = this.source.measure();
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;

    const k = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (box.width * box.height)));
    const width = Math.round(box.width * k);
    const height = Math.round(box.height * k);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.k = k;

    // zmiana geometrii zeruje stan pierścieni — i tak wybrzmiewa w 0,2 s
    this.speakers = buildSpeakers(groups);
    this._draw();
  }

  _wake() {
    if (this.raf || !this.visible || this.reducedMotion) return;
    this.raf = requestAnimationFrame(this._frame);
  }

  /** scena zeszła z ekranu — pętla staje od razu, nie czeka na wybrzmienie */
  _sleep() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  _frame(now) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;

    const binHz = this.sound.binHz;
    let live = false;
    let energy = 0;
    for (const speaker of this.speakers) {
      const data = this.sound.frameSpectrum(speaker.channel, now);
      if (data) live = true;
      for (const driver of speaker.drivers) energy += this._update(driver, data, binHz, dt);
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
    const { ctx, canvas, k } = this;
    if (!k) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineJoin = 'round';

    for (const speaker of this.speakers) {
      const { cx, cy } = speaker;
      for (const driver of speaker.drivers) {
        // membrana: wychylenie całego pierścienia z mocą pasma
        const r = driver.r + driver.level * driver.excursion;
        const silent = driver.level < 1e-3;
        ctx.beginPath();
        // w ciszy dokładny okrąg — ten sam co w markupie
        if (silent) ctx.arc(cx, cy, r, 0, TAU);
        else this._ringPath(driver, cx, cy, r);
        ctx.lineWidth = 1;
        ctx.strokeStyle = driver.color;
        ctx.stroke();
        if (silent) continue;

        // ta sama linia jeszcze raz, limonką, tym jaśniej, im głośniej gra pasmo
        ctx.lineWidth = driver.width;
        ctx.strokeStyle = `rgba(${LIME},${(driver.alpha * Math.min(1, driver.level * 2)).toFixed(3)})`;
        ctx.stroke();
      }
    }
  }

  /**
   * Obrys pierścienia odkształconego widmem. Wartości są najpierw wygładzane
   * filtrem 1-2-1 — wartość pasma to maksimum przedziałów FFT, więc sąsiednie
   * próbki potrafią skakać i linia byłaby postrzępiona. Brzegi są lustrzane:
   * na dole i u góry sąsiadem skrajnej próbki jest ona sama po drugiej stronie.
   */
  _ringPath(driver, cx, cy, r) {
    const { ctx } = this;
    const { values, shape, pts, dirs, half, reach } = driver;
    const last = half - 1;
    for (let k = 0; k < half; k += 1) {
      const prev = values[k === 0 ? 0 : k - 1];
      const next = values[k === last ? last : k + 1];
      shape[k] = (prev + 2 * values[k] + next) / 4;
    }

    // pętla bez szwu: prawa strona od dołu do góry, lewa z góry na dół
    const n = half * 2;
    for (let i = 0; i < n; i += 1) {
      const right = i < half;
      const j = right ? i : n - 1 - i;
      const o = j * 4 + (right ? 0 : 2);
      const radius = r + shape[j] * reach;
      pts[i * 2] = cx + dirs[o] * radius;
      pts[i * 2 + 1] = cy + dirs[o + 1] * radius;
    }

    // krzywa przez środki odcinków z próbkami jako punktami kontrolnymi —
    // gładka, bez załamań w miejscach próbek
    ctx.moveTo((pts[(n - 1) * 2] + pts[0]) / 2, (pts[(n - 1) * 2 + 1] + pts[1]) / 2);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      ctx.quadraticCurveTo(
        pts[i * 2], pts[i * 2 + 1],
        (pts[i * 2] + pts[j * 2]) / 2, (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2,
      );
    }
    ctx.closePath();
  }
}
