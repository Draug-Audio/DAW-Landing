/**
 * „Kluczowe funkcje”: klik w kafel rozsuwa go do rozmiaru całej tabeli.
 *
 * Nad siatką leży jeden panel szczegółów. Otwarcie to przejście `clip-path`
 * od prostokąta klikniętego kafla do całego panelu — panel od początku ma
 * docelowy układ, a przycięcie tylko go odsłania, więc nic się nie przelicza
 * w trakcie animacji. Zwinięcie idzie odwrotnie, do kafla, który jest
 * aktualnie pokazany (po nawigacji strzałkami to może być inny niż kliknięty).
 *
 * Treść rozwiniętego widoku siedzi w `<template>` w każdym kafelku, a panel
 * tylko ją klonuje. Klawiatura: Esc zwija, ← / → przełączają funkcje; fokus
 * po otwarciu trafia na tytuł panelu, po zwinięciu wraca na kafel.
 */
export function mountFeatures(section) {
  const grid = section?.querySelector('.features__grid');
  const panel = grid?.querySelector('[data-detail-body]')?.closest('.feature-detail');
  if (!grid || !panel) return;

  const tiles = [...grid.querySelectorAll('.feature')];
  const buttons = tiles.map((tile) => tile.querySelector('.feature__open'));
  const no = panel.querySelector('[data-detail-no]');
  const title = panel.querySelector('[data-detail-title]');
  const body = panel.querySelector('[data-detail-body]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current = -1;

  /** prostokąt kafla jako `inset()` względem siatki */
  const clipOf = (tile) => {
    const g = grid.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    // siatka ma 1 px obramowania, a panel leży w jej wnętrzu
    const edge = grid.clientLeft;
    return `inset(${t.top - g.top - edge}px ${g.right - t.right - edge}px ${g.bottom - t.bottom - edge}px ${t.left - g.left - edge}px)`;
  };

  const render = (index) => {
    const tile = tiles[index];
    no.textContent = tile.querySelector('.feature__no').textContent;
    title.textContent = tile.querySelector('h3').textContent;
    body.replaceChildren(tile.querySelector('template').content.cloneNode(true));
    buttons.forEach((button, i) => button.setAttribute('aria-expanded', String(i === index)));
    current = index;
  };

  const open = (index) => {
    render(index);
    panel.hidden = false;
    if (!reducedMotion) {
      panel.style.transition = 'none';
      panel.style.clipPath = clipOf(tiles[index]);
      panel.getBoundingClientRect(); // start przejścia z prostokąta kafla
      panel.style.transition = '';
    }
    panel.style.clipPath = 'inset(0)';
    // dolny rząd kafli: góra panelu mogła zostać nad krawędzią ekranu
    grid.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    title.focus({ preventScroll: true });
  };

  const close = () => {
    if (current < 0) return;
    const index = current;
    const finish = () => {
      // otwarty ponownie w trakcie zwijania — nie chowamy
      if (current !== -1) return;
      panel.hidden = true;
      panel.style.clipPath = '';
      buttons[index].setAttribute('aria-expanded', 'false');
    };
    current = -1;
    buttons[index].focus({ preventScroll: true });
    if (reducedMotion) {
      finish();
      return;
    }
    panel.style.clipPath = clipOf(tiles[index]);
    // `transitionend` bąbelkuje — przejścia przycisków w panelu też by go
    // wyzwalały, więc czekamy na własne przejście panelu
    const onEnd = (event) => {
      if (event.target !== panel || event.propertyName !== 'clip-path') return;
      panel.removeEventListener('transitionend', onEnd);
      finish();
    };
    panel.addEventListener('transitionend', onEnd);
  };

  const step = (delta) => {
    const next = (current + delta + tiles.length) % tiles.length;
    render(next);
    if (!reducedMotion) {
      body.animate(
        [{ opacity: 0, transform: `translateX(${delta * 12}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
  };

  buttons.forEach((button, i) => button.addEventListener('click', () => open(i)));
  panel.querySelector('[data-detail-prev]').addEventListener('click', () => step(-1));
  panel.querySelector('[data-detail-next]').addEventListener('click', () => step(1));
  panel.querySelector('[data-detail-close]').addEventListener('click', close);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else return;
    event.preventDefault();
  });
}
