# Draug Audio Workstation — landing

Landing page przepisany z mockupu na projekt **Vite + SCSS**. Sekcje statyczne
są odwzorowaniem 1:1 stylów z mockupu; slider w hero jest napisany od zera
i renderuje się na `<canvas>`.

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # dist/
npm run preview
```

## Struktura

```
index.html              markup całej strony (semantyczne klasy zamiast inline style)
public/assets/          1–8.webp (zrzuty slajdów), logo, wtyczki, zdjęcie
src/
  main.js               punkt wejścia — style + montaż slidera
  data/slides.js        treść slajdów (src / numer / tytuł / opis)
  styles/               SCSS, jeden partial na sekcję
    _tokens.scss        paleta, typografia, rytm, breakpointy, miksiny
  slider/
    CanvasCarousel.js   silnik sceny 3D na canvasie
    captions.js         zsynchronizowany slider opisów + kropki
    texture.js          skalowanie zrzutów do rozmiaru sceny
    math.js             clamp / lerp / smoothstep / zawijanie po okręgu
Mockups/                oryginalne, spakowane pliki HTML (źródło projektu)
```

## Slider

Przedni kafel ma dokładnie szerokość kontenera treści; canvas jest od niego
szerszy (100vw), więc sąsiednie kafle wychodzą poza kontener aż po krawędzie
okna. Strzałki siedzą przy krawędziach kontenera od zewnątrz — rynna strony ma
tylko 28 px, więc całkiem poza kontener wychodzą dopiero powyżej 1512 px
szerokości okna; niżej siadają okrakiem na krawędzi, zamiast uciekać poza ekran.

Osiem kafli leży na okręgu wokół kamery (co 45°) i jest rzutowanych
perspektywicznie. Canvas 2D nie potrafi mapować tekstury na trapez, więc każdy
kafel rysowany jest **pionowymi paskami** — każdy pasek dostaje własną skalę
z rzutu, co daje realne skrócenie perspektywiczne zamiast zwykłego skalowania. Liczba pasków rośnie z
kątem obrotu; w spoczynku kafel jest płaski i idzie jednym `drawImage`, więc
zostaje piksel w piksel ostry. Promień okręgu liczony jest z cięciwy między
sąsiadami, więc rozstaw wygląda tak samo niezależnie od liczby slajdów, a
kafle odwrócone tyłem odpadają na podstawie odległości kamery od ich
płaszczyzny — dzięki temu zawinięcie indeksu jest niewidoczne.

**Pozycja na okręgu i obrót kafla są rozdzielone** (`tilt`). Przy kaflu
stycznym do okręgu (obrót = pozycja) wewnętrzna krawędź sąsiada wychyla się
przed płaszczyznę przedniego kafla i renderuje się od niego **większa** — kafel
stojący z tyłu wygląda na bliższy. Mniejszy obrót przy większym promieniu to
usuwa: w spoczynku żaden kafel nie przekracza skali 1,000 (zmierzone dla
wszystkich pozycji). Powyżej 1 skala wychodzi wyłącznie w trakcie obrotu, i to
jest poprawne — obracający się panel naprawdę zbliża jedną krawędź do kamery.

Wszystko, co dotyczy pojedynczego kafla, idzie za jego rzutem: poświata i
świetlista podłoga biorą jego rzutowane położenie i wymiary, a **odbicie jest
lustrzane względem własnej dolnej krawędzi kafla** — liczone per pasek, bo
kafel obrócony ma tę krawędź ukośną i wyżej niż kafel na wprost.

Ruchem steruje sprężyna (lekko niedotłumiona — dojazd ~0,5 s z minimalnym
przestrzeleniem). Pozycja jest **ciągła**, nie skokowa, więc wszystko, co od niej
zależy, jest zsynchronizowane w każdej klatce: obrót sceny, przenikanie opisów
i wypełnienie kropek — także w trakcie przeciągania myszą.

Efekty (skalowane energią ruchu, czyli liczbą slajdów na sekundę):

| efekt | jak działa |
| --- | --- |
| aberracja chromatyczna | kafel rysowany trzy razy do bufora pomocniczego, każdy przebieg przemnożony przez czysty kanał R/G/B (obcięcie do czworokąta jest konieczne — `multiply` na przezroczystym tle dałoby pełny kolor), potem składane addytywnie z przesunięciem; suma przy zerowym przesunięciu odtwarza oryginał (zmierzone: średnia różnica 0,8/255) |
| mgła głębi | gradient wzdłuż kafla liczony z realnej odległości krawędzi od kamery |
| poświata i podłoga | przypięte do kafla — przesuwają się i spłaszczają razem z nim; pełna moc na kaflu na wprost, słabsza na pobocznych |
| odblask krawędzi natarcia | gradient limonkowy po stronie, w którą leci kafel |
| odbicie | każdy kafel odbity względem własnej dolnej krawędzi, per pasek; wygaszane wspólnym gradientem (bufor w połowie rozdzielczości) |
| bloom | scena w 1/4 rozdzielczości, `contrast + blur`, dołożona w trybie `lighter` |
| skanlinie, ziarno, winieta, przemiatanie | maskowane alfą sceny (`destination-in`), więc widać je tylko na samych kaflach, nie na tle strony |
| rozerwane pasy obrazu | przy szybkim obrocie i przy zmianie slajdu |

Sterowanie: przeciąganie (z rzutem prędkości i zatrzaskiem), strzałki, kropki,
klawisze ←/→, poziomy scroll gładzika, autoodtwarzanie z paskiem postępu.
Pętla stoi, gdy sekcja jest poza ekranem albo karta jest w tle.
`prefers-reduced-motion` wyłącza autoodtwarzanie, aberrację, glitch i ziarno.

Wydajność przy 1920 × 919 px bufora i ośmiu slajdach: **0,35 ms/klatkę**
w spoczynku, **0,97 ms/klatkę** w ruchu. Tekstury ok. 32 MB, bufory ok. 20 MB.

## Uwagi

- Zrzuty slajdów (`1`–`8`) przekonwertowane z PNG na WebP: 2561 kB → 723 kB.
  Bezstratnie, żeby tekst interfejsu został ostry; wyjątkiem jest `2`, w dużej
  mierze fotograficzne GUI wtyczek, zapisane stratnie q97.
- Zdjęcie z sekcji „Jak powstał DAW” ważyło 6,3 MB (PNG 4606 × 2624).
  Tutaj jest jako WebP 2200 px / 283 kB — **z kanałem alfa**, bo to wycinanka
  na przezroczystym tle. Odrzucenie alfy przy konwersji odsłania surowe zielone
  piksele spod biurka.
- Treść slajdów (numer, tytuł, opis, plik) siedzi w `src/data/slides.js` —
  dodanie albo usunięcie pozycji nie wymaga zmian w silniku, kąt na okręgu
  i promień policzą się same.
- Fonty (Archivo, IBM Plex Mono) idą z Google Fonts zamiast 20 plików woff2
  zaszytych w mockupie.
- W trybie deweloperskim instancja slidera siedzi pod `window.__showcase`.
