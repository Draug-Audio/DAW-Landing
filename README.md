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
  main.js               punkt wejścia — style, slider, muzyka i pierścienie
  data/slides.js        treść slajdów (src / numer / tytuł / opis)
  data/track.js         muzyka w tle: plik, tempo, pierwsza „raz”, obwiednia
  audio/
    BackgroundSound.js  muzyka w tle, wyłącznik, głośność, analiza widma L / środek / P
    SoundPlayer.js      odtwarzacz na środku paska: play / pauza, oś czasu, gałka
    Knob.js             gałka w stylu DAW (270°, przeciąganie w pionie, klawiatura)
    SpeakerRings.js     okręgi w hero i w sekcji agenta jako kolumny głośnikowe
    SpectrumGrid.js     retro analizator widma za zdjęciem w „Jak powstał DAW”
    spectrum.js         wspólna kalibracja widma (nachylenie, bramka ciszy, okno)
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

**Scena to dokładnie przedni kafel** — proporcja 2560 / 1392 i szerokość
kontenera. Kafel jest do niej przypięty także w pionie (`frameTop` w
`CanvasCarousel.resize`), a canvas wylewa się poza nią o 0,55 wysokości kafla
w górę i w dół. Zmierzony zasięg treści to 0,48 wysokości kafla nad nim i 0,48
pod nim przy pełnej energii (0,35 i 0,47 w spoczynku, licząc z kanałem alfa) —
przy ciaśniejszym płótnie poświata urywała się widocznym kantem na jego
krawędzi, a odbicie znikało w pół wygaszenia.

Ten pas nie wchodzi do układu strony: canvas ma `z-index: -1` i wsuwa się pod
treść hero i sekcji niżej, a opis siada 22 px pod samym slajdem. Zdarzenia
obsługuje osobna przezroczysta warstwa (`showcase__surface`) w pionie sceny i
na pełną szerokość okna — canvas leżący pod sąsiednimi sekcjami i tak by ich
nie dostał, a gdyby to on był celem, zjadałby kliknięcia w hero. Płótno urosło
o 72 % pikseli (1,99 → 3,42 Mpx przy oknie 1920), ale render kosztuje ok. 3 ms
w obu wariantach — różnica ginie w rozrzucie pomiaru, bo czas idzie na paski
kafli, nie na wypełnianie pustego tła.

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
| aberracja chromatyczna | kafel rysowany trzy razy do bufora pomocniczego, każdy przebieg przemnożony przez czysty kanał (obcięcie do czworokąta jest konieczne — `multiply` na przezroczystym tle dałoby pełny kolor), potem składane addytywnie z przesunięciem; na dolnym końcu zakresu wersja kanałowa **przenika z czystą** (`aberrationBlend`), bo różni się od niej nie tylko przesunięciem — każdy kanał przechodzi dodatkowe przepróbkowanie, więc skokowe przełączenie było widoczne jako nagła zmiana na krawędzi |
| mgła głębi | gradient wzdłuż kafla liczony z realnej odległości krawędzi od kamery |
| poświata i podłoga | przypięte do kafla — przesuwają się i spłaszczają razem z nim; pełna moc na kaflu na wprost, słabsza na pobocznych |
| odbicie | każdy kafel odbity względem własnej dolnej krawędzi, per pasek, razem z nakładką — przemiatanie przechodzi przez odbicie, a nie urywa się na krawędzi kafla; siła nakładki liczona od tej na kaflu, więc odbicie przedniego zostaje czyste; obrys dorysowany z niskim kryciem (`reflectionBorder`), liczonym z pominięciem wygaszania pod ostrą kopią — kopia przykrywa kafel, nie jego odbicie; wygaszane wspólnym gradientem (bufor w połowie rozdzielczości) |
| bloom | scena w 1/4 rozdzielczości, `contrast + blur`, dołożona w trybie `lighter` |
| siatka znaków, ziarno, winieta, przemiatanie | rysowane w układzie kafla i rzutowane razem z nim; na kaflach mocno skróconych słabsze, żeby zagęszczona siatka nie robiła mory |
| rozerwane pasy obrazu | siła wprost z prędkości przesuwania (slajdy na sekundę): poniżej 0,6 nie rwie wcale, od 7 rwie z pełną mocą, narost natychmiastowy, cichnięcie ze stałą 0,12 s. Zmierzone szczyty: klik strzałki 4,7 slajda/s → siła 0,64, 6 pasów, przesunięcie do 48 px; skok o dwa slajdy 13,7 slajda/s → siła 1,00, 10 pasów, do 74 px; kafel w spoczynku → zero. Bramka na osobnej „energii" jest przez to zbędna: przy braku ruchu siła sama schodzi do zera, więc przesunięty pas nie robi już schodka na ramce nieruchomego, ostrego kafla |

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

## Muzyka w tle i kolumny głośnikowe

`public/assets/background.mp3` gra w pętli z połową głośności (wzmocnienie 0,5
na wyjściu grafu Web Audio). **Rusza przy pierwszym kliknięciu, dotknięciu albo
klawiszu, nie przy wejściu na stronę** — przeglądarki blokują dźwięk bez gestu
użytkownika i nie da się tego obejść. Do tego momentu nie powstaje nawet
AudioContext; pobierany jest tylko nagłówek pliku (`preload="metadata"`), żeby
odtwarzacz znał długość utworu.

Na środku paska nawigacji siedzi odtwarzacz: okrągły play / pauza (krążek
identyczny z korpusem gałki — 28 px, to samo tło i krawędź), z poświatą
migającą w rytm — osobna warstwa (`will-change: opacity`), której pętla zmienia
wyłącznie krycie, więc nic się nie przemalowuje. Błysk na każdym uderzeniu,
zanik wykładniczy 140 ms (przed kolejnym uderzeniem już zgaszony), „raz”
mocniej (szczytowe krycie 0,5 wobec 0,3). Rytm z tej samej siatki co puls pierścieni; pętla
chodzi tylko przy grającej muzyce, a przy `prefers-reduced-motion` poświata
nie miga. 1,6 błysku na sekundę mieści się w progu WCAG 2.3.1 (3 / s).
Dalej oś czasu z cieniem fali — obwiednią całego utworu rozciągniętą od linii
w górę i w dół, w kolorach toru osi czasu: reszta jak tor, odegrana część jak
jego wypełnienie (przycięta do postępu). Oba kolory są wspólnymi zmiennymi
linii i fali. Obwiednia to 256 przedziałów po ok. 0,75 s:
RMS sumy kanałów w dB względem najgłośniejszego przedziału, z zakresu
−18…0 dB. Skala decybelowa, bo utwór jest mocno zmasterowany (mediana 3,8 dB
pod maksimum, 90 % czasu w 10 dB) — liniowa amplituda dałaby prawie płaski
prostokąt, a tak widać intro, kulminację, przełamanie i wyciszenie.
Policzona raz, z nagrania, i zapisana w `src/data/track.js` (ok. 1 KB):
liczenie jej u użytkownika wymagałoby pobrania całych 7,6 MB przed
odtwarzaniem. Sama oś pozwala przewijać (natywny `input[type=range]` —
klawiatura i czytniki działają od ręki); jej kciuk to głowica jak w DAW:
pionowa linia 2 px w kolorze wypełnienia z obramowaniem 1 px w kolorze tła
strony, wysoka na 20 px, żeby przecinała całą falę, widoczna przy najechaniu
i fokusie. Na końcu gałka głośności w stylu DAW, z podpisem po prawej. Gałka to tor na
270° (od 7:30 do 4:30) przycięty do jasnych nóżek na końcach zakresu, więc
pokazuje skalę, a nie pełny okrąg; na nim łuk wartości, w środku krótki
wskaźnik — bez piasty i pierścieni wewnętrznych. Całość leży na
nieprzezroczystym korpusie, którego krawędź domyka dół gałki między nóżkami.
Oba łuki mają płaskie końce: okrągła końcówka wystawałaby poza skalę o pół
grubości. Kontrolki nie mają obrysu fokusu; fokus z klawiatury pokazuje
sam element (minimalnie rozjaśniony, szary korpus gałki, uchwyt osi czasu, ramka
przycisku).
Sterowanie jak w DAW: przeciąganie w pionie (180 px = pełny zakres, z Shiftem
5× dokładniej), kółko (3 %, z Shiftem 1 %), dwuklik = powrót do 50 %,
klawiatura (strzałki, PageUp / PageDown, Home / End). Głośność jest liniowa,
50 % = połowa amplitudy, zmiany idą z 15-milisekundowym poślizgiem, żeby nie
trzaskały.

Po lewej od przycisku play stoi autor nad tytułem utworu — lustrzane odbicie
podpisu gałki (te same style etykiety i wartości, wyrównane do przycisku);
oba teksty idą z `src/data/track.js`.

Poniżej 1320 px środek paska zajmują logo i nawigacja, więc zamiast
odtwarzacza jest mały wyłącznik (`aria-pressed`) — ten sam stan, inny widok.
Wiąże prawa strona: odtwarzacz z autorem i tytułem ma 514 px, nawigacja z CTA
zaczyna się 349 px od krawędzi; przy 1321 px zostaje 47 px odstępu (dawny
próg 1240 px liczony był dla 441 px). WCAG 1.4.2 wymaga, żeby dźwięk
grający sam z siebie dało się zatrzymać — na każdej szerokości jest czym.

Wybór „włączone / wyłączone” i głośność zapamiętuje `localStorage`, więc kto
wyłączył muzykę, nie usłyszy jej przy kolejnej wizycie. W ukrytej karcie
muzyka pauzuje i wraca po powrocie.

Przyciski play i wyłącznik są wyłączone z automatycznego startu przy pierwszym
geście (`data-sound-control`). Inaczej `pointerdown` na pauzie najpierw
startowałby muzykę, a `click` zaraz ją zatrzymywał — albo odwrotnie, zależnie
od tego, czy kontekst audio zdążył ruszyć między tymi zdarzeniami.

Okręgi w tle hero i sekcji „Współpraca z agentem” to po trzy kolumny
głośnikowe — lewa, środkowa i prawa:

| kolumna | kanał | woofer (największy) | średniotonowy | tweeter (najmniejszy) |
|---|---|---|---|---|
| lewa | lewy | 40–288 Hz | 288–2080 Hz | 2,08–15 kHz |
| środkowa | suma | 〃 | 〃 | 〃 |
| prawa | prawy | 〃 | 〃 | 〃 |

Obie sekcje są zbudowane identycznie: każda kolumna to osobny
`<svg data-speaker>` z okręgami wokół (0, 0), pozycjonowany w CSS, a kontener
`[data-speakers]` dostaje jeden canvas na szerokość okna, z pionem
dopasowanym do zasięgu pierścieni. W sekcji agenta rozmiary są responsywne —
skaluje je `viewBox`, a `vector-effect: non-scaling-stroke` trzyma linię 1 px.
Układ przeniesiony z dawnych elementów bez zmian: w hero co do piksela, w sekcji
agenta skrajne kolumny też, środkowa z proporcjami z szerokiego ekranu
(poniżej limitów szerokości różnica jest mniejsza niż 1 %).

Pasma dzieli zwrotnica równa w skali logarytmicznej — dla trzech przetworników
wypadają punkty ok. 290 Hz i 2,1 kHz, w okolicy typowych kolumn trójdrożnych.
Wzdłuż pierścienia biegnie jego pasmo, lustrzanie: niskie na dole, wysokie
u góry. Widmo odkształca sam pierścień — w każdym kierunku promień rośnie
o wartość częstotliwości przypadającej na ten kąt (do 12 px + 6 % promienia) —
a linia jaśnieje limonką w miarę głośności pasma. Wartości przed rysowaniem
przechodzą przez filtr 1-2-1 (pasmo to maksimum przedziałów FFT, więc sąsiednie
próbki skaczą), a obrys to krzywa przez środki odcinków, bez załamań w punktach
próbek. W ciszy rysowany jest dokładny okrąg. Cały pierścień do tego „oddycha”
jak membrana — woofer do 9 px, tweeter ledwie 1,5 px.

Bez JS zostają statyczne SVG, a w ciszy canvas rysuje dokładnie to samo.

### Puls w takt

W środkowej kolumnie obu sekcji pulsuje pierścień w rytmie utworu, takt 4/4:

1. **raz** — wewnątrz rodzi się równe koło, rozszerza się i rozmywa w stronę
   najmniejszego pierścienia;
2. **dwa** — staje dokładnie na nim (z jego wychyleniem membrany), w 90 ms
   przejmuje jego falę i rusza dalej, znów się rozmywając;
3. **trzy** — to samo z drugim pierścieniem;
4. **cztery** — przejmuje falę trzeciego, wychodzi poza niego o odstęp między
   dwoma zewnętrznymi i gaśnie przed następną „raz”.

Trzy przetworniki dają cztery odcinki drogi — dokładnie jeden takt. W każdym
odcinku ruch wyhamowuje (ease-out).

Puls to dwie warstwy, które się przenikają:

- **linia** — ostra, niesie falę (przejmuje kształt pierścienia), krycie
  `1 − s`;
- **rozmycie** — gotowy obraz animowany wyłącznie skalą i kryciem `s`.
  Rysowany na wzór trzeciego (największego) pierścienia, więc przy
  największych rozmiarach pulsu wychodzi prawie 1:1, a na pierwszym ticku
  jest skalowany w dół. W hero: 1694 px przy gęstości 1×, okrąg na 700 px,
  σ = 26 px (3,75 % promienia); zmierzone σ 27 px, szczyt dokładnie na
  700 px. Skalowanie skaluje też szerokość rozmycia, więc rośnie ono z pulsem
  samo z siebie. Rozdzielczość = gęstość pikseli sceny, w budżecie 4 Mpx.

`s = u⁴` w obrębie uderzenia: przez pierwszą połowę widać praktycznie samą
linię, rozmycie przejmuje dopiero końcówkę (wcześniej rozmycie szło krzywą
ruchu i ostra była tylko jedna klatka). Zmierzone na pikselach: do 60 %
uderzenia linia 1–2 px, jasność 94–119; przy 75–85 % linia przygasa (69 → 57);
na końcu rozmycie ma 29–33 px szerokości i jasność 41–46.

Obraz rozmycia jest przebudowywany skokami, raz na tick metronomu (sprawdzone:
8 przebudów na 2 takty), z falą pierścienia, na który puls właśnie wszedł.
Tick wypada na początku uderzenia, gdy rozmycie jest jeszcze niewidoczne, więc
skoku kształtu nie widać. Rozmycie w obrazie robi filtr canvasu: linia
grubości 2σ rozmyta o 0,8σ daje profil o σ ≈ 1,0σ i szczycie 0,79 (zmierzone
201 / 255), który wyrównuje krycie przy rysowaniu. Przebudowa kosztuje ok.
0,75 ms. Bez `ctx.filter` (Safari < 18) rozmycie to 9 pasków o szerokości ½σ
z kryciem równym profilowi Gaussa, w niższej rozdzielczości — przy paskach
w pełnej skali (13 px każdy) widać by było schodki. Fala jest w nim
zapisana w proporcji do promienia docelowego pierścienia, więc po
przeskalowaniu siada tam, gdzie była linia. Każda scena ma własny obraz, bo
fale hero i sekcji agenta się różnią.

Siatka rytmu jest zmierzona z nagrania, nie przepisana z opisu: dopasowanie
siatki do obwiedni pasm (niskie ≈ stopa, 400 Hz, powyżej 1,8 kHz ≈ werbel
i hi-hat) daje dokładnie **96,000 BPM** bez dryfu przez cały utwór
(przeszukanie 90–102 BPM, potem ±0,2 co 0,005). Pierwsza „raz” wypada na
**0,025 s**: stopa akcentuje to uderzenie (`[1, 0,70, 0,66, 0,56]` dla
kolejnych czterech), a werbel gra na 2 i 4 (`[0,48, 0,96, 0,55, 1]`).
Obie liczby siedzą w `main.js` obok ścieżki do pliku, bo opisują ten
konkretny utwór. Pozycja w takcie to `currentTime` minus opóźnienie wyjścia
audio (`baseLatency + outputLatency`) — inaczej obraz wyprzedzałby dźwięk.

Zmierzone na pikselach canvasu, wzdłuż promienia na godzinie 3: „raz” +0,02
→ 88 px (start 72), „dwa” → 360 (pierścień 360, szerokość 1 px), „trzy” →
537–553, „cztery” → 715–734 (pierścienie 520 i 700 plus fala, którą puls
jeszcze niesie), „cztery” +0,9 → zgasł.

Kalibracja, zmierzona na tym utworze:

- Surowe widmo opada o ok. 4,7 dB/okt. poniżej 1 kHz i 7,7 powyżej. Bez
  korekcji tweeter drgał średnio na 0,02 przy 0,5 wooferu. Korekcja 6 dB/okt.
  (analizatory studyjne stosują 3–6) wyrównuje utwór do 0,39–0,47 w całym paśmie.
- Korekcja podnosi też ciszę: puste przedziały nad pasmem mp3 przechodziły próg
  i tweeter stał na stałej kresce 0,024, identycznej we wszystkich kanałach.
  Stąd bramka ciszy przed korekcją.
- Średnie poziomy (woofer / średni / tweeter, środkowa kolumna): intro 0,30 /
  0,07 / 0 — intro nie ma góry, środek utworu 0,54 / 0,56 / 0,39, ok. 110 s
  0,44 / 0,58 / 0,50.

Koszt klatki całej sceny hero: ok. 0,3 ms, mierzone jako 120 klatek i jeden
odczyt piksela na końcu (czeka na całą pracę GPU). Różnice między wariantami
pulsu — dwie warstwy, przebudowa co klatkę, dawne 7 warstw obrysu — mieszczą
się w szumie tego pomiaru (0,26–0,38 ms). Strukturalnie dwie warstwy robią
mniej: jeden obrys i jedno `drawImage` na klatkę zamiast ośmiu obrysów, plus
przebudowa obrazu (ok. 1 ms) raz na 625 ms.

Uwaga do metodyki: wcześniejsze liczby w tym miejscu (0,9 ms, z pulsem
1,7 ms) były mierzone z odczytem piksela po każdej klatce. To wymusza
synchronizację z GPU w każdej klatce, a po kilku odczytach Chrome przełącza
canvas na renderowanie programowe — wtedy skalowany obraz rozmycia kosztował
6 ms. W normalnym działaniu nic z canvasu nie czyta, więc ten tryb się nie
włącza.
Canvas nie sięga nad początek dokumentu — w hero oszczędza to ponad 400
wierszy pikseli, bo środkowa kolumna z pulsem sięga 957 px od środka.

Każda sekcja ma własną pętlę, bramkowaną `IntersectionObserver`-em: animuje się
tylko ta, która jest na ekranie, albo obie, gdy widać obie. Gdy sekcja zejdzie
z ekranu, pętla staje od razu; gdy muzyka stanie, pierścienie wybrzmiewają do
zera i pętla gaśnie — w ciszy nie chodzi żadna. Widmo jest liczone raz na
klatkę, nawet przy dwóch widocznych sekcjach: `frameSpectrum` trzyma bufor na
kanał, kluczowany znacznikiem czasu klatki z `requestAnimationFrame`
(sprawdzone: 6 wywołań na klatkę, 3 analizy). `prefers-reduced-motion` zostawia
muzykę, ale pierścienie stoją.

### Retro analizator za zdjęciem

Za zdjęciem w sekcji „Jak powstał DAW” stoi siatka poziomych segmentów
„diod” minimalnie jaśniejszych od tła (krycie 0,035), w której słupki zapalają
całe segmenty od dołu, jak w starym korektorze graficznym. Kolumny to 28 pasm
tercjowych ISO 266 od 31,5 Hz do 16 kHz. Wysokość zdjęcia jest dzielona na
całe wiersze, z których skrajny górny i dolny zostają puste — margines na
górze i na dole to jeden niewidoczny segment, identyczny po obu stronach
(szczelina rozłożona po równo nad i pod segmentem). Siatka sięga ponad
zdjęcie, przez górny odstęp figury (`--figure-pad`, 40 px): pas sekcji zaczyna
się nad figurą, a kończy równo z dołem zdjęcia, więc bez tego od krawędzi pasa
wychodziło 57 px u góry wobec 18 px na dole. Teraz 17 i 18 px. Nad słupkiem znacznik szczytu: stoi 0,5 s, potem opada. Kalibracja widma wspólna z pierścieniami
(`src/audio/spectrum.js`), bufor widma na klatkę też — analiza liczy się raz.

Zdjęcie jest wycinanką (43 % pikseli w pełni przezroczystych), więc siatka
prześwituje jak ściana za stanowiskiem: nad monitorem i głośnikami, w
szczelinach między nimi, na skrajnych kolumnach i po bokach pod biurkiem.
Obecna wersja zdjęcia ma ograniczony kanał alfa — przejść półprzezroczystych
jest 2,7 % zamiast 16 %, a krzesło i cień pod producentem są kryjące.
Krycie zapalonych segmentów 0,24 na dole i 0,36 u góry — przy 0,12 dół ledwie
odróżniał się od zgaszonych.

Poziomy na prawdziwym nagraniu (analizator jak na stronie, offline):
średnio 42 %, do sufitu dochodzi 1 % słupków; w intro grają tylko basy,
w pełnych partiach słupki mają 36–100 % z wyraźnym konturem widma. Zera (18 %)
to naprawdę cisza — intro i pasmo 16 kHz, gdzie mp3 nie ma już treści.

Pętla chodzi tylko przy grającej muzyce i widocznej sekcji, po zatrzymaniu
słupki opadają i pętla gaśnie; przy `prefers-reduced-motion` zostaje sama
siatka. Zdjęcie dostało `width` / `height`, żeby jego pudełko (i siatka)
miało właściwe proporcje, zanim plik się wczyta.

Plik ma 7,65 MB (320 kbps stereo, 3:11). Do tła w zupełności wystarczy
128–160 kbps — ok. 3–3,8 MB.

## Uwagi

- Zrzuty slajdów (`1`–`8`) przekonwertowane z PNG na WebP: 2561 kB → 723 kB.
  Bezstratnie, żeby tekst interfejsu został ostry; wyjątkiem jest `2`, w dużej
  mierze fotograficzne GUI wtyczek, zapisane stratnie q97.
- Zdjęcie z sekcji „Jak powstał DAW” to PNG 4606 × 2624 (5,6 MB). Tutaj jest
  jako WebP 2200 px, q90 / 250 kB — **z kanałem alfa**, bo to wycinanka na
  przezroczystym tle. Odrzucenie alfy przy konwersji odsłania surowe zielone
  piksele spod biurka. Źródłowy PNG nie jest w repozytorium — w `public/`
  trafiłby na serwer jako nieużywane 5,6 MB.
- Treść slajdów (numer, tytuł, opis, plik) siedzi w `src/data/slides.js` —
  dodanie albo usunięcie pozycji nie wymaga zmian w silniku, kąt na okręgu
  i promień policzą się same.
- Fonty (Archivo, IBM Plex Mono) idą z Google Fonts zamiast 20 plików woff2
  zaszytych w mockupie.
- W trybie deweloperskim instancja slidera siedzi pod `window.__showcase`,
  muzyka pod `window.__sound`, a pierścienie pod `window.__speakers`.
