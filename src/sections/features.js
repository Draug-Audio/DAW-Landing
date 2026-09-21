/**
 * „Kluczowe funkcje”: klik w kafel rozsuwa go do rozmiaru całej tabeli.
 *
 * Dwie warstwy na wspólnym układzie siatki:
 * - tabela — kafle z treścią, która w trakcie animacji stoi w miejscu,
 * - rozwinięcie — box tła (`.feature-box`) i treść dużej karty
 *   (`.feature-detail`), obie leżące nad całą siatką.
 *
 * Otwarcie idzie krokami:
 * 1. z-index: kliknięty kafel nad box tła, box tła nad pozostałymi kaflami;
 * 2. jednocześnie, w jednym czasie i tej samej krzywej:
 *    - box tła rozwija się od prostokąta kafla do całej tabeli i zakrywa treść
 *      pozostałych kafli — animowane są jego krawędzie, nie przycięcie, bo na
 *      czas ruchu ma własny border (`clip-path` by go obciął),
 *    - treść dużej karty odsłania się własnym przycięciem od prostokąta kafla
 *      do całości, krok w krok z boxem,
 *    - treść kafla gaśnie, a treść dużej karty wchodzi;
 * 3. wysokość układu dopasowuje się do treści dużej karty.
 * Zwinięcie to te same kroki od końca, do kafla aktualnie pokazanej funkcji.
 *
 * Kroki łańcuchowane przez Web Animations API — każda animacja daje obietnicę
 * zakończenia, więc kolejność nie zależy od `transitionend`. Klawiatura: Esc
 * zwija, ← / → przełączają funkcje; fokus po otwarciu trafia na tytuł karty,
 * po zwinięciu wraca na kafel. Zakryte kafle dostają `inert`.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** czasy kroków w ms */
const TIME = { morph: 420, height: 320, swap: 240 };

export function mountFeatures(section) {
  const grid = section?.querySelector('.features__grid');
  const box = grid?.querySelector('.feature-box');
  const detail = grid?.querySelector('.feature-detail');
  if (!grid || !box || !detail) return;

  const tiles = [...grid.querySelectorAll('.feature')];
  const buttons = tiles.map((tile) => tile.querySelector('.feature__open'));
  const no = detail.querySelector('[data-detail-no]');
  const title = detail.querySelector('[data-detail-title]');
  const body = detail.querySelector('[data-detail-body]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = (t) => (reducedMotion ? 0 : t);

  let current = -1;
  let busy = false;

  /** odległości krawędzi kafla od krawędzi elementu `el`: góra, prawo, dół, lewo */
  const edgesOf = (el, tile) => {
    const r = el.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    return [t.top - r.top, r.right - t.right, r.bottom - t.bottom, t.left - r.left]
      .map((x) => `${Math.max(0, x)}px`);
  };
  /** prostokąt kafla jako `inset()` względem elementu `el` */
  const clipOf = (el, tile) => `inset(${edgesOf(el, tile).join(' ')})`;
  /** prostokąt kafla jako pozycja boxu tła */
  const boxAt = (tile) => {
    const [top, right, bottom, left] = edgesOf(box, tile);
    return { top, right, bottom, left };
  };
  const BOX_FULL = { top: '0px', right: '0px', bottom: '0px', left: '0px' };

  /**
   * Przejście kafel ↔ duża karta: box tła, przycięcie dużej karty i oba fade'y
   * w jednym czasie i na tej samej krzywej. `expand` — od kafla do całości.
   */
  const morph = async (tile, expand) => {
    const boxFrames = [boxAt(tile), BOX_FULL];
    const clipFrames = [{ clipPath: clipOf(detail, tile) }, { clipPath: 'inset(0)' }];
    const detailFade = [{ opacity: 0 }, { opacity: 1 }];
    const tileFade = [{ opacity: 1 }, { opacity: 0 }];
    const dir = (frames) => (expand ? frames : [...frames].reverse());
    const merge = (a, b) => a.map((frame, i) => ({ ...frame, ...b[i] }));

    // border boxu widoczny tylko na czas ruchu
    box.classList.add('is-moving');
    await Promise.all([
      run(box, dir(boxFrames), TIME.morph),
      run(detail, dir(merge(clipFrames, detailFade)), TIME.morph),
      run(tile, dir(tileFade), TIME.morph),
    ]);
    box.classList.remove('is-moving');
  };

  /** naturalna wysokość tabeli: dół ostatniego rzędu kafli plus obramowanie */
  const tableHeight = () => {
    const bottom = Math.max(...tiles.map((tile) => tile.offsetTop + tile.offsetHeight));
    return bottom + grid.clientTop * 2;
  };
  /** wysokość dużej karty z obramowaniem siatki */
  const detailHeight = () => detail.offsetHeight + grid.clientTop * 2;

  const run = (el, frames, duration, extra = {}) => {
    const anim = el.animate(frames, { duration: ms(duration), easing: EASE, fill: 'forwards', ...extra });
    return anim.finished;
  };

  const setHeight = async (to) => {
    const from = grid.offsetHeight;
    grid.style.height = `${to}px`;
    if (from === to || reducedMotion) return;
    await run(grid, [{ height: `${from}px` }, { height: `${to}px` }], TIME.height);
    grid.getAnimations().forEach((a) => a.cancel());
  };

  const render = (index) => {
    const tile = tiles[index];
    const pad = (n) => String(n).padStart(2, '0');
    no.textContent = `${pad(index + 1)}/${pad(tiles.length)}`;
    title.textContent = tile.querySelector('h3').textContent;
    body.replaceChildren(tile.querySelector('template').content.cloneNode(true));
    buttons.forEach((button, i) => button.setAttribute('aria-expanded', String(i === index)));
    current = index;
  };

  const open = async (index) => {
    if (busy || current >= 0) return;
    busy = true;
    const tile = tiles[index];

    // wysokość zablokowana na obecnej, żeby krok 4 miał skąd ruszyć
    grid.style.height = `${grid.offsetHeight}px`;
    grid.classList.add('is-open');

    // 1. z-index
    tile.classList.add('is-lifted');
    box.hidden = false;

    // 2. box tła, przycięcie dużej karty i fade obu treści — razem
    render(index);
    detail.hidden = false;
    await morph(tile, true);

    // 3. wysokość układu do treści dużej karty
    await setHeight(detailHeight());

    tiles.forEach((t) => { t.inert = true; });
    title.focus({ preventScroll: true });
    grid.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    busy = false;
  };

  const close = async () => {
    if (busy || current < 0) return;
    busy = true;
    const index = current;
    const tile = tiles[index];
    tiles.forEach((t) => { t.inert = false; });

    // 3 → wysokość z powrotem do tabeli
    await setHeight(tableHeight());

    // 2 → razem: treść kafla wraca, treść dużej karty gaśnie, jej przycięcie
    // i box tła zwijają się do prostokąta kafla aktualnej funkcji — nawigacja
    // strzałkami przenosi na niego podniesienie i schowaną treść
    await morph(tile, false);
    detail.hidden = true;
    box.hidden = true;
    [detail, box].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));

    // 1 → z-index i wysokość wracają do stanu spoczynku
    tiles.forEach((t) => {
      t.classList.remove('is-lifted');
      t.getAnimations().forEach((a) => a.cancel());
    });
    grid.classList.remove('is-open');
    grid.style.height = '';
    buttons[index].setAttribute('aria-expanded', 'false');
    current = -1;
    buttons[index].focus({ preventScroll: true });
    busy = false;
  };

  const step = async (delta) => {
    if (busy || current < 0) return;
    busy = true;
    const next = (current + delta + tiles.length) % tiles.length;
    // tytuł i treść wyjeżdżają w stronę przeciwną do kierunku zmiany,
    // nowe wjeżdżają z drugiej strony
    const slide = [title, body];
    const out = [{ opacity: 1 }, { opacity: 0, transform: `translateX(${-delta * 12}px)` }];
    const inn = [{ opacity: 0, transform: `translateX(${delta * 12}px)` }, { opacity: 1, transform: 'none' }];
    await Promise.all(slide.map((el) => run(el, out, TIME.swap / 2)));
    // stan „pod dużą kartą” przechodzi na kafel nowej funkcji: poprzedni
    // wraca pod box tła z widoczną treścią, nowy zostaje nad boxem ze
    // schowaną — inaczej przy zwijaniu do nowego kafla stary świeciłby
    // nad boxem pustym prostokątem
    const [prev, fresh] = [tiles[current], tiles[next]];
    prev.classList.remove('is-lifted');
    prev.getAnimations().forEach((a) => a.cancel());
    fresh.classList.add('is-lifted');
    fresh.animate([{ opacity: 0 }], { fill: 'forwards' });
    render(next);
    slide.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    await Promise.all([
      ...slide.map((el) => run(el, inn, TIME.swap / 2)),
      setHeight(detailHeight()),
    ]);
    slide.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    busy = false;
  };

  // zmiana szerokości przy otwartej karcie — wysokość układu za treścią
  new ResizeObserver(() => {
    if (current >= 0 && !busy) grid.style.height = `${detailHeight()}px`;
  }).observe(detail);

  buttons.forEach((button, i) => button.addEventListener('click', () => open(i)));
  detail.querySelector('[data-detail-prev]').addEventListener('click', () => step(-1));
  detail.querySelector('[data-detail-next]').addEventListener('click', () => step(1));
  detail.querySelector('[data-detail-close]').addEventListener('click', close);
  detail.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else return;
    event.preventDefault();
  });
}
