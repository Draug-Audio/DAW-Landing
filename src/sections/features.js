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
 * 2. box tła rozwija się od prostokąta kafla do całej tabeli (`clip-path`)
 *    i zakrywa treść pozostałych kafli;
 * 3. treść kafla gaśnie, a treść dużej karty wchodzi — z własnym animowanym
 *    przycięciem, od prostokąta kafla do całości;
 * 4. wysokość układu dopasowuje się do treści dużej karty.
 * Zwinięcie to te same kroki od końca, do kafla aktualnie pokazanej funkcji.
 *
 * Kroki łańcuchowane przez Web Animations API — każda animacja daje obietnicę
 * zakończenia, więc kolejność nie zależy od `transitionend`. Klawiatura: Esc
 * zwija, ← / → przełączają funkcje; fokus po otwarciu trafia na tytuł karty,
 * po zwinięciu wraca na kafel. Zakryte kafle dostają `inert`.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** czasy kroków w ms */
const TIME = { box: 420, fade: 200, reveal: 380, height: 320, swap: 240 };

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

  /** prostokąt kafla jako `inset()` względem elementu `el` (nie ujemny) */
  const clipOf = (el, tile) => {
    const r = el.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const v = [t.top - r.top, r.right - t.right, r.bottom - t.bottom, t.left - r.left];
    return `inset(${v.map((x) => `${Math.max(0, x)}px`).join(' ')})`;
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
    no.textContent = tile.querySelector('.feature__no').textContent;
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

    // 2. box tła od kafla do całej tabeli
    await run(box, [{ clipPath: clipOf(box, tile) }, { clipPath: 'inset(0)' }], TIME.box);

    // 3. treść kafla gaśnie, treść dużej karty wchodzi z własnym przycięciem
    render(index);
    detail.hidden = false;
    await Promise.all([
      run(tile, [{ opacity: 1 }, { opacity: 0 }], TIME.fade),
      run(detail, [
        { opacity: 0, clipPath: clipOf(detail, tile) },
        { opacity: 1, clipPath: 'inset(0)' },
      ], TIME.reveal),
    ]);

    // 4. wysokość układu do treści dużej karty
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

    // 4 → wysokość z powrotem do tabeli
    await setHeight(tableHeight());

    // 3 → treść dużej karty gaśnie do prostokąta kafla, treść kafla wraca;
    // po nawigacji strzałkami to może być inny kafel niż kliknięty, więc jego
    // treść najpierw chowamy, dopiero potem podnosimy go nad box
    tile.animate([{ opacity: 0 }], { fill: 'forwards' });
    tile.classList.add('is-lifted');
    await Promise.all([
      run(detail, [
        { opacity: 1, clipPath: 'inset(0)' },
        { opacity: 0, clipPath: clipOf(detail, tile) },
      ], TIME.reveal),
      run(tile, [{ opacity: 0 }, { opacity: 1 }], TIME.fade, { delay: ms(TIME.reveal - TIME.fade) }),
    ]);
    detail.hidden = true;
    detail.getAnimations().forEach((a) => a.cancel());

    // 2 → box tła zwija się do kafla
    await run(box, [{ clipPath: 'inset(0)' }, { clipPath: clipOf(box, tile) }], TIME.box);
    box.hidden = true;
    box.getAnimations().forEach((a) => a.cancel());

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
    await run(body, [{ opacity: 1 }, { opacity: 0, transform: `translateX(${-delta * 12}px)` }], TIME.swap / 2);
    render(next);
    body.getAnimations().forEach((a) => a.cancel());
    await Promise.all([
      run(body, [{ opacity: 0, transform: `translateX(${delta * 12}px)` }, { opacity: 1, transform: 'none' }], TIME.swap / 2),
      setHeight(detailHeight()),
    ]);
    body.getAnimations().forEach((a) => a.cancel());
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
