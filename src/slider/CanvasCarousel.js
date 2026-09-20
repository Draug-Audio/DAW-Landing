import { clamp, lerp, smoothstep, wrapDelta, wrapIndex } from './math.js';
import { context2d, makeCanvas, makeGlyphAtlas, makeNoiseTile } from './texture.js';

const DEG = Math.PI / 180;

/** kolor znaków i obrysu kafelków siatki */
const GRID_INK = 'rgb(200,255,61)';

/**
 * Profil jasności pasa: pozycja w pasie → krycie. Płaski rdzeń i łagodne
 * zbocza; stopni jest więcej niż trzy, bo gradient interpoluje liniowo,
 * a chodzi o krzywą zbliżoną do smoothstep.
 */
const BEAM_PROFILE = [
  [0, 0], [0.12, 0.08], [0.25, 0.35], [0.38, 0.8],
  [0.44, 1], [0.56, 1],
  [0.62, 0.8], [0.75, 0.35], [0.88, 0.08], [1, 0],
];

const DEFAULTS = {
  /** Awaryjna szerokość kafla, gdy nie podano elementu odniesienia.
   *  Normalnie przedni kafel ma dokładnie szerokość `frame` (kontenera). */
  frontWidth: 0.7,
  /**
   * Odstęp sąsiednich kafli mierzony cięciwą okręgu, w szerokościach kafla.
   * Promień liczymy z tego, a nie wprost — dzięki czemu rozstaw wygląda tak
   * samo przy 3 slajdach (kąt 58°) i przy 8 (kąt 45°).
   */
  chordFactor: 0.8,
  /**
   * Jaka część kąta pozycji trafia w obrót kafla wokół własnej osi.
   * Przy 1 (kafel styczny do okręgu) wewnętrzna krawędź sąsiada wychyla się
   * przed płaszczyznę przedniego kafla i renderuje się OD NIEGO WIĘKSZA —
   * czyli kafel z tyłu wygląda na bliższy. Mniejszy obrót przy większym
   * promieniu trzyma sąsiadów za przednim kaflem.
   */
  tilt: 0.82,
  /** ogniskowa jako wielokrotność szerokości kafla — stała perspektywa
   *  niezależnie od tego, czy kafel przycina szerokość czy wysokość sceny */
  focalFactor: 1.9,
  /** maksymalny rozstaw kątowy między sąsiednimi slajdami */
  maxArc: 58 * DEG,
  /**
   * Dodatkowe rozsunięcie dwóch kafli biorących udział w przejściu, zerowe
   * w spoczynku. Bez niego w połowie drogi kafle nachodzą na siebie i
   * przenikają; z nim mijają się, stykając krawędziami dokładnie w połowie.
   */
  edgeMeet: true,
  /** pionowy środek okręgu (ułamek wysokości) — wyżej, bo pod spodem odbicie */
  centerY: 0.44,
  maxStrips: 88,
  /**
   * Podziałka siatki w pikselach kafla. Trzyma się razem z `gridFontWeight`:
   * przy wadze 100 kreska glifu ma mniej niż piksel, dopóki glif nie urośnie
   * powyżej ok. 20 px — poniżej tego runy żyją w samym antyaliasingu i bledną.
   */
  gridCell: 32,
  /** szczelina między kafelkami — o tyle kafelek jest mniejszy od podziałki */
  gridGap: 4,
  /**
   * Jasność kafelka losowana jest ze schodków, nie z ciągłego przedziału:
   * pełne ułamki od `gridLevelMin` do `gridLevelMax` co `gridLevelStep`.
   * Sześć poziomów zamiast płynnej skali daje siatce wyraźne stopnie,
   * zamiast równomiernej chmury wartości.
   *
   * Poziomy nie są równie częste — waga maleje liniowo od najciemniejszego
   * do najjaśniejszego (przy sześciu poziomach 6 : 5 : 4 : 3 : 2 : 1), więc
   * jasne kafelki są rzadkie i czytają się jak pojedyncze błyski, a nie
   * jak równomierna szachownica. Poziom jest losowany raz i stały: dzięki
   * temu ta rzadkość się utrzymuje. Zmiana poziomu przy każdej wymianie
   * znaku wypłaszczałaby rozkład do równomiernego w kilka minut.
   */
  gridLevelMin: 0.1,
  gridLevelMax: 0.6,
  gridLevelStep: 0.1,
  /**
   * Górny pułap jasności kafelka pod rdzeniem pasa. Poniżej 1 nawet kafelek
   * o jasności 1,0 przepuszcza trochę obrazu — świadomie, żeby pas nie
   * wycinał w kaflu jasnego bloku i mniej rzucał się w oczy.
   */
  gridReveal: 0.68,
  /** krycie tła kafelka względem jego jasności */
  gridFill: 0.12,
  /** krycie zewnętrznej ramki rozdzielającej kafelki */
  gridEdge: 0.9,
  /** kolor tej ramki: tło strony, żeby kafelki wyglądały na rozdzielone */
  gridEdgeColor: '8,9,8',
  /** krycie wewnętrznego obrysu w kolorze znaku */
  gridOutline: 0.55,
  /** ile razy znak wymienia się podczas jednego przejścia pasa */
  gridSwaps: 2,
  /** odstęp kolejnych wymian, w połówkach szerokości pasa */
  gridSwapSpacing: 0.8,
  /** rodzina czcionki znaków w kafelkach */
  gridFont: 'RuneScript Monospace Variable',
  /** waga ze zmiennej osi czcionki — 100 to dolny kraniec osi w tym pliku */
  gridFontWeight: 100,
  /** rozmiar czcionki w pikselach; podawany wprost, nie jako ułamek kafelka */
  gridFontSize: 16,
  /**
   * Minimalna grubość kreski glifu w pikselach; **zero i tak ma zostać**.
   *
   * Przy wadze 100 i rozmiarze 16 px kreska jest podpikselowa i cała żyje
   * w antyaliasingu — wygląda na lekko rozmytą. To jest świadomy wybór:
   * w tej scenie liczy się jak najmniejsza ilość tuszu, a nie czytelność
   * pojedynczej runy. Dorysowanie obrysu pod wypełnieniem wymusiłoby pełny
   * piksel (0,3 px → 0,43 pikseli pełnych i alfa 255), ale kosztem tuszu
   * 465 zamiast 300, czyli o połowę cięższej siatki.
   *
   * Wyrównywanie pozycji znaku do całych pikseli nic tu nie da — canvas nie
   * hintuje, więc kreska 0,5 px zostaje 0,5 px, gdziekolwiek trafi
   * (zmierzone: ten sam udział pikseli pełnych i ta sama maksymalna alfa dla
   * pozycji ułamkowej, całkowitej i przy `textRendering: geometricPrecision`).
   */
  gridGlyphStroke: 0,
  gridChars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  /** obrotów pasa na sekundę */
  sweepSpeed: 0.15,
  /** połowa szerokości pasa, w wysokościach kafla */
  sweepWidth: 0.1,
  /**
   * Siła nakładki w odbiciu, liczona od siły nakładki na samym kaflu. Odbicie
   * ma pokazywać to, co jest nad nim: kafel przedni nie ma siatki, więc jego
   * odbicie też jej nie dostaje.
   */
  reflectionShimmer: 0.9,
  /**
   * Krycie obrysu w odbiciu, jako ułamek krycia obrysu na kaflu. Nisko, żeby
   * ramka w odbiciu domykała kształt, a nie ściągała na siebie uwagi.
   */
  reflectionBorder: 0.45,
  /** maks. rozjazd kanałów RGB w px przy pełnej prędkości */
  aberration: 11,
  stiffness: 120,
  damping: 18.5,
  /**
   * Na ekranach HiDPI canvas nie idzie pełnym dpr — w spoczynku przedni kafel
   * i tak przykrywa ostra kopia w DOM, a w ruchu rozdzielczość gubi rzut
   * perspektywiczny. Przy dpr 1 mnożnik wynosi 1, więc kafel wychodzi 1:1.
   */
  maxDpr: 1.25,
  /** Górny limit bufora; dobrany tak, żeby przy dpr 1 nie schodzić poniżej
   *  rozdzielczości CSS nawet na szerokich ekranach. */
  maxBackingWidth: 2600,
  reducedMotion: false,
};

export class CanvasCarousel {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{textures: object[], options?: object, onFrame?: Function, onSettle?: Function}} config
   */
  constructor(canvas, { textures, frame, options = {}, onFrame, onSettle }) {
    this.canvas = canvas;
    /** element wyznaczający szerokość przedniego kafla (kontener treści) */
    this.frame = frame ?? canvas;
    this.ctx = context2d(canvas);
    this.textures = textures;
    this.count = textures.length;
    this.opt = { ...DEFAULTS, ...options };
    this.onFrame = onFrame;
    this.onSettle = onSettle;

    // pozycja ciągła (nieskracana) + sprężyna do celu
    this.pos = 0;
    this.targetPos = 0;
    this.vel = 0;
    this.index = 0;
    this.energy = 0;
    this.burst = 0;
    this.time = 0;
    this.running = false;
    this.visible = true;
    this.lastTime = 0;
    this.settledIndex = 0;

    this.pointer = { active: false, id: null, startX: 0, startPos: 0, lastX: 0, lastT: 0, vel: 0, moved: 0 };
    this.wheelAcc = 0;
    this.wheelLock = 0;

    this.supportsFilter = typeof this.ctx.filter === 'string';

    /**
     * Na ile ostra kopia w DOM przykryła przedni kafel (0–1). Przy pełnym
     * przykryciu obrys tego kafla gaśnie, bo ramkę rysuje wtedy przeglądarka
     * — ostrzejszą i dokładnie jednopikselową. Wartość ustawia strona
     * montująca, bo tylko ona wie, co dzieje się z nakładką.
     */
    this.sharpCover = 0;

    // bufory pomocnicze
    this.stage = makeCanvas(1, 1);
    this.stageCtx = context2d(this.stage);
    this.work = makeCanvas(1, 1);
    this.workCtx = context2d(this.work);
    this.refl = makeCanvas(1, 1);
    this.reflCtx = context2d(this.refl);
    this.bloom = makeCanvas(1, 1);
    this.bloomCtx = context2d(this.bloom);
    this.fx = makeCanvas(1, 1);
    this.fxCtx = context2d(this.fx);
    // nakładka „ekranu” (siatka, ziarno, przemiatanie, winieta) budowana
    // w układzie kafla, nie ekranu — dzięki temu idzie przez ten sam rzut.
    // Rozmiar ustawiany w resize() dokładnie na rozmiar kafla w pikselach
    // urządzenia, żeby siatka mapowała się 1:1 i nie miękła na filtrowaniu.
    this.overlay = makeCanvas(1, 1);
    this.overlayCtx = context2d(this.overlay);

    this.noise = [makeNoiseTile(), makeNoiseTile(), makeNoiseTile()];
    this.glyphs = makeGlyphAtlas(
      this.opt.gridChars,
      this.opt.gridCell - this.opt.gridGap,
      this.opt.gridFont,
      {
        weight: this.opt.gridFontWeight,
        fontSize: this.opt.gridFontSize,
        minStroke: this.opt.gridGlyphStroke,
      },
    );

    this._frame = this._frame.bind(this);
    this._bindInput();
    this._observe();
    this.resize();
  }

  // ── API ────────────────────────────────────────────────────

  goTo(index, { instant = false } = {}) {
    const delta = wrapDelta(index - wrapIndex(Math.round(this.targetPos), this.count), this.count);
    this.targetPos = Math.round(this.targetPos) + delta;
    this.index = wrapIndex(index, this.count);
    if (instant) {
      this.pos = this.targetPos;
      this.vel = 0;
    } else {
      this.burst = 1;
    }
    return this;
  }

  /**
   * Prostokąt przedniego kafla w pikselach CSS, względem canvasu. Służy do
   * ustawienia ostrej kopii w DOM dokładnie na tym, co rysuje canvas.
   */
  frontRect() {
    if (!this.geom) return null;
    const css = this.canvas.getBoundingClientRect().width;
    if (!css) return null;
    const scale = css / this.w;
    const { cx, cy, cardW, cardH, border } = this.geom;
    return {
      left: (cx - cardW / 2) * scale,
      top: (cy - cardH / 2) * scale,
      width: cardW * scale,
      height: cardH * scale,
      // Ramka leży poza polem treści; nakładka rezerwuje na nią tyle samo
      // własnym, przezroczystym obramowaniem.
      border: border * scale,
      // kolor, jakim canvas narysowałby obrys przedniego kafla, gdyby nie
      // był przykryty — nakładka przejmuje go, żeby nie rozjechały się barwą
      borderColor: `rgba(200,255,61,${(0.08 + 0.3).toFixed(3)})`,
    };
  }

  /** Krycie obrysu kafla; dla przedniego gaśnie pod ostrą kopią. */
  _borderAlpha(front) {
    return (0.08 + 0.3 * front) * (1 - front * this.sharpCover);
  }

  /** Czy sprężyna doszła do celu i scena stoi. */
  isSettled() {
    return Math.abs(this.pos - this.targetPos) < 1e-3 && this.energy < 0.01 && !this.pointer.active;
  }

  next() { return this.goTo(this.index + 1); }
  prev() { return this.goTo(this.index - 1); }

  start() {
    if (this.running) return this;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this._frame);
    return this;
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    return this;
  }

  destroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.teardownInput?.();
  }

  // ── wymiary ────────────────────────────────────────────────

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dprCap = Math.min(window.devicePixelRatio || 1, this.opt.maxDpr);
    const dpr = Math.min(dprCap, this.opt.maxBackingWidth / rect.width);
    const w = Math.max(320, Math.round(rect.width * dpr));
    const h = Math.max(160, Math.round(rect.height * dpr));
    const cardWidth = Math.round(this.frame.getBoundingClientRect().width * dpr);
    if (w === this.w && h === this.h && cardWidth === this.cardWidth) return;

    this.w = w;
    this.h = h;
    this.cardWidth = cardWidth;
    for (const c of [this.canvas, this.stage, this.work, this.fx]) {
      c.width = w;
      c.height = h;
    }
    this.refl.width = Math.round(w / 2);
    this.refl.height = Math.round(h / 2);
    this.bloom.width = Math.max(1, Math.round(w / 4));
    this.bloom.height = Math.max(1, Math.round(h / 4));

    // konteksty gubią ustawienia przy zmianie rozmiaru
    for (const ctx of [this.ctx, this.stageCtx, this.workCtx, this.reflCtx, this.bloomCtx, this.fxCtx, this.overlayCtx]) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    this.noisePatterns = this.noise.map((tile) => this.ctx.createPattern(tile, 'repeat'));
    this._geometry();

    // nakładka dokładnie w rozmiarze kafla — na kaflu na wprost piksel
    // nakładki odpowiada pikselowi ekranu, więc siatka ma ostre krawędzie
    this.overlay.width = Math.max(1, Math.round(this.geom.cardW));
    this.overlay.height = Math.max(1, Math.round(this.geom.cardH));
    this.overlayCtx.imageSmoothingEnabled = true;
    this.overlayCtx.imageSmoothingQuality = 'high';
    this._buildGrid();

    this._render(0);
  }

  _geometry() {
    const { w, h, opt } = this;
    const aspect = this.textures[0].aspect;
    const border = 1;
    // `cardW` to pole TREŚCI kafla — ramka leży poza nim, po jednym pikselu
    // z każdej strony. Dzięki temu tekstura, canvas i ostra kopia w DOM mają
    // to samo pole treści i nikt niczego nie rozciąga o te dwa piksele.
    let cardW = Math.min(this.cardWidth || w * opt.frontWidth, w) - 2 * border;
    let cardH = cardW * aspect;
    const maxCardH = h * 0.98;
    if (cardH > maxCardH) {
      cardH = maxCardH;
      cardW = cardH / aspect;
    }
    const focal = cardW * opt.focalFactor;
    const arc = Math.min((Math.PI * 2) / this.count, opt.maxArc);
    const radius = (cardW * opt.chordFactor) / (2 * Math.sin(arc / 2));

    /*
     * W połowie przejścia dwa kafle stoją symetrycznie po obu stronach osi.
     * Szukamy kąta, przy którym wewnętrzna krawędź kafla trafia dokładnie
     * w oś sceny (px = 0) — wtedy obie krawędzie schodzą się w jednym
     * punkcie 3D i kafle stykają się zamiast przenikać.
     *
     *   radius · sin(φ) = (cardW / 2) · cos(tilt · φ)
     *
     * Lewa strona rośnie, prawa maleje, więc jeden pierwiastek i bisekcja.
     */
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (radius * Math.sin(mid) < (cardW / 2) * Math.cos(opt.tilt * mid)) lo = mid;
      else hi = mid;
    }
    const spread = opt.edgeMeet ? Math.max(0, (lo + hi) / 2 - arc / 2) : 0;

    this.geom = {
      cx: w / 2,
      cy: h * opt.centerY,
      // Obrys kafla: dokładnie jeden piksel urządzenia, rysowany POZA polem
      // treści. Ułamkowa grubość rozmywałaby się na dwa piksele, a akurat ją
      // da się wyrównać do siatki.
      border,
      focal,
      dist: focal,          // dzięki temu przedni kafel ma skalę 1:1
      cardW,
      cardH,
      radius,
      arc,
      spread,
    };
  }

  // ── pętla ──────────────────────────────────────────────────

  _frame(now) {
    if (!this.running) return;
    const dt = clamp((now - this.lastTime) / 1000, 0, 1 / 20);
    this.lastTime = now;
    this.time += dt;

    const before = this.pos;
    if (!this.pointer.active) this._integrate(dt);
    const delta = this.pos - before;
    if (Math.abs(delta) > 1e-5) this.dir = Math.sign(delta);
    const speed = dt > 0 ? Math.abs(delta) / dt : 0;

    // energia = ile „slajdów na sekundę” przelatuje pod kamerą
    const target = clamp(speed / 2.6, 0, 1);
    this.energy = target > this.energy ? target : lerp(this.energy, target, 1 - Math.exp(-dt * 7));
    this.burst = Math.max(0, this.burst - dt / 0.5);

    const settled = wrapIndex(Math.round(this.pos), this.count);
    if (settled !== this.settledIndex && Math.abs(this.pos - this.targetPos) < 0.04) {
      this.settledIndex = settled;
      this.onSettle?.(settled);
    }

    this._render(dt);
    this.raf = requestAnimationFrame(this._frame);
  }

  _integrate(dt) {
    const { stiffness, damping } = this.opt;
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const accel = -stiffness * (this.pos - this.targetPos) - damping * this.vel;
      this.vel += accel * h;
      this.pos += this.vel * h;
    }
    if (Math.abs(this.pos - this.targetPos) < 1e-4 && Math.abs(this.vel) < 2e-3) {
      this.pos = this.targetPos;
      this.vel = 0;
    }
  }

  // ── rysowanie ──────────────────────────────────────────────

  _render() {
    if (!this.geom) return;
    const { ctx, stageCtx, w, h, geom } = this;
    const reduced = this.opt.reducedMotion;

    // W spoczynku kafel stoi dokładnie na wprost. Wcześniej „oddychał”
    // mikroobrotem, przez co nigdy nie trafiał w gałąź płaską i szedł przez
    // kilka pasków o ułamkowych pozycjach — czyli był bez przerwy
    // przepróbkowywany, a siatka miała rozmyte krawędzie. Za ruch w spoczynku
    // odpowiada teraz przemiatanie.
    const renderPos = this.pos;
    const energy = this.energy;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);

    stageCtx.setTransform(1, 0, 0, 1, 0, 0);
    stageCtx.globalAlpha = 1;
    stageCtx.globalCompositeOperation = 'source-over';
    stageCtx.clearRect(0, 0, w, h);

    const rc = this.reflCtx;
    rc.setTransform(0.5, 0, 0, 0.5, 0, 0);
    rc.globalAlpha = 1;
    rc.globalCompositeOperation = 'source-over';
    rc.clearRect(0, 0, w, h);

    // kolejność malarska: od najdalszego kafla do przedniego
    const order = [];
    for (let i = 0; i < this.count; i += 1) {
      const rel = wrapDelta(i - renderPos, this.count);
      // Nieparzysty garb: 0 w spoczynku (rel całkowite), ±1 dokładnie
      // w połowie przejścia, 0 poza parą biorącą w nim udział. Kwadrat sinusa,
      // a nie sam sinus, bo na granicy |rel| = 1 musi zerować się też pochodna
      // — inaczej kafel szarpie w momencie wyjścia z pary.
      const bump = Math.abs(rel) < 1 ? Math.sign(rel) * Math.sin(Math.PI * rel) ** 2 : 0;
      const theta = rel * geom.arc + geom.spread * bump;
      const depth = geom.radius + geom.dist - geom.radius * Math.cos(theta);
      order.push({ i, rel, theta, depth, ang: this._angles(theta) });
    }
    order.sort((a, b) => b.depth - a.depth);

    this._buildOverlay(energy, reduced);
    for (const card of order) this._drawCardGlow(ctx, card, energy);
    for (const card of order) this._drawCard(card, energy);

    this._drawReflection(ctx, energy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.stage, 0, 0);

    this._drawBloom(ctx, energy);
    if (!reduced) this._drawGlitch(ctx, energy);

    this.onFrame?.({
      position: renderPos,
      energy,
      burst: this.burst,
      index: this.index,
      settled: this.isSettled(),
    });
  }

  /** Eliptyczna poświata — rysowana w przeskalowanym układzie, żeby zgasła
   *  przed krawędzią canvasu i nie zostawiła prostokątnego kantu. */
  _ellipseGlow(ctx, x, y, rx, ry, stops) {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    ctx.fillStyle = gradient;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  /**
   * Poświata i świetlista podłoga są przypięte do konkretnego kafla: biorą
   * jego rzutowane położenie, szerokość i wysokość, więc na slajdach
   * pobocznych przesuwają się i spłaszczają razem z nimi zamiast stać w
   * jednym miejscu ekranu. Pełna moc przypada na kafel na wprost.
   */
  _drawCardGlow(ctx, { rel, ang }, energy) {
    const { cardW, cardH, cy } = this.geom;
    const fade = smoothstep(0, 0.2, this._facing(ang));
    if (fade <= 0.004) return;

    const front = smoothstep(1.05, 0.22, Math.abs(rel));
    const strength = fade * (0.16 + 0.84 * front);
    if (strength <= 0.01) return;

    const left = this._project(-cardW / 2, ang);
    const right = this._project(cardW / 2, ang);
    const midX = (left.x + right.x) / 2;
    const halfW = Math.abs(right.x - left.x) / 2;
    const halfH = (left.half + right.half) / 2;

    ctx.globalCompositeOperation = 'lighter';

    const a = (0.05 + energy * 0.09) * strength;
    this._ellipseGlow(ctx, midX, cy, halfW * 1.7, halfH * 2.1, [
      [0, `rgba(200,255,61,${a})`],
      [0.5, `rgba(200,255,61,${a * 0.34})`],
      [1, 'rgba(200,255,61,0)'],
    ]);

    const fa = (0.09 + energy * 0.12) * strength;
    this._ellipseGlow(ctx, midX, cy + halfH, halfW * 1.15, (cardH * 0.3 * halfH) / (cardH / 2), [
      [0, `rgba(200,255,61,${fa})`],
      [0.45, `rgba(200,255,61,${fa * 0.4})`],
      [1, 'rgba(200,255,61,0)'],
    ]);

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Kąty kafla: `pos` to miejsce na okręgu, `rot` to obrót wokół własnej osi.
   * Rozdzielone, bo przy pełnym obrocie (kafel styczny do okręgu) sąsiad
   * wychyla wewnętrzną krawędź przed przedni kafel.
   */
  _angles(theta) {
    const psi = theta * this.opt.tilt;
    return {
      sinPos: Math.sin(theta),
      cosPos: Math.cos(theta),
      sinRot: Math.sin(psi),
      cosRot: Math.cos(psi),
    };
  }

  /** Odległość kamery od płaszczyzny kafla wzdłuż jego normalnej, w `dist`.
   *  Poniżej zera patrzymy na tył — wtedy rzut odwraca się w poziomie. */
  _facing(ang) {
    const { radius, dist } = this.geom;
    return (
      (-radius * ang.sinPos * ang.sinRot + (radius + dist - radius * ang.cosPos) * ang.cosRot) / dist
    );
  }

  /**
   * Prostokąt kafla na wprost, wyrównany do całych pikseli. Używany i przez
   * rysowanie obrazu, i przez obrys — muszą trafiać w te same krawędzie,
   * inaczej ramka rozjeżdża się o pół piksela i mięknie.
   */
  _flatRect(ang) {
    const { cardW, cy } = this.geom;
    const l = this._project(-cardW / 2, ang);
    const r = this._project(cardW / 2, ang);
    const dh = l.half + r.half;
    const x = Math.round(l.x);
    const y = Math.round(cy - dh / 2);
    return { x, y, w: Math.round(r.x) - x, h: Math.round(cy + dh / 2) - y };
  }

  /** Rzut punktu leżącego na kaflu (przesunięcie `lx` od jego środka). */
  _project(lx, ang) {
    const { radius, dist, focal, cx, cy, cardH } = this.geom;
    const px = radius * ang.sinPos + lx * ang.cosRot;
    const pz = radius * ang.cosPos - lx * ang.sinRot;
    const depth = Math.max(focal * 0.08, radius + dist - pz);
    const k = focal / depth;
    return { x: cx + px * k, half: (cardH / 2) * k, depth, y: cy };
  }

  _drawCard({ i, rel, ang }, energy) {
    const tex = this.textures[i];
    const { cardW, cy } = this.geom;

    const edgeFade = smoothstep(0, 0.2, this._facing(ang));
    if (edgeFade <= 0.004) return;

    // „przedniość” trzyma slajd jasny prawie do końca przejścia,
    // a gaśnie dopiero blisko pozycji sąsiada
    const front = smoothstep(1.05, 0.22, Math.abs(rel));

    const left = this._project(-cardW / 2, ang);
    const right = this._project(cardW / 2, ang);

    const ab = this.opt.reducedMotion
      ? 0
      : energy * this.opt.aberration * (this.w / 1400) * (0.4 + 0.6 * front);

    const minX = Math.min(left.x, right.x);
    const maxX = Math.max(left.x, right.x);
    const maxHalf = Math.max(left.half, right.half);
    const pad = 16 + Math.ceil(ab);
    const bx = clamp(Math.floor(minX - pad), 0, this.w);
    const by = clamp(Math.floor(cy - maxHalf - pad), 0, this.h);
    const bw = clamp(Math.ceil(maxX + pad) - bx, 0, this.w - bx);
    const bh = clamp(Math.ceil(cy + maxHalf + pad) - by, 0, this.h - by);
    if (bw <= 0 || bh <= 0) return;

    const ctx = this.workCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(bx, by, bw, bh);

    const quad = (target) => {
      target.beginPath();
      target.moveTo(left.x, cy - left.half);
      target.lineTo(right.x, cy - right.half);
      target.lineTo(right.x, cy + right.half);
      target.lineTo(left.x, cy + left.half);
      target.closePath();
    };

    if (ab > 0.4) {
      // Aberracja chromatyczna: kafel rysowany trzy razy do bufora pomocniczego,
      // za każdym razem przemnożony przez czysty kanał (obcięcie do quada jest
      // konieczne — `multiply` na przezroczystym tle dałoby pełny kolor), a
      // potem składany addytywnie z przesunięciem. Suma R+G+B przy zerowym
      // przesunięciu odtwarza oryginał co do piksela.
      const fx = this.fxCtx;
      const dir = this.dir || 1;
      const channels = [['#ff0000', -ab * dir], ['#00ff00', 0], ['#0000ff', ab * dir]];
      ctx.globalCompositeOperation = 'lighter';
      for (const [tint, offset] of channels) {
        fx.setTransform(1, 0, 0, 1, 0, 0);
        fx.globalAlpha = 1;
        fx.globalCompositeOperation = 'source-over';
        fx.clearRect(bx, by, bw, bh);
        fx.save();
        quad(fx);
        fx.clip();
        this._paintStrips(fx, tex.base, ang, 0);
        fx.globalCompositeOperation = 'multiply';
        fx.fillStyle = tint;
        fx.fillRect(bx, by, bw, bh);
        fx.restore();
        ctx.drawImage(this.fx, bx, by, bw, bh, bx + offset, by, bw, bh);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.save();
      quad(ctx);
      ctx.clip();
      this._paintStrips(ctx, tex.base, ang, 0);
      ctx.restore();
    }

    ctx.save();
    quad(ctx);
    ctx.clip();

    // mgła głębi — jeden gradient zamiast cieniowania per pasek
    const shade = (p) => clamp(1 - (p.depth / this.geom.dist - 1) * 1.15, 0, 1);
    const brightness = lerp(0.48, 1, front);
    const a0 = 1 - brightness * lerp(0.78, 1, shade(left));
    const a1 = 1 - brightness * lerp(0.78, 1, shade(right));
    const fog = ctx.createLinearGradient(left.x, 0, right.x, 0);
    fog.addColorStop(0, `rgba(5,6,5,${clamp(a0, 0, 0.92)})`);
    fog.addColorStop(1, `rgba(5,6,5,${clamp(a1, 0, 0.92)})`);
    ctx.fillStyle = fog;
    quad(ctx);
    ctx.fill();

    // Nakładka ekranu — ten sam rzut co obraz, więc skraca się z kaflem.
    // Wyłącznie na kaflach pobocznych: przedni ma być czysty, bo w spoczynku
    // przykrywa go ostra kopia w DOM, a siatka byłaby pod nią i tak niewidoczna.
    // Przy `front` równym 1 przebieg w ogóle nie rusza.
    const accent = 1 - front;
    if (accent > 0.004) {
      ctx.globalAlpha = accent;
      this._paintStrips(ctx, this.overlay, ang, 0);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Obrys kafla. Na wprost rysowany po całych pikselach — pół piksela
    // przesunięcia rozmazałoby go na dwa rzędy i ramka straciłaby ostrość.
    ctx.save();
    ctx.lineWidth = this.geom.border;
    // im bardziej kafel jest przykryty ostrą kopią, tym słabszy obrys z canvasu
    ctx.strokeStyle = `rgba(200,255,61,${this._borderAlpha(front)})`;
    if (Math.abs(ang.sinRot) < 0.0015) {
      // linia o grubości 1 wyśrodkowana na -0,5 zajmuje dokładnie kolumnę
      // pikseli tuż przy polu treści, nie wchodząc w nie
      const rect = this._flatRect(ang);
      ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
    } else {
      quad(ctx);
      ctx.stroke();
    }
    ctx.restore();

    this.stageCtx.globalAlpha = edgeFade;
    this.stageCtx.drawImage(this.work, bx, by, bw, bh, bx, by, bw, bh);
    this.stageCtx.globalAlpha = 1;

    // Odbicie tego kafla — bufor pracuje w połowie rozdzielczości, ale
    // współrzędne zostają pełne dzięki skali w transformacie. Nakładka idzie
    // tym samym rzutem co obraz, więc przemiatanie przechodzi także przez
    // odbicie, a nie urywa się na dolnej krawędzi kafla.
    const rc = this.reflCtx;
    const reflAlpha = edgeFade * (0.3 + 0.7 * front);
    rc.globalAlpha = reflAlpha;
    this._paintStrips(rc, tex.base, ang, 0, true);
    // `accent` zeruje się na kaflu na wprost, więc jego odbicie zostaje czyste
    const reflShimmer = reflAlpha * this.opt.reflectionShimmer * accent;
    if (reflShimmer > 0.004) {
      rc.globalAlpha = reflShimmer;
      this._paintStrips(rc, this.overlay, ang, 0, true);
    }

    /*
     * Obrys odbicia. Czworokąt budowany wprost, bez transformaty: górna
     * krawędź odbicia to dolna krawędź kafla, a dolna leży na `3 × half`,
     * bo każda kolumna odbija się względem WŁASNEJ dolnej krawędzi.
     *
     * Krycie bierze się z `0,08 + 0,3 · front`, a nie z `_borderAlpha` —
     * to drugie gaśnie pod ostrą kopią w DOM, a kopia przykrywa sam kafel,
     * nie jego odbicie.
     */
    const reflBorder = (0.08 + 0.3 * front) * this.opt.reflectionBorder;
    if (reflBorder > 0.004) {
      rc.globalAlpha = reflAlpha;
      rc.lineWidth = this.geom.border;
      rc.strokeStyle = `rgba(200,255,61,${reflBorder})`;
      rc.beginPath();
      rc.moveTo(left.x, cy + left.half);
      rc.lineTo(right.x, cy + right.half);
      rc.lineTo(right.x, cy + 3 * right.half);
      rc.lineTo(left.x, cy + 3 * left.half);
      rc.closePath();
      rc.stroke();
    }

    rc.globalAlpha = 1;
  }

  /**
   * Kafel rysowany pionowymi paskami — każdy dostaje własną skalę z rzutu
   * perspektywicznego, co daje realne skrócenie, a nie zwykłe skalowanie.
   */
  _paintStrips(ctx, source, ang, offsetX, mirror = false) {
    const { cardW, cy } = this.geom;
    // skrócenie perspektywiczne zależy od obrotu kafla, nie od jego pozycji
    const turn = Math.abs(ang.sinRot);
    const flat = turn < 0.0015;
    const strips = flat ? 1 : clamp(Math.round(6 + 160 * turn), 6, this.opt.maxStrips);

    /*
     * Odbicie robi transformata, a NIE ujemna wysokość w `drawImage`.
     * Sprawdzone: przy ujemnej wysokości przeglądarka tylko normalizuje
     * prostokąt i rysuje obraz bez odwrócenia — wychodzi klon, nie odbicie.
     *
     * Lustro kładziemy na wysokości środka kafla (`cy`), a każdy pasek
     * rysujemy o `1,5 · dh` wyżej: po odbiciu ląduje wtedy dokładnie pod
     * własną dolną krawędzią. Jedna transformata na cały przebieg zamiast
     * jednej na pasek.
     */
    if (mirror) {
      ctx.save();
      ctx.translate(0, 2 * cy);
      ctx.scale(1, -1);
    }

    if (flat) {
      // Kafel na wprost trafia w całe piksele: przy teksturze o rozmiarze
      // zawartości daje to kopię 1:1 bez filtrowania.
      const rect = this._flatRect(ang);
      const dx = rect.x + Math.round(offsetX);
      ctx.drawImage(source, dx, mirror ? cy - 1.5 * rect.h : rect.y, rect.w, rect.h);
      if (mirror) ctx.restore();
      return;
    }

    // wymiary źródła czytamy z samego canvasu — kopie kanałowe mają mniejszą
    // rozdzielczość niż baza
    const srcW = source.width;
    const srcH = source.height;
    let prev = this._project(-cardW / 2, ang);
    for (let s = 0; s < strips; s += 1) {
      const u1 = (s + 1) / strips;
      const next = this._project((u1 - 0.5) * cardW, ang);
      const sx = (s / strips) * srcW;
      const sw = srcW / strips;
      const dx = prev.x + offsetX;
      const dw = next.x - prev.x + 1.15;
      const dh = prev.half + next.half;
      // Pasek odbity trafia pod własną dolną krawędź, a nie pod wspólną linię
      // podłogi — kafel obrócony ma tę krawędź ukośną i wyżej.
      ctx.drawImage(source, sx, 0, sw, srcH, dx, mirror ? cy - 1.5 * dh : cy - dh / 2, dw, dh);
      prev = next;
    }
    if (mirror) ctx.restore();
  }

  /** Odbicia narysowały już poszczególne kafle — tu zostaje wygaszenie. */
  _drawReflection(ctx, energy) {
    const { cy, cardH } = this.geom;
    const rc = this.reflCtx;
    const floorY = cy + cardH / 2;

    rc.setTransform(0.5, 0, 0, 0.5, 0, 0);
    const fade = rc.createLinearGradient(0, floorY, 0, floorY + cardH * 0.5);
    fade.addColorStop(0, `rgba(0,0,0,${0.36 + energy * 0.12})`);
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    rc.globalCompositeOperation = 'destination-in';
    rc.fillStyle = fade;
    rc.fillRect(0, 0, this.w, this.h);
    rc.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.refl, 0, 0, this.w, this.h);
  }

  _drawBloom(ctx, energy) {
    if (!this.supportsFilter) return;
    const bc = this.bloomCtx;
    const bw = this.bloom.width;
    const bh = this.bloom.height;
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    bc.globalAlpha = 1;
    bc.clearRect(0, 0, bw, bh);
    bc.filter = 'contrast(2.4) brightness(0.62) saturate(1.5) blur(4px)';
    bc.drawImage(this.stage, 0, 0, bw, bh);
    bc.filter = 'none';

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.26 + energy * 0.2 + this.burst * 0.12;
    ctx.drawImage(this.bloom, 0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Skanlinie, przemiatanie, ziarno i winieta — maskowane alfą sceny, więc
   * widać je wyłącznie na samych kaflach, a nie na tle strony.
   */
  /**
   * Stan siatki: jeden wpis na kafelek. Jasność losowana raz, ze schodków
   * (patrz `gridLevelMin` / `gridLevelStep`), i już stała — zmieniają się
   * tylko znak i numer przebiegu pasa.
   */
  /** Poziom startowy: losowany ze schodków, z wagą malejącą do najjaśniejszego. */
  _rollLevel() {
    const { count, weightSum, min, step } = this.levelScale;
    let ticket = Math.random() * weightSum;
    let k = 0;
    while (k < count - 1 && ticket >= count - k) {
      ticket -= count - k;
      k += 1;
    }
    // zaokrąglenie, żeby 0,1 × 3 nie wyszło 0,30000000000000004
    return Math.round((min + step * k) * 1000) / 1000;
  }

  _buildGrid() {
    const { gridCell, gridChars, gridLevelMin, gridLevelMax, gridLevelStep } = this.opt;
    const count = Math.max(1, Math.round((gridLevelMax - gridLevelMin) / gridLevelStep) + 1);
    // waga poziomu k to `count - k`, czyli 6 : 5 : 4 : 3 : 2 : 1 przy sześciu
    this.levelScale = {
      count,
      weightSum: (count * (count + 1)) / 2,
      min: gridLevelMin,
      step: gridLevelStep,
    };

    const cols = Math.ceil(this.overlay.width / gridCell);
    const rows = Math.ceil(this.overlay.height / gridCell);
    const n = cols * rows;
    const bright = new Float32Array(n);
    const char = new Uint8Array(n);
    const pass = new Int32Array(n).fill(-1);
    const step = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      // jasność losowana raz na całe życie kafelka i już się nie zmienia
      bright[i] = this._rollLevel();
      char[i] = Math.floor(Math.random() * gridChars.length);
    }
    this.grid = { cols, rows, bright, char, pass, step };
  }

  /**
   * Nakładka „ekranu” budowana w UKŁADZIE KAFLA, w jego rozdzielczości —
   * idzie potem przez ten sam rzut co obraz, więc skraca się razem z kaflem.
   *
   * Kafelki siatki rysowane są WYŁĄCZNIE w zasięgu pasa przemiatania. Poza nim
   * nie ma czego kryć, a każdy stały ślad siatki (choćby 5 % przyciemnienia)
   * zostawiałby szczeliny jaśniejsze od kafelków i rysował widoczną kratę.
   *
   * Znak w kafelku wymienia się, gdy przechodzi przez niego pas, a moment
   * zależy od jasności kafelka: im jaśniejszy, tym wcześniej — wyprzedzenie
   * sięga połowy szerokości pasa, więc jaśniejsze kafelki przeskakują jeszcze
   * zanim światło do nich dojdzie.
   *
   * Treść kafelka jest skokowa, ale ODSŁANIANIE jest płynne. Kafelki rysowane
   * są w pełnej własnej jasności, a dopiero na końcu przycinane gradientem
   * pasa przez `destination-in` — maska działa per piksel, więc światło
   * przechodzi przez kafelek, zamiast zapalać cały jego wiersz naraz.
   * Liczenie spadku jasności per kafelek dawało schodkowe pojawianie się
   * z przenikaniem, a nie latarkę.
   */
  _buildOverlay(energy, reduced) {
    const oc = this.overlayCtx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    const opt = this.opt;
    const grid = this.grid;

    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.globalCompositeOperation = 'source-over';
    oc.globalAlpha = 1;
    oc.clearRect(0, 0, w, h);

    if (!reduced && grid && this.glyphs) {
      const cell = opt.gridCell;
      const square = cell - opt.gridGap;
      const charCount = opt.gridChars.length;
      const half = h * opt.sweepWidth;
      const phase = (this.time * opt.sweepSpeed) % 1;
      const sweep = phase * (h + 4 * half) - 2 * half;
      const pass = Math.floor(this.time * opt.sweepSpeed);
      const peak = opt.gridReveal * (0.85 + 0.15 * energy);

      const swaps = opt.gridSwaps;
      const spacing = half * opt.gridSwapSpacing;

      const bandTop = sweep - half;
      const bandBottom = sweep + half;

      // Zakres wierszy jest szerszy od samego pasa, bo wymiany znaków wyprzedzają
      // światło. Rysujemy jednak tylko te wiersze, które pas realnie obejmuje.
      const first = Math.max(0, Math.floor((sweep - half * 1.6) / cell));
      const last = Math.min(grid.rows - 1, Math.ceil((sweep + half * 1.6) / cell));

      // Kolory ustawiane raz, jasność przez `globalAlpha` — inaczej każdy
      // kafelek kosztowałby dwa sklejane stringi `rgba(...)` na klatkę,
      // a kafelków jest tu ponad sześćset.
      oc.lineWidth = 1;
      oc.fillStyle = GRID_INK;
      const edgeColor = `rgb(${opt.gridEdgeColor})`;
      for (let r = first; r <= last; r += 1) {
        const y = r * cell;
        const mid = y + square / 2;
        const lit = y + square >= bandTop && y <= bandBottom;
        for (let col = 0; col < grid.cols; col += 1) {
          const i = r * grid.cols + col;
          const bright = grid.bright[i];

          if (grid.pass[i] !== pass) {
            grid.pass[i] = pass;
            grid.step[i] = 0;
          }
          // Kolejne wymiany w stałym odstępie od pierwszej, więc każda z nich
          // dziedziczy to samo wyprzedzenie zależne od jasności.
          while (grid.step[i] < swaps && sweep >= mid - half * bright + grid.step[i] * spacing) {
            // +1 i modulo po (n-1) gwarantuje, że znak naprawdę się zmieni
            grid.char[i] = (grid.char[i] + 1 + Math.floor(Math.random() * (charCount - 1))) % charCount;
            grid.step[i] += 1;
          }

          if (!lit) continue;
          // pełna własna jasność kafelka — spadek od pasa nakłada maska niżej
          const a = bright * peak;
          if (a < 0.012) continue;

          const x = col * cell;
          oc.globalAlpha = a * opt.gridFill;
          oc.fillRect(x, y, square, square);

          oc.globalAlpha = a;
          oc.drawImage(this.glyphs, grid.char[i] * square, 0, square, square, x, y, square, square);

          // obrys w kolorze znaku, wpuszczony o piksel
          oc.strokeStyle = GRID_INK;
          oc.globalAlpha = a * opt.gridOutline;
          oc.strokeRect(x + 1.5, y + 1.5, square - 3, square - 3);

          // zewnętrzna ramka w kolorze tła — rozdziela kafelki
          oc.strokeStyle = edgeColor;
          oc.globalAlpha = a * opt.gridEdge;
          oc.strokeRect(x + 0.5, y + 0.5, square - 1, square - 1);
        }
      }
      oc.globalAlpha = 1;

      // Płynne odsłanianie: gradient pasa jako maska alfy, per piksel.
      // Poza prostokątem pasa `destination-in` kasuje wszystko, więc kafelki
      // narysowane z wyprzedzeniem na potrzeby wymiany znaków znikają same.
      oc.globalCompositeOperation = 'destination-in';
      const beam = oc.createLinearGradient(0, bandTop, 0, bandBottom);
      for (const [stop, level] of BEAM_PROFILE) beam.addColorStop(stop, `rgba(0,0,0,${level})`);
      oc.fillStyle = beam;
      oc.fillRect(0, bandTop, w, half * 2);
      oc.globalCompositeOperation = 'source-over';
    }

    if (!reduced && this.noisePatterns) {
      const tile = this.noisePatterns[Math.floor(this.time * 18) % this.noisePatterns.length];
      const ox = -Math.floor(Math.random() * 160);
      const oy = -Math.floor(Math.random() * 160);
      oc.globalAlpha = 0.035 + energy * 0.05;
      oc.save();
      oc.translate(ox, oy);
      oc.fillStyle = tile;
      oc.fillRect(-ox, -oy, w, h);
      oc.restore();
      oc.globalAlpha = 1;
    }

    const vig = oc.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.26)');
    oc.fillStyle = vig;
    oc.fillRect(0, 0, w, h);
  }

  /** Rozerwane pasy obrazu — tym mocniejsze, im szybszy obrót. */
  _drawGlitch(ctx, energy) {
    const intensity = Math.max(energy, this.burst * 0.85);
    if (intensity < 0.12) return;

    const { w, h } = this;
    const snap = this.stageCtx;
    snap.setTransform(1, 0, 0, 1, 0, 0);
    snap.globalCompositeOperation = 'source-over';
    snap.globalAlpha = 1;
    snap.clearRect(0, 0, w, h);
    snap.drawImage(this.canvas, 0, 0);

    const scale = this.w / 1400;
    const bands = 1 + Math.floor(intensity * 3);
    for (let i = 0; i < bands; i += 1) {
      if (Math.random() > 0.3 + intensity * 0.45) continue;
      const bh = Math.max(2, Math.round((2 + Math.random() * 22) * intensity * scale));
      const by = Math.round(Math.random() * (h - bh));
      const dx = Math.round((Math.random() - 0.5) * 46 * intensity * scale);
      ctx.clearRect(0, by, w, bh);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(this.stage, 0, by, w, bh, dx, by, w, bh);
      if (Math.random() < 0.3) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.1 * intensity;
        ctx.drawImage(this.stage, 0, by, w, bh, dx + 8 * scale, by, w, bh);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── wejście ────────────────────────────────────────────────

  _bindInput() {
    const el = this.canvas;
    const unit = () => Math.max(160, this.canvas.getBoundingClientRect().width * 0.52);

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      this.pointer.active = true;
      this.pointer.id = e.pointerId;
      this.pointer.startX = e.clientX;
      this.pointer.lastX = e.clientX;
      this.pointer.lastT = performance.now();
      this.pointer.startPos = this.pos;
      this.pointer.vel = 0;
      this.pointer.moved = 0;
      this.vel = 0;
      el.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
      const dx = e.clientX - this.pointer.startX;
      this.pointer.moved = Math.max(this.pointer.moved, Math.abs(dx));
      this.pos = this.pointer.startPos - dx / unit();
      this.targetPos = this.pos;

      const now = performance.now();
      const dt = (now - this.pointer.lastT) / 1000;
      if (dt > 0.004) {
        this.pointer.vel = -((e.clientX - this.pointer.lastX) / unit()) / dt;
        this.pointer.lastX = e.clientX;
        this.pointer.lastT = now;
      }
      e.preventDefault();
    };

    const onUp = (e) => {
      if (!this.pointer.active || (e.pointerId != null && e.pointerId !== this.pointer.id)) return;
      this.pointer.active = false;
      el.releasePointerCapture?.(this.pointer.id);
      const flick = clamp(this.pointer.vel, -6, 6);
      const projected = this.pos + flick * 0.24;
      const anchor = Math.round(this.pos);
      const snapped = clamp(Math.round(projected), anchor - 1, anchor + 1);
      this.vel = flick;
      this.targetPos = snapped;
      this.index = wrapIndex(snapped, this.count);
    };

    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // pion zostawiamy stronie
      e.preventDefault();
      const now = performance.now();
      if (now < this.wheelLock) return;
      this.wheelAcc += e.deltaX;
      if (Math.abs(this.wheelAcc) > 80) {
        this.wheelAcc > 0 ? this.next() : this.prev();
        this.wheelAcc = 0;
        this.wheelLock = now + 320;
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    this.teardownInput = () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }

  _observe() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    if (this.frame !== this.canvas) this.resizeObserver.observe(this.frame);

    this.intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting;
        if (this.visible && !document.hidden) this.start();
        else this.stop();
      },
      { rootMargin: '120px' },
    );
    this.intersectionObserver.observe(this.canvas);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.visible) this.start();
    });
  }
}
