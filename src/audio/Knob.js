import { clamp } from '../slider/math.js';

/**
 * Gałka w stylu DAW: łuk wartości na 270°, od 7:30 do 4:30 zgodnie z ruchem
 * wskazówek zegara, z przerwą na dole.
 *
 * Sterowanie jak w DAW:
 * - przeciąganie w pionie — w górę więcej, w dół mniej; pełny zakres na
 *   `DRAG_RANGE` px, z Shiftem pięć razy dokładniej,
 * - kółko myszy nad gałką,
 * - dwuklik — powrót do wartości domyślnej,
 * - klawiatura: strzałki (z Shiftem po 10), PageUp / PageDown, Home / End.
 *
 * Dla czytników ekranu to zwykły `role="slider"` z wartością w procentach.
 */

const SWEEP = 270;
const START = -135;
const DRAG_RANGE = 180;
const SIZE = 32;
const C = SIZE / 2;
const NS = 'http://www.w3.org/2000/svg';

/** punkt na okręgu; kąt w stopniach od godziny 12, zgodnie z ruchem wskazówek */
function point(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function arc(r, from, to) {
  const [x0, y0] = point(r, from);
  const [x1, y1] = point(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0.toFixed(3)} ${y0.toFixed(3)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export class Knob {
  /**
   * @param {HTMLElement} root element z `role="slider"`
   * @param {{value?: number, defaultValue?: number, valueEl?: HTMLElement,
   *          onInput?: (value: number) => void}} [options]
   */
  constructor(root, { value = 0.5, defaultValue = value, valueEl, onInput } = {}) {
    this.root = root;
    this.defaultValue = defaultValue;
    this.valueEl = valueEl;
    this.onInput = onInput;
    this.value = -1;

    root.setAttribute('role', 'slider');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
    root.tabIndex = 0;
    this._build();
    this._bind();
    this.set(value, { silent: true });
  }

  set(value, { silent = false } = {}) {
    const v = clamp(Math.round(value * 1000) / 1000, 0, 1);
    if (v === this.value) return;
    this.value = v;
    this._render();
    if (!silent) this.onInput?.(v);
  }

  _build() {
    const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, 'aria-hidden': 'true' });
    const end = START + SWEEP;
    // nóżki na końcach zakresu — wystają na zewnątrz toru, jak na skali gałki
    for (const deg of [START, end]) {
      const [x0, y0] = point(13.6, deg);
      const [x1, y1] = point(16, deg);
      svg.append(el('line', { class: 'knob__tick', x1: x0, y1: y0, x2: x1, y2: y1 }));
    }
    svg.append(el('path', { class: 'knob__track', d: arc(13, START, end) }));
    this.valueArc = el('path', { class: 'knob__arc' });
    svg.append(this.valueArc);
    svg.append(el('circle', { class: 'knob__body', cx: C, cy: C, r: 10.4 }));
    svg.append(el('path', { class: 'knob__rim', d: arc(8, START, end) }));
    svg.append(el('circle', { class: 'knob__hub', cx: C, cy: C, r: 2.4 }));
    this.pointerInner = el('line', { class: 'knob__pointer knob__pointer--inner' });
    this.pointerOuter = el('line', { class: 'knob__pointer' });
    svg.append(this.pointerInner, this.pointerOuter);
    this.root.append(svg);
  }

  _render() {
    const deg = START + this.value * SWEEP;
    if (this.value > 0.001) this.valueArc.setAttribute('d', arc(13, START, deg));
    else this.valueArc.removeAttribute('d');

    // wskaźnik: ciemniejszy przy piaście, jasny na końcu — jak na podglądzie
    const [ax, ay] = point(2.4, deg);
    const [bx, by] = point(5, deg);
    const [cx, cy] = point(8.6, deg);
    Object.entries({ x1: ax, y1: ay, x2: bx, y2: by }).forEach(([k, v]) => this.pointerInner.setAttribute(k, v.toFixed(3)));
    Object.entries({ x1: bx, y1: by, x2: cx, y2: cy }).forEach(([k, v]) => this.pointerOuter.setAttribute(k, v.toFixed(3)));

    const pct = Math.round(this.value * 100);
    this.root.setAttribute('aria-valuenow', String(pct));
    this.root.setAttribute('aria-valuetext', `${pct}%`);
    if (this.valueEl) this.valueEl.textContent = `${pct}%`;
  }

  _bind() {
    const { root } = this;
    let drag = null;

    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, y: e.clientY, value: this.value };
      root.setPointerCapture(e.pointerId);
      root.classList.add('is-dragging');
      root.focus({ preventScroll: true });
      e.preventDefault();
    });
    root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const range = e.shiftKey ? DRAG_RANGE * 5 : DRAG_RANGE;
      // punkt odniesienia przesuwa się razem z ruchem — wciśnięcie Shifta
      // w trakcie zmienia czułość, a nie przeskakuje wartości. Suma idzie
      // bez zaokrągleń, bo `set` zaokrągla do 0,1 % i przy setkach zdarzeń
      // ruchu błąd by się kumulował.
      drag.value = clamp(drag.value + (drag.y - e.clientY) / range, 0, 1);
      drag.y = e.clientY;
      this.set(drag.value);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      root.classList.remove('is-dragging');
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);

    root.addEventListener('dblclick', () => this.set(this.defaultValue));

    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.03;
      this.set(this.value - Math.sign(e.deltaY) * step);
    }, { passive: false });

    root.addEventListener('keydown', (e) => {
      const big = 0.1;
      const small = e.shiftKey ? big : 0.01;
      const moves = {
        ArrowUp: small, ArrowRight: small, ArrowDown: -small, ArrowLeft: -small,
        PageUp: big, PageDown: -big,
      };
      if (e.key in moves) this.set(this.value + moves[e.key]);
      else if (e.key === 'Home') this.set(0);
      else if (e.key === 'End') this.set(1);
      else return;
      e.preventDefault();
    });
  }
}
