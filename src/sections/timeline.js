/**
 * Dymki osi czasu dopasowane szerokością do treści.
 *
 * `width: fit-content` nie wystarcza: gdy tekst się łamie, pudełko bierze całą
 * dostępną szerokość, choć najdłuższa linia kończy się dużo wcześniej — po
 * prawej zostaje pusty pas. Skrypt mierzy faktyczne linie tekstu (prostokąty
 * `Range`) i ustawia dymkowi szerokość najdłuższej z nich plus padding
 * i obramowanie. Przy zmianie szerokości osi pomiar idzie od nowa: najpierw
 * zdjęcie wszystkich szerokości, potem odczyty, na końcu zapisy — bez
 * przeplatania, które wymuszałoby przeliczanie układu przy każdym dymku.
 *
 * Druga rzecz: linia osi ma iść dokładnie pod kreską między pierwszą a drugą
 * kolumną siatki „Kluczowych funkcji” (`alignTo`), której przedłużeniem jest
 * na szerokim ekranie. Skrypt mierzy obie i ustawia `--axis-shift` — różnicę
 * lewych krawędzi, zwykle ułamek piksela, który po zaokrągleniu dawał
 * widoczny schodek 1 px. Gdy kolumny nie leżą obok siebie albo odcinek nad osią
 * jest ukryty (wąski ekran), przesunięcia nie ma.
 */

const range = document.createRange();

/** szerokość najdłuższej linii tekstu w elemencie */
const longestLine = (el) => {
  range.selectNodeContents(el);
  let left = Infinity;
  let right = -Infinity;
  for (const r of range.getClientRects()) {
    if (!r.width) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  return right > left ? right - left : 0;
};

export function mountTimeline(timeline, { alignTo } = {}) {
  if (!timeline) return;
  const cards = [...timeline.querySelectorAll('.timeline__card')];
  const leadIn = timeline.querySelector('.timeline__lead-in span');
  const tiles = alignTo ? [...alignTo.children].filter((el) => el.matches('.feature')) : [];

  const align = () => {
    timeline.style.removeProperty('--axis-shift');
    if (!leadIn || tiles.length < 2 || !leadIn.offsetParent) return;
    const [a, b] = tiles.map((tile) => tile.getBoundingClientRect());
    // kolumny obok siebie w jednym rzędzie — inaczej nie ma kreski nad osią
    if (Math.abs(a.top - b.top) > 1 || b.left <= a.right - 1) return;
    const shift = a.right - leadIn.getBoundingClientRect().left;
    // przesunięcie tylko korekcyjne; większe znaczy, że układ jest inny
    if (Math.abs(shift) < 4) timeline.style.setProperty('--axis-shift', `${shift}px`);
  };

  const fit = () => {
    cards.forEach((card) => { card.style.width = ''; });
    const widths = cards.map((card) => {
      const cs = getComputedStyle(card);
      const chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
        + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const text = Math.max(...[...card.children].map(longestLine));
      // zaokrąglenie w górę — ułamek piksela mniej złamałby linię od nowa
      return Math.ceil(text + chrome);
    });
    cards.forEach((card, i) => { card.style.width = `${widths[i]}px`; });
  };

  let width = 0;
  new ResizeObserver(([entry]) => {
    // tylko zmiana szerokości; własne zmiany dymków nie zmieniają szerokości osi
    const w = Math.round(entry.contentRect.width);
    if (w === width) return;
    width = w;
    fit();
    align();
  }).observe(timeline);
  // siatka funkcji może zmienić szerokość niezależnie od osi
  if (alignTo) new ResizeObserver(align).observe(alignTo);
  // font z sieci zmienia szerokości linii
  document.fonts?.ready.then(fit);
}
