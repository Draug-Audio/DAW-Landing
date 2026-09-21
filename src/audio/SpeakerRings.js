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
 * W środkowej kolumnie dodatkowo pulsuje pierścień w takt utworu (4/4):
 * na „raz” rodzi się wewnątrz jako równe koło, rozszerza się i rozmywa;
 * na każdym kolejnym uderzeniu zrównuje się z następnym pierścieniem
 * kolumny, szybkim przejściem przejmuje jego falę i rusza dalej, a na
 * „cztery” wychodzi poza ostatni pierścień i gaśnie. Trzy przetworniki dają
 * cztery odcinki drogi — dokładnie jeden takt.
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

/** puls w takt w środkowej kolumnie */
const PULSE = {
  /** promień narodzin jako ułamek najmniejszego pierścienia */
  start: 0.2,
  /** próbek na połowę obwodu (obwód jest lustrzany) */
  samples: 120,
  /** czas przejęcia fali przy uderzeniu, s */
  morph: 0.09,
  /** czas pojawienia się na „raz”, s */
  fadeIn: 0.06,
  /**
   * Rozmycie jako ułamek promienia pulsu (pełna szerokość, σ to połowa).
   * Warstwa rozmycia jest gotowym obrazem skalowanym do bieżącego promienia,
   * więc rozmycie rośnie razem z pulsem samo z siebie.
   */
  blurRatio: 0.075,
  /**
   * Pasków na profil rozmycia (±2σ), gdy przeglądarka nie ma `ctx.filter`
   * (Safari < 18) — każdy szeroki na ½σ. Obraz powstaje wtedy w niższej
   * rozdzielczości (`fallbackRadius`), żeby interpolacja przy skalowaniu
   * wygładziła schodki między paskami.
   */
  blurBands: 9,
  fallbackRadius: 240,
  /**
   * Wykładnik krzywej przejścia linia → rozmycie w obrębie uderzenia:
   * `u ** 4`. Przez pierwszą połowę uderzenia widać praktycznie samą ostrą
   * linię, rozmycie przejmuje dopiero końcówkę.
   */
  blurCurve: 4,
  /** krycie ostrej linii w chwili uderzenia */
  alpha: 0.42,
  width: 1.6,
  /** o ile całość przygasa do końca uderzenia (0–1) */
  fade: 0.35,
  /**
   * Krycie warstwy rozmycia względem linii. Szczyt profilu pod koniec
   * uderzenia to krycie pulsu (0,42 · 0,65 ≈ 0,27) razy ten współczynnik —
   * przy 0,33 ok. 0,09 (wcześniej 0,55 → ok. 0,15).
   */
  glow: 0.33,
  /** budżet pikseli obrazu rozmycia — jak dla canvasu sceny */
  spritePixels: 4e6,
};

/** czy canvas umie rozmywać sam (`ctx.filter`) — Chrome, Firefox, Safari 18+ */
const CANVAS_FILTER = (() => {
  try {
    return typeof document.createElement('canvas').getContext('2d').filter === 'string';
  } catch {
    return false;
  }
})();

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
    const pulse = channel === 'mid' ? makePulse(drivers) : null;
    return { cx: group.cx, cy: group.cy, channel, drivers, pulse };
  });
}

/**
 * @param {number} t pozycja w kolumnie: 0 = woofer, 1 = tweeter
 */
/** kierunki próbek na lustrzanym obwodzie: od dołu (π/2) do góry, obie strony */
function mirroredDirs(half) {
  const dirs = new Float32Array(half * 4);
  for (let k = 0; k < half; k += 1) {
    const frac = (k + 0.5) / half;
    const right = Math.PI / 2 - frac * Math.PI;
    const left = Math.PI / 2 + frac * Math.PI;
    dirs[k * 4] = Math.cos(right);
    dirs[k * 4 + 1] = Math.sin(right);
    dirs[k * 4 + 2] = Math.cos(left);
    dirs[k * 4 + 3] = Math.sin(left);
  }
  return dirs;
}

function makeDriver({ r, color }, band, t) {
  // próbka co ok. 14 px obwodu, parzyście, bo pierścień jest lustrzany;
  // na dole najniższe częstotliwości pasma, u góry najwyższe
  const count = 2 * Math.round(clamp((TAU * r) / 14, 40, 200) / 2);
  const half = count / 2;
  const dirs = mirroredDirs(half);
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
    /** promień w każdej próbce — wejście do rysowania obrysu */
    radii: new Float32Array(half),
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

/**
 * Puls środkowej kolumny. Przystanki promienia: narodziny wewnątrz, kolejne
 * pierścienie od najmniejszego, a za ostatnim tyle, ile wynosi odstęp między
 * dwoma zewnętrznymi. Zasięg (`extent`) mówi, ile miejsca potrzebuje canvas.
 */
function makePulse(drivers) {
  const inner = [...drivers].reverse(); // od najmniejszego do największego
  const outer = inner[inner.length - 1];
  const gap = inner.length > 1 ? outer.r - inner[inner.length - 2].r : outer.r * 0.25;
  const half = PULSE.samples;

  // Obraz rozmycia rysowany na wzór trzeciego (największego) pierścienia:
  // przy największych rozmiarach pulsu wychodzi prawie 1:1, a przy
  // mniejszych — na pierwszym ticku — jest skalowany w dół, co nie traci
  // jakości. Fala zapisana w proporcji do promienia pierścienia docelowego;
  // zapas na nią liczony dokładnie dla każdego ticku, nie z najgorszego
  // przypadku.
  const R = outer.r;
  const sigma = (R * PULSE.blurRatio) / 2;
  let maxWave = 0;
  for (let k = 1; k <= inner.length; k += 1) {
    const ref = k < inner.length ? inner[k].r : outer.r + gap;
    maxWave = Math.max(maxWave, (inner[k - 1].reach * R) / ref);
  }
  // rozmycie linii grubości 2σ filtrem 0,8σ sięga ok. 3,5σ od osi
  const spriteHalf = Math.ceil(R + maxWave + outer.excursion + 3.5 * sigma);
  const sprite = document.createElement('canvas');

  return {
    inner,
    gap,
    half,
    dirs: mirroredDirs(half),
    disp: new Float32Array(half),
    radii: new Float32Array(half),
    pts: new Float32Array(half * 4),
    sprite,
    spriteCtx: sprite.getContext('2d'),
    spriteHalf,
    spriteRadius: R,
    /** szczyt profilu w obrazie — rozmycie filtrem nie dochodzi do 1 */
    glowPeak: 1,
    sigma,
    /** fala obrazu rozmycia — osobna, bo `disp` w tej samej klatce niesie linia */
    glowDisp: new Float32Array(half),
    /** numer uderzenia, dla którego obraz rozmycia jest aktualny */
    spriteBeat: null,
    // rozmycie sięga ok. 3,5σ = 1,75 · blurRatio · promień poza linię
    extent: (outer.r + gap) * (1 + 1.75 * PULSE.blurRatio) + outer.reach + outer.excursion + 2,
  };
}

/** kształt pierścienia w danym miejscu obwodu (0 = dół, 1 = góra), w px */
function sampleShape(driver, frac) {
  const last = driver.half - 1;
  const x = clamp(frac * driver.half - 0.5, 0, last);
  const i = Math.floor(x);
  const a = driver.shape[i];
  const b = driver.shape[Math.min(i + 1, last)];
  return (a + (b - a) * (x - i)) * driver.reach;
}

const smooth = (x) => x * x * (3 - 2 * x);

/**
 * Zamknięty obrys z promieni w lustrzanych próbkach: prawa strona od dołu
 * do góry, lewa z góry na dół — pętla bez szwu. Krzywa przez środki
 * odcinków z próbkami jako punktami kontrolnymi, bez załamań.
 */
function mirroredPath(ctx, cx, cy, half, dirs, radii, pts) {
  const n = half * 2;
  for (let i = 0; i < n; i += 1) {
    const right = i < half;
    const j = right ? i : n - 1 - i;
    const o = j * 4 + (right ? 0 : 2);
    pts[i * 2] = cx + dirs[o] * radii[j];
    pts[i * 2 + 1] = cy + dirs[o + 1] * radii[j];
  }
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
    /** kolumny we współrzędnych kontenera */
    measure() {
      const cb = container.getBoundingClientRect();
      const placed = [];
      for (const { svg, rings } of groups) {
        const box = svg.getBoundingClientRect();
        if (!box.width || !rings.length) continue; // kolumna schowana na tej szerokości
        const vb = svg.viewBox.baseVal;
        // preserveAspectRatio domyślnie xMidYMid meet: jedna skala, wyśrodkowanie
        const s = Math.min(box.width / vb.width, box.height / vb.height);
        const ox = box.left - cb.left + (box.width - vb.width * s) / 2 - vb.x * s;
        const oy = box.top - cb.top + (box.height - vb.height * s) / 2 - vb.y * s;
        placed.push({
          cx: ox + rings[0].cx * s,
          cy: oy + rings[0].cy * s,
          rings: rings.map((ring) => ({ r: ring.r * s, color: ring.color })),
        });
      }
      return placed;
    },
    /**
     * Ustawia pion canvasu (we współrzędnych kontenera) i zwraca jego
     * przesunięcie względem kontenera. Nad początkiem dokumentu i tak nic
     * nie widać, więc canvas nie sięga wyżej — w hero oszczędza to kilkaset
     * wierszy pikseli.
     */
    place(top, bottom) {
      const cb = container.getBoundingClientRect();
      const y = Math.max(Math.floor(top), -Math.floor(cb.top + window.scrollY));
      canvas.style.top = `${y}px`;
      canvas.style.height = `${Math.ceil(bottom) - y}px`;
      return { left: canvas.getBoundingClientRect().left - cb.left, top: y };
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
    const groups = this.source.measure();
    if (!groups.length) return;
    // zmiana geometrii zeruje stan pierścieni — i tak wybrzmiewa w 0,2 s
    const speakers = buildSpeakers(groups);

    // pion canvasu: zasięg pierścieni z zapasem na odkształcenie, a w
    // środkowej kolumnie — zasięg pulsu, który wychodzi poza ostatni pierścień
    let top = Infinity;
    let bottom = -Infinity;
    for (const speaker of speakers) {
      let extent = speaker.pulse ? speaker.pulse.extent : 0;
      for (const d of speaker.drivers) extent = Math.max(extent, d.r + ringMargin(d.r));
      top = Math.min(top, speaker.cy - extent);
      bottom = Math.max(bottom, speaker.cy + extent);
    }
    const offset = this.source.place(top, bottom);
    for (const speaker of speakers) {
      speaker.cx -= offset.left;
      speaker.cy -= offset.top;
    }
    this.speakers = speakers;

    // pudełko canvasu dopiero po osadzeniu
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;

    const k = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (box.width * box.height)));
    const width = Math.round(box.width * k);
    const height = Math.round(box.height * k);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.k = k;
    this._draw(null);
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
    const beat = this.sound.beatPosition();
    let live = false;
    let energy = 0;
    for (const speaker of this.speakers) {
      const data = this.sound.frameSpectrum(speaker.channel, now);
      if (data) live = true;
      for (const driver of speaker.drivers) energy += this._update(driver, data, binHz, dt);
    }
    this._draw(beat);

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

    // Wygładzenie 1-2-1 — wartość pasma to maksimum przedziałów FFT, więc
    // sąsiednie próbki potrafią skakać i linia byłaby postrzępiona. Brzegi
    // lustrzane: na dole i u góry sąsiadem skrajnej próbki jest ona sama.
    // Liczone tu, a nie przy rysowaniu, bo z kształtu korzysta też puls.
    const { shape } = driver;
    const lastK = half - 1;
    for (let k = 0; k < half; k += 1) {
      shape[k] = (values[k === 0 ? 0 : k - 1] + 2 * values[k] + values[k === lastK ? lastK : k + 1]) / 4;
    }
    return driver.level;
  }

  _draw(beat) {
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
        if (silent) {
          ctx.arc(cx, cy, r, 0, TAU);
        } else {
          const { radii, shape, reach, half } = driver;
          for (let i = 0; i < half; i += 1) radii[i] = r + shape[i] * reach;
          mirroredPath(ctx, cx, cy, half, driver.dirs, radii, driver.pts);
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = driver.color;
        ctx.stroke();
        if (silent) continue;

        // ta sama linia jeszcze raz, limonką, tym jaśniej, im głośniej gra pasmo
        ctx.lineWidth = driver.width;
        ctx.strokeStyle = `rgba(${LIME},${(driver.alpha * Math.min(1, driver.level * 2)).toFixed(3)})`;
        ctx.stroke();
      }
      // puls na wierzchu — w chwili uderzenia nakłada się ostro na pierścień
      if (speaker.pulse && beat != null) this._drawPulse(speaker, beat);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Puls w takt. Takt dzieli się na tyle odcinków, ile jest przystanków
   * (3 przetworniki → 4 uderzenia): na „raz” równe koło rodzi się wewnątrz
   * i biegnie do najmniejszego pierścienia; na każdym kolejnym uderzeniu
   * stoi dokładnie na następnym pierścieniu (także z jego wychyleniem
   * membrany), w `PULSE.morph` przejmuje jego falę i rusza dalej; na
   * „cztery” wychodzi poza ostatni pierścień i gaśnie.
   *
   * W każdym odcinku ruch wyhamowuje (ease-out), a przejście z ostrej linii
   * w rozmycie idzie osobną krzywą (`PULSE.blurCurve`): przez pierwszą
   * połowę uderzenia widać linię, rozmycie przejmuje dopiero końcówkę.
   */
  _drawPulse(speaker, beat) {
    const { ctx } = this;
    const { pulse, cx, cy } = speaker;
    const { inner, half, disp, radii } = pulse;
    const segments = inner.length + 1;
    const beatDur = 60 / this.sound.bpm;

    const cycle = ((beat % segments) + segments) % segments;
    const seg = Math.floor(cycle);
    const u = cycle - seg;
    const ease = 1 - (1 - u) ** 3;

    const liveR = (d) => d.r + d.level * d.excursion;
    const outer = inner[inner.length - 1];
    const stops = [inner[0].r * PULSE.start, ...inner.map(liveR), liveR(outer) + pulse.gap];
    const radius = stops[seg] + (stops[seg + 1] - stops[seg]) * ease;

    // fala: na „raz” żadna (równe koło), potem przejście z fali poprzedniego
    // pierścienia na falę tego, na którym puls właśnie stoi
    const target = seg > 0 ? inner[seg - 1] : null;
    const from = seg > 1 ? inner[seg - 2] : null;
    const morph = seg > 0 ? smooth(Math.min(1, (u * beatDur) / PULSE.morph)) : 1;
    for (let j = 0; j < half; j += 1) {
      const frac = (j + 0.5) / half;
      const a = from ? sampleShape(from, frac) : 0;
      const b = target ? sampleShape(target, frac) : 0;
      disp[j] = a + (b - a) * morph;
    }

    const soft = u ** PULSE.blurCurve;
    let alpha = PULSE.alpha * (1 - PULSE.fade * soft);
    if (seg === 0) alpha *= Math.min(1, (u * beatDur) / PULSE.fadeIn);
    if (seg === segments - 1) alpha *= (1 - u) ** 1.5;
    if (alpha < 0.004) return;

    // Dwie warstwy zamiast rozmywania linii: ostra linia z falą i gotowy
    // obraz rozmycia, animowany tylko skalą i kryciem. Przenikają się — im
    // mocniejsze rozmycie, tym słabsza linia — więc całość wygląda jak linia,
    // która się rozmywa, a kosztuje jeden obrys i jedno `drawImage`.
    //
    // Obraz rozmycia jest przebudowywany skokami, raz na tick metronomu,
    // z falą pierścienia, na który puls właśnie wszedł. Tick wypada na
    // początku uderzenia, gdy rozmycie jest jeszcze niewidoczne (`soft` ≈ 0),
    // więc skok kształtu nie jest widoczny.
    const tick = Math.floor(beat);
    if (pulse.spriteBeat !== tick) {
      this._rebuildGlow(pulse, target, stops[seg + 1]);
      pulse.spriteBeat = tick;
    }

    const lineAlpha = alpha * (1 - soft);
    if (lineAlpha > 0.004) {
      for (let j = 0; j < half; j += 1) radii[j] = radius + disp[j];
      ctx.beginPath();
      mirroredPath(ctx, cx, cy, half, pulse.dirs, radii, pulse.pts);
      ctx.globalAlpha = lineAlpha;
      ctx.lineWidth = PULSE.width;
      ctx.strokeStyle = `rgb(${LIME})`;
      ctx.stroke();
    }

    const glowAlpha = alpha * soft * PULSE.glow;
    if (glowAlpha > 0.004) {
      // okrąg obrazu (trzeci pierścień) trafia na bieżący promień; fala
      // i szerokość rozmycia skalują się razem z nim
      const size = pulse.spriteHalf * 2 * (radius / pulse.spriteRadius);
      ctx.globalAlpha = Math.min(1, glowAlpha / pulse.glowPeak);
      ctx.drawImage(pulse.sprite, cx - size / 2, cy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Obraz rozmycia dla jednego uderzenia: fala pierścienia docelowego (albo
   * równe koło na „raz”), rozmyta — filtrem canvasu, a bez niego paskami
   * o szerokości ½σ z kryciem równym profilowi Gaussa. Rysowany w skali
   * trzeciego pierścienia, z falą w proporcji do `refRadius`, bo obraz jest
   * potem skalowany do bieżącego promienia.
   */
  _rebuildGlow(pulse, target, refRadius) {
    const { sprite, spriteCtx: g, spriteHalf: c, sigma, half, glowDisp, radii, pts, dirs } = pulse;
    const R = pulse.spriteRadius;
    const waveScale = R / refRadius;
    for (let j = 0; j < half; j += 1) {
      glowDisp[j] = target ? sampleShape(target, (j + 0.5) / half) * waveScale : 0;
    }

    // Rozdzielczość: gęstość pikseli sceny, w budżecie pikseli. Bez
    // `ctx.filter` — niższa, żeby interpolacja wygładziła paski.
    const side = c * 2;
    const res = CANVAS_FILTER
      ? Math.min(this.k || 1, Math.sqrt(PULSE.spritePixels) / side)
      : PULSE.fallbackRadius / R;
    const px = Math.max(1, Math.round(side * res));
    if (sprite.width !== px) {
      sprite.width = px;
      sprite.height = px;
    }
    const scale = px / side;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.filter = 'none';
    g.clearRect(0, 0, px, px);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.lineJoin = 'round';
    g.strokeStyle = `rgb(${LIME})`;

    if (CANVAS_FILTER) {
      // Linia grubości 2σ rozmyta filtrem 0,8σ: splot daje profil o σ ≈ 1,0σ
      // i szczycie erf(0,88) ≈ 0,79 — to wyrównuje `glowPeak` przy rysowaniu.
      // Promień filtra jest w pikselach bitmapy, nie w jednostkach transformacji.
      for (let j = 0; j < half; j += 1) radii[j] = R + glowDisp[j];
      g.filter = `blur(${(0.8 * sigma * scale).toFixed(2)}px)`;
      g.lineWidth = 2 * sigma;
      g.beginPath();
      mirroredPath(g, c, c, half, dirs, radii, pts);
      g.stroke();
      g.filter = 'none';
      pulse.glowPeak = 0.79;
    } else {
      const bands = PULSE.blurBands;
      const step = (4 * sigma) / (bands - 1);
      g.lineWidth = step;
      for (let i = 0; i < bands; i += 1) {
        const offset = -2 * sigma + i * step;
        g.globalAlpha = Math.exp(-(offset * offset) / (2 * sigma * sigma));
        for (let j = 0; j < half; j += 1) radii[j] = R + offset + glowDisp[j];
        g.beginPath();
        mirroredPath(g, c, c, half, dirs, radii, pts);
        g.stroke();
      }
      pulse.glowPeak = 1;
    }
    g.globalAlpha = 1;
  }
}
