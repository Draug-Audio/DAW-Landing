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

Odbicie robi **transformata**, a nie ujemna wysokość w `drawImage`. Sprawdzone
na wzorze z bielą u góry: po rysowaniu z ujemną wysokością biel nadal jest
u góry (`[255, 255, 0, 0, 0, 0, 0, 0]`) — przeglądarka normalizuje prostokąt
i rysuje obraz bez odwrócenia, więc wychodzi klon, nie odbicie. Lustro kładzione
jest więc na wysokości środka kafla, a każdy pasek rysowany o `1,5 · dh` wyżej,
żeby po odbiciu trafić pod własną dolną krawędź. Jedna transformata na cały
przebieg zamiast jednej na pasek. Zmierzona korelacja wierszy odbicia
z wierszami kafla: **+0,68 z lustrem, −0,20 z klonem**.

Wszystko, co dotyczy pojedynczego kafla, idzie za jego rzutem: poświata i
świetlista podłoga biorą jego rzutowane położenie i wymiary, **odbicie jest
lustrzane względem własnej dolnej krawędzi kafla** (liczone per pasek, bo kafel
obrócony ma tę krawędź ukośną i wyżej niż kafel na wprost), a **nakładka
„ekranu” — siatka pikseli, ziarno, przemiatanie i winieta — budowana jest
w układzie kafla i przepuszczana przez ten sam rzut co obraz**. Dzięki temu
skraca się razem z kaflem, a winieta jest wyśrodkowana na kaflu, nie na scenie.
Zmierzone: okres siatki na kaflu przednim 22 px, czyli dokładnie rozmiar
komórki (mapowanie 1:1), a na bocznym 19 px przy przewidzianych 19,24.

### Ostra kopia przedniego slajdu

Canvas rysuje kafel przez własny rzut i traci na tym ostrość, a landing ma
pokazywać interfejs. W spoczynku nad canvas podkładany jest więc zwykły `<img>`
w pełnej rozdzielczości, ustawiony co do piksela na kaflu — rysuje go renderer
przeglądarki.

Obie warstwy mają **to samo pole treści**, więc nic się między nimi nie
przesuwa. Kafel to 1382 px treści plus ramka po jednym pikselu z każdej strony
(razem 1384 = szerokość kontenera przy oknie 1920). Tekstura canvasu ma
dokładnie 1382 px, więc idzie 1:1 — ani skalowana, ani rozciągana. Nakładka
dostaje `box-sizing: border-box` i przezroczystą ramkę 1 px, przez co jej pole
treści też wynosi 1382 px, a pierścień odsłania obrys narysowany na canvasie.
Zmierzone: pole treści 1382 × 751 w obu warstwach, lewa krawędź treści 261,5
w obu.

Ramka ma równo jeden piksel urządzenia i leży POZA polem treści. Na kaflu na
wprost rysowana jest po całych pikselach — `_flatRect` zaokrągla prostokąt raz,
a obraz i obrys biorą go z tego samego miejsca. Zmierzone na przekroju przez
lewą krawędź: ramka zajmuje dokładnie jedną kolumnę pikseli (85, 106, 30),
sąsiednie z obu stron są tłem i treścią.

**Wraz z pojawianiem się kopii obrys przedniego kafla gaśnie na canvasie**
(`sharpCover`), a przejmuje go ramka nakładki — wtedy i obraz, i ramka idą
z renderera przeglądarki, więc obie są ostre i dokładnie jednopikselowe.
Postęp liczony jest z czasu, bo przejście jest liniowe i znamy jego start;
odczytywanie `opacity` z `getComputedStyle` co klatkę wymuszałoby przeliczanie
stylów. Zmierzone wygaszanie obrysu: `cover` 0 → (83, 105, 29), 0,25 →
(66, 83, 25), 0,5 → (49, 59, 20), 0,75 → (30, 36, 15), 1 → (13, 14, 11).
Przekazanie działa w obie strony w tej samej klatce: po zatrzymaniu obrys na
canvasie jest zgaszony przy `opacity` nakładki 1, a tuż po ruszeniu wraca
(76, 97, 34) przy `opacity` 0.

Przy ruchu karuzeli kopia znika **natychmiast** (`transition: none`, żeby nie
wlokła się za kaflem), po zatrzymaniu wraca liniowym fadem 280 ms. Zmierzone:
w ruchu `opacity` 0 z `transition: none`, 30 ms po zatrzymaniu 0,109 przy
`280ms linear`, potem 1.

Stąd podział na dwa pliki na slajd. `N-lo.webp` (1536 px) idzie do tekstur
canvasu i wczytuje się od razu dla wszystkich ośmiu — razem 379 kB zamiast
723 kB. `N.webp` (2560 px) doczytuje się leniwie i tylko dla slajdu, na którym
karuzela stanęła; jeśli nie zdąży, kafel po prostu zostaje dłużej miękki
i wyostrzy się, gdy plik dojdzie.

Na ekranach HiDPI canvas nie idzie pełnym dpr (limit 1,25) — tam ostrość
w spoczynku zapewnia kopia w DOM, a w ruchu i tak gubi ją rzut perspektywiczny.
Przy dpr 1 mnożnik wynosi 1, więc kafel wychodzi 1:1, a bufor nie schodzi
poniżej rozdzielczości CSS.

Siatka jest przy okazji **akcentem kafli pobocznych** — krycie skalowane przez
`1 - front`, więc przedni jej nie dostaje i przebieg pasków na nim w ogóle nie
rusza. W spoczynku i tak przykrywałaby ją ostra kopia.

### Siatka wywoływana przemiataniem

Kafel jest pokryty siatką kafelków. Jeden kafelek to, od zewnątrz:
zewnętrzna ramka w kolorze tła strony (rozdziela kafelki), wpuszczony o piksel
obrys w kolorze znaku, ledwie widoczne limonkowe wypełnienie (12 % jasności
kafelka) i znak — losowa litera albo cyfra z
`runescript-monospace-variable.ttf`. Czcionka jest zmienna, więc waga idzie
z osi (100, czyli jej dolny kraniec), a rozmiar podawany jest wprost
(`gridFontSize`, 16 px), nie jako ułamek kafelka — przy tak cienkich wagach to
rozmiar decyduje, czy kreska zmieści się w pikselu. Przy 16 px i wadze 100 kreska jest
podpikselowa, więc runy wyglądają na lekko rozmyte. To jest wybór, nie
niedopatrzenie: w tej scenie liczy się jak najmniejsza ilość tuszu, a nie
czytelność pojedynczej runy.

**Canvas nie hintuje**, więc wyrównanie pozycji do całych pikseli nic nie daje
— zmierzone: identyczny udział pikseli pełnych (0,147) i ta sama maksymalna
alfa (241) dla pozycji ułamkowej, całkowitej i przy
`textRendering: geometricPrecision`. Pełny piksel wymusiłby dopiero obrys
dorysowany pod wypełnieniem (`gridGlyphStroke`), ale kosztem tuszu:

| minimalna kreska | piksele pełne | maks. alfa | tusz |
| --- | --- | --- | --- |
| **brak (tak zostaje)** | **0,147** | **241** | **300** |
| 0,2 px | 0,356 | 253 | 426 |
| 0,3 px | 0,426 | 255 | 465 |
| 0,4 px | 0,484 | 255 | 497 |
| waga 400 bez obrysu | 0,431 | 255 | 488 |

Niezależnie od tego `FontFace` musi dostać zakres `weight: '100 900'`, inaczej
zgłasza się jako statyczny krój 400, przeglądarka w ogóle nie sięga po oś
i każda waga poniżej 600 renderuje się identycznie (a powyżej — syntetycznie
pogrubia). Sprawdzenie: ilość „tuszu” w atlasie musi rosnąć monotonicznie
z wagą (100 → 243, 200 → 277, 400 → 381, 700 → 534, 900 → 637). Wszystkie znaki wypalane są raz do atlasu, więc rysowanie kafelka
to `drawImage` z wycinka, a nie skład tekstu co klatkę.

Jasność kafelka nie jest losowana z ciągłego przedziału, tylko ze **schodków**:
pełne ułamki 0,1 – 0,6 co 0,1. Poziom losowany jest z wagą malejącą do
najjaśniejszego (6 : 5 : 4 : 3 : 2 : 1), więc jasne kafelki są rzadkie i czytają
się jak pojedyncze błyski — zmierzone na 23 760 losowaniach: 0,2835 / 0,2385 /
0,1943 / 0,1409 / 0,0942 / 0,0487 wobec oczekiwanych 0,2857 / 0,2381 / 0,1905 /
0,1429 / 0,0952 / 0,0476.

Poziom jest losowany raz i **stały przez całe życie kafelka** — zmienia się
tylko znak. Dzięki temu ta rzadkość się utrzymuje: zmiana poziomu przy każdej
wymianie znaku (błądzenie po ±1 schodku) ma rozkład stacjonarny równomierny
i wypłaszczyłaby rozkład do 0,17 na poziom w kilka minut, czyli siatka robiłaby
się z czasem coraz jaśniejsza.

Kafelki rysowane są **wyłącznie w zasięgu pasa przemiatania**. Poza nim nie ma
czego kryć — a każdy stały ślad siatki, choćby 5 % przyciemnienia, zostawiałby
SZCZELINY jaśniejsze od kafelków i rysował widoczną kratę (zmierzone:
7,17/255 różnicy między wierszem kafelków a wierszem szczeliny wobec 0,59/255,
gdy siatki w spoczynku nie ma; oko wyłapuje regularny wzór dużo poniżej progu,
przy którym widzi szum). Stąd zachowanie jak latarki UV na liniach
papilarnych: siatki nie widać, dopóki nie przejdzie po niej pas.

**Znak wymienia się dwa razy na przejście pasa, a moment pierwszej wymiany
zależy od jasności kafelka — im jaśniejszy, tym wcześniej.** Wyprzedzenie sięga
połowy szerokości pasa, więc jaśniejsze kafelki przeskakują, zanim światło do
nich dojdzie. Druga wymiana idzie w stałym odstępie (`gridSwapSpacing`) od
pierwszej, więc dziedziczy to samo wyprzedzenie.

**Treść kafelka jest skokowa, ale odsłanianie płynne.** Kafelki rysowane są
w pełnej własnej jasności, a dopiero na końcu przycinane gradientem pasa przez
`destination-in` — maska działa per piksel, więc światło przechodzi przez
kafelek, zamiast zapalać cały jego wiersz naraz. Liczenie spadku jasności per
kafelek (z jego środka) dawało schodkowe pojawianie się z przenikaniem, a nie
latarkę.

Zmierzone przy górnej krawędzi pasa wypadającej w połowie wiersza kafelków
(288 – 320 px): wkład kafelków rośnie **0 → 0,21 → 0,54 → 0,69 → 0,93 → 4,44**
w obrębie jednego wiersza. A na stałej wysokości, gdy pas przez nią przechodzi:
**0 → 0,76 → 2,37 → 5,30 → 9,01 → 13,76 → 18,45 → 19,47 → 19,15 → 14,32** —
gładki narost, plateau w rdzeniu, gładki spadek.

Zmierzona korelacja jasności z wyprzedzeniem pierwszej wymiany na wierszu
43 kafelków: **0,9983**; najciemniejsze (0,30) przeskakują przy wyprzedzeniu
0,27 szerokości pasa, najjaśniejsze (0,99) przy 0,95. Odstęp obu wymian wychodzi
0,79 – 0,80 przy nastawie 0,8, niezależnie od jasności.

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
| odbicie | każdy kafel odbity względem własnej dolnej krawędzi, per pasek, razem z nakładką — przemiatanie przechodzi przez odbicie, a nie urywa się na krawędzi kafla; siła nakładki liczona od tej na kaflu, więc odbicie przedniego zostaje czyste; wygaszane wspólnym gradientem (bufor w połowie rozdzielczości) |
| bloom | scena w 1/4 rozdzielczości, `contrast + blur`, dołożona w trybie `lighter` |
| siatka znaków, ziarno, winieta, przemiatanie | rysowane w układzie kafla i rzutowane razem z nim; na kaflach mocno skróconych słabsze, żeby zagęszczona siatka nie robiła mory |
| rozerwane pasy obrazu | przy szybkim obrocie i przy zmianie slajdu |

Sterowanie: przeciąganie (z rzutem prędkości i zatrzaskiem), strzałki, kropki,
klawisze ←/→, poziomy scroll gładzika, autoodtwarzanie z paskiem postępu.
Pętla stoi, gdy sekcja jest poza ekranem albo karta jest w tle.
`prefers-reduced-motion` wyłącza autoodtwarzanie, aberrację, glitch i ziarno.

Wydajność przy 1920 × 919 px bufora i ośmiu slajdach: **ok. 1,0 ms/klatkę**
w spoczynku i **ok. 1,8 ms/klatkę** w ruchu. Tekstury ok. 32 MB.

Liczby są zaokrąglone świadomie. Pomiar to mediana z siedmiu próbek po dziesięć
klatek, z przerwą między próbkami. Dłuższe pętle `_render` bez oddechu zapychają
kolejkę GPU i czasy rosną kilkukrotnie — to artefakt pomiaru, nie kosztu klatki,
więc podawanie tu wartości z dokładnością do setnych byłoby fikcją.

Spoczynek kosztuje tyle, bo w zasięgu pasa leży ok. 200 kafelków, a każdy to
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
