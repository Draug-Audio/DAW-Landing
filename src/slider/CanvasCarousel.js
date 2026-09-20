import { clamp, lerp, smoothstep, wrapDelta, wrapIndex } from './math.js';
import { context2d, makeCanvas, makeNoiseTile, makeScanlineTile } from './texture.js';

const DEG = Math.PI / 180;

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
  /** maks. rozjazd kanałów RGB w px przy pełnej prędkości */
  aberration: 11,
  stiffness: 120,
  damping: 18.5,
  maxDpr: 2,
  maxBackingWidth: 2400,
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

    this.noise = [makeNoiseTile(), makeNoiseTile(), makeNoiseTile()];
    this.scanTile = makeScanlineTile(4);

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
    for (const ctx of [this.ctx, this.stageCtx, this.workCtx, this.reflCtx, this.bloomCtx, this.fxCtx]) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    this.scanPattern = this.ctx.createPattern(this.scanTile, 'repeat');
    this.noisePatterns = this.noise.map((tile) => this.ctx.createPattern(tile, 'repeat'));
    this._geometry();
    this._render(0);
  }

  _geometry() {
    const { w, h, opt } = this;
    const aspect = this.textures[0].aspect;
    // przedni kafel ma szerokość kontenera; sąsiedzi wychodzą poza canvas
    let cardW = Math.min(this.cardWidth || w * opt.frontWidth, w);
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

    // delikatne „oddychanie” w spoczynku, żeby scena nigdy nie zamarzała
    const idle = reduced ? 0 : Math.sin(this.time * 0.42) * 0.013 * (1 - this.energy);
    const renderPos = this.pos + idle;
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

    for (const card of order) this._drawCardGlow(ctx, card, energy);
    for (const card of order) this._drawCard(card, energy);

    this._drawReflection(ctx, energy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.stage, 0, 0);

    this._drawBloom(ctx, energy);
    this._drawScreenOverlay(ctx, energy, reduced);
    if (!reduced) this._drawGlitch(ctx, energy);

    this.onFrame?.({ position: renderPos, energy, burst: this.burst, index: this.index });
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

    // odblask na krawędzi natarcia
    if (front < 0.999) {
      const leading = rel > 0 ? left : right;
      const trailing = rel > 0 ? right : left;
      const rim = ctx.createLinearGradient(leading.x, 0, trailing.x, 0);
      rim.addColorStop(0, `rgba(200,255,61,${0.1 + 0.22 * (1 - front) * (0.3 + energy)})`);
      rim.addColorStop(0.16, 'rgba(200,255,61,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rim;
      quad(ctx);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();

    // obrys kafla
    ctx.save();
    quad(ctx);
    ctx.lineWidth = Math.max(1, this.w / 1400);
    ctx.strokeStyle = `rgba(200,255,61,${0.08 + 0.3 * front})`;
    ctx.stroke();
    ctx.restore();

    this.stageCtx.globalAlpha = edgeFade;
    this.stageCtx.drawImage(this.work, bx, by, bw, bh, bx, by, bw, bh);
    this.stageCtx.globalAlpha = 1;

    // odbicie tego kafla — bufor pracuje w połowie rozdzielczości, ale
    // współrzędne zostają pełne dzięki skali w transformacie
    const rc = this.reflCtx;
    rc.globalAlpha = edgeFade * (0.3 + 0.7 * front);
    this._paintStrips(rc, tex.base, ang, 0, true);
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
    const flat = turn < 0.004;
    const strips = flat ? 1 : clamp(Math.round(6 + 160 * turn), 6, this.opt.maxStrips);

    if (flat) {
      const l = this._project(-cardW / 2, ang);
      const r = this._project(cardW / 2, ang);
      const dh = l.half + r.half;
      // ujemna wysokość odwraca obraz w pionie (drawImage, spec HTML)
      if (mirror) ctx.drawImage(source, l.x + offsetX, cy + 1.5 * dh, r.x - l.x, -dh);
      else ctx.drawImage(source, l.x + offsetX, cy - dh / 2, r.x - l.x, dh);
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
      // Odbicie liczone per pasek, względem WŁASNEJ dolnej krawędzi kafla.
      // Jedna wspólna linia lustra byłaby poprawna tylko dla kafla na wprost —
      // kafel obrócony ma dolną krawędź ukośną i wyżej.
      if (mirror) ctx.drawImage(source, sx, 0, sw, srcH, dx, cy + 1.5 * dh, dw, -dh);
      else ctx.drawImage(source, sx, 0, sw, srcH, dx, cy - dh / 2, dw, dh);
      prev = next;
    }
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
  _drawScreenOverlay(ctx, energy, reduced) {
    const { w, h, geom } = this;
    const oc = this.workCtx;
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.globalCompositeOperation = 'source-over';
    oc.globalAlpha = 1;
    oc.clearRect(0, 0, w, h);

    if (this.scanPattern) {
      oc.globalAlpha = 0.085 + energy * 0.05;
      oc.fillStyle = this.scanPattern;
      oc.fillRect(0, 0, w, h);
    }

    if (!reduced && this.noisePatterns) {
      const tile = this.noisePatterns[Math.floor(this.time * 18) % this.noisePatterns.length];
      const ox = -Math.floor(Math.random() * 160);
      const oy = -Math.floor(Math.random() * 160);
      oc.globalAlpha = 0.05 + energy * 0.06;
      oc.globalCompositeOperation = 'overlay';
      oc.save();
      oc.translate(ox, oy);
      oc.fillStyle = tile;
      oc.fillRect(-ox, -oy, w, h);
      oc.restore();
      oc.globalCompositeOperation = 'source-over';
    }

    if (!reduced) {
      // pionowe przemiatanie co ~7 s
      const sweep = ((this.time * 0.14) % 1) * (h * 1.6) - h * 0.3;
      const band = oc.createLinearGradient(0, sweep - h * 0.1, 0, sweep + h * 0.1);
      band.addColorStop(0, 'rgba(200,255,61,0)');
      band.addColorStop(0.5, 'rgba(200,255,61,0.07)');
      band.addColorStop(1, 'rgba(200,255,61,0)');
      oc.globalCompositeOperation = 'lighter';
      oc.globalAlpha = 1;
      oc.fillStyle = band;
      oc.fillRect(0, sweep - h * 0.1, w, h * 0.2);
      oc.globalCompositeOperation = 'source-over';
    }

    const vig = oc.createRadialGradient(geom.cx, geom.cy, geom.cardW * 0.3, geom.cx, geom.cy, geom.cardW * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.26)');
    oc.globalAlpha = 1;
    oc.fillStyle = vig;
    oc.fillRect(0, 0, w, h);

    oc.globalCompositeOperation = 'destination-in';
    oc.drawImage(this.stage, 0, 0);
    oc.globalCompositeOperation = 'source-over';

    ctx.globalAlpha = 1;
    ctx.drawImage(this.work, 0, 0);
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
