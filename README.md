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

**W trakcie przejścia para biorąca w nim udział dostaje dodatkowe
rozsunięcie kątowe** (`edgeMeet`), zerowe w spoczynku. Bez niego w połowie
drogi kafle nachodzą na siebie pasem szerokości ok. 0,15 szerokości kafla i
przenikają się; z nim mijają się, a dokładnie w połowie ich wewnętrzne
krawędzie schodzą się w jednym punkcie 3D — zmierzone nałożenie w połowie
wynosi 0. Kąt rozsunięcia nie jest wpisany na sztywno: silnik rozwiązuje
bisekcją `radius · sin(φ) = (cardW / 2) · cos(tilt · φ)`, czyli szuka kąta,
przy którym wewnętrzna krawędź trafia w oś sceny (przy ośmiu slajdach wychodzi
3,9°). Garb ma kształt `sign(rel) · sin²(π · rel)`, a nie `sin(π · rel)`, bo na
granicy `|rel| = 1` musi zerować się także pochodna — inaczej kafel szarpie
w momencie wyjścia z pary (zmierzona druga różnica kąta: 0,0077° dla `sin²`
wobec 0,1225° dla `sin`).

Wszystko, co dotyczy pojedynczego kafla, idzie za jego rzutem: poświata i
świetlista podłoga biorą jego rzutowane położenie i wymiary, **odbicie jest
lustrzane względem własnej dolnej krawędzi kafla** (liczone per pasek, bo kafel
obrócony ma tę krawędź ukośną i wyżej niż kafel na wprost), a **nakładka
„ekranu” — siatka pikseli, ziarno, przemiatanie i winieta — budowana jest
w układzie kafla i przepuszczana przez ten sam rzut co obraz**. Dzięki temu
skraca się razem z kaflem, a winieta jest wyśrodkowana na kaflu, nie na scenie.
Zmierzone: okres siatki na kaflu przednim 22 px, czyli dokładnie rozmiar
komórki (mapowanie 1:1), a na bocznym 19 px przy przewidzianych 19,24.

### Siatka wywoływana przemiataniem

Kafel jest pokryty siatką kafelków. Jeden kafelek to, od zewnątrz:
zewnętrzna ramka w kolorze tła strony (rozdziela kafelki), wpuszczony o piksel
obrys w kolorze znaku, ledwie widoczne limonkowe wypełnienie (12 % jasności
kafelka) i znak — losowa litera albo cyfra z
`runescript-monospace-variable.ttf`. Czcionka jest zmienna, więc waga idzie
z osi (350). Wszystkie znaki wypalane są raz do atlasu, więc rysowanie kafelka
to `drawImage` z wycinka, a nie skład tekstu co klatkę.

Kafelki rysowane są **wyłącznie w zasięgu pasa przemiatania**. Poza nim nie ma
czego kryć — a każdy stały ślad siatki, choćby 5 % przyciemnienia, zostawiałby
SZCZELINY jaśniejsze od kafelków i rysował widoczną kratę (zmierzone:
7,17/255 różnicy między wierszem kafelków a wierszem szczeliny wobec 0,59/255,
gdy siatki w spoczynku nie ma; oko wyłapuje regularny wzór dużo poniżej progu,
przy którym widzi szum). Stąd zachowanie jak latarki UV na liniach
papilarnych: siatki nie widać, dopóki nie przejdzie po niej pas.

**Znak wymienia się, gdy przechodzi przez niego pas, a moment zależy od
jasności kafelka — im jaśniejszy, tym wcześniej.** Wyprzedzenie sięga połowy
szerokości pasa, więc jaśniejsze kafelki przeskakują, zanim światło do nich
dojdzie. Zmierzona korelacja jasności z wyprzedzeniem na wierszu 43 kafelków:
**0,9983**; najciemniejsze (0,30) przeskakują przy wyprzedzeniu 0,27 szerokości
pasa, najjaśniejsze (0,96) przy 0,95.

Kafel na wprost jest rysowany **jednym `drawImage` na całych pikselach**.
Wcześniej „oddychał” mikroobrotem, przez co nigdy nie trafiał w gałąź płaską
i szedł przez siedem pasków o ułamkowych pozycjach — czyli był bez przerwy
przepróbkowywany, a siatka miała rozmyte krawędzie. Za ruch w spoczynku
odpowiada teraz samo przemiatanie. Nakładka ma dokładnie rozmiar kafla
w pikselach urządzenia, więc na kaflu na wprost mapuje się 1:1.

Efekty (skalowane energią ruchu, czyli liczbą slajdów na sekundę):

| efekt | jak działa |
| --- | --- |
| aberracja chromatyczna | kafel rysowany trzy razy do bufora pomocniczego, każdy przebieg przemnożony przez czysty kanał R/G/B (obcięcie do czworokąta jest konieczne — `multiply` na przezroczystym tle dałoby pełny kolor), potem składane addytywnie z przesunięciem; suma przy zerowym przesunięciu odtwarza oryginał (zmierzone: średnia różnica 0,8/255) |
| mgła głębi | gradient wzdłuż kafla liczony z realnej odległości krawędzi od kamery |
| poświata i podłoga | przypięte do kafla — przesuwają się i spłaszczają razem z nim; pełna moc na kaflu na wprost, słabsza na pobocznych |
| odblask krawędzi natarcia | gradient limonkowy po stronie, w którą leci kafel |
| odbicie | każdy kafel odbity względem własnej dolnej krawędzi, per pasek; wygaszane wspólnym gradientem (bufor w połowie rozdzielczości) |
| bloom | scena w 1/4 rozdzielczości, `contrast + blur`, dołożona w trybie `lighter` |
| siatka znaków, ziarno, winieta, przemiatanie | rysowane w układzie kafla i rzutowane razem z nim; na kaflach mocno skróconych słabsze, żeby zagęszczona siatka nie robiła mory |
| rozerwane pasy obrazu | przy szybkim obrocie i przy zmianie slajdu |

Sterowanie: przeciąganie (z rzutem prędkości i zatrzaskiem), strzałki, kropki,
klawisze ←/→, poziomy scroll gładzika, autoodtwarzanie z paskiem postępu.
Pętla stoi, gdy sekcja jest poza ekranem albo karta jest w tle.
`prefers-reduced-motion` wyłącza autoodtwarzanie, aberrację, glitch i ziarno.

Wydajność przy 1920 × 919 px bufora i ośmiu slajdach: **ok. 1 ms/klatkę**
w spoczynku i **ok. 1,6 ms/klatkę** w ruchu. Tekstury ok. 32 MB, bufory ok. 24 MB.

Liczby są zaokrąglone świadomie. Pomiar to mediana z siedmiu próbek po dziesięć
klatek, z przerwą między próbkami. Dłuższe pętle `_render` bez oddechu zapychają
kolejkę GPU i czasy rosną kilkukrotnie — to artefakt pomiaru, nie kosztu klatki,
więc podawanie tu wartości z dokładnością do setnych byłoby fikcją.

Spoczynek kosztuje tyle, bo w zasięgu pasa leży ok. 640 kafelków, a każdy to
wypełnienie, glif i dwie ramki. Jasność idzie przez `globalAlpha` przy stałych
kolorach — sklejanie `rgba(...)` per kafelek kosztowało 0,3 ms na klatkę.
Gdyby trzeba było zejść niżej: mniej kafelków (większa podziałka) albo wypiekanie
całych wierszy do bufora i przesuwanie ich, zamiast rysowania kafelek po kafelku.

Wartości sprzed i po zmianie wyglądu kafelka nie są porównywalne — pomiary
potrafią się rozjechać o połowę między sesjami panelu podglądu, więc liczby mają
sens jako rząd wielkości, nie jako różnica.

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
