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
public/assets/          grafiki wypakowane z mockupu
src/
  main.js               punkt wejścia — style + montaż slidera
  data/slides.js        treść slajdów (src / numer / tytuł / opis)
  styles/               SCSS, jeden partial na sekcję
    _tokens.scss        paleta, typografia, rytm, breakpointy, miksiny
  slider/
    CanvasCarousel.js   silnik sceny 3D na canvasie
    captions.js         zsynchronizowany slider opisów + kropki
    texture.js          przygotowanie tekstur (m.in. rozbicie na kanały RGB)
    math.js             clamp / lerp / smoothstep / zawijanie po okręgu
Mockups/                oryginalne, spakowane pliki HTML (źródło projektu)
```

## Slider

Kafle leżą na okręgu wokół kamery i są rzutowane perspektywicznie. Canvas 2D nie
potrafi mapować tekstury na trapez, więc każdy kafel rysowany jest **pionowymi
paskami** — każdy pasek dostaje własną skalę z rzutu, co daje realne skrócenie
perspektywiczne zamiast zwykłego skalowania obrazka. Liczba pasków rośnie z
kątem obrotu; w spoczynku kafel jest płaski i idzie jednym `drawImage`, więc
zostaje piksel w piksel ostry.

Ruchem steruje sprężyna (lekko niedotłumiona — dojazd ~0,5 s z minimalnym
przestrzeleniem). Pozycja jest **ciągła**, nie skokowa, więc wszystko, co od niej
zależy, jest zsynchronizowane w każdej klatce: obrót sceny, przenikanie opisów
i wypełnienie kropek — także w trakcie przeciągania myszą.

Efekty (skalowane energią ruchu, czyli liczbą slajdów na sekundę):

| efekt | jak działa |
| --- | --- |
| aberracja chromatyczna | tekstura trzymana jest też w trzech kopiach z wyizolowanymi kanałami R/G/B; przy ruchu rysowane są rozsunięte i składane addytywnie (`lighter`) |
| mgła głębi | gradient wzdłuż kafla liczony z realnej odległości krawędzi od kamery |
| odblask krawędzi natarcia | gradient limonkowy po stronie, w którą leci kafel |
| odbicie | scena odbita względem linii podłogi, maskowana gradientem (bufor w połowie rozdzielczości) |
| bloom | scena w 1/4 rozdzielczości, `contrast + blur`, dołożona w trybie `lighter` |
| skanlinie, ziarno, winieta, przemiatanie | maskowane alfą sceny (`destination-in`), więc widać je tylko na samych kaflach, nie na tle strony |
| rozerwane pasy obrazu | przy szybkim obrocie i przy zmianie slajdu |

Sterowanie: przeciąganie (z rzutem prędkości i zatrzaskiem), strzałki, kropki,
klawisze ←/→, poziomy scroll gładzika, autoodtwarzanie z paskiem postępu.
Pętla stoi, gdy sekcja jest poza ekranem albo karta jest w tle.
`prefers-reduced-motion` wyłącza autoodtwarzanie, aberrację, glitch i ziarno.

Wydajność przy 1350 × 545 px bufora: **0,25 ms/klatkę** w spoczynku,
**0,62 ms/klatkę** w ruchu.

## Uwagi

- Mockup używa jednego zrzutu ekranu dla wszystkich trzech widoków i tak jest tu
  odwzorowany. Podmiana na docelowe zrzuty to zmiana `src` w `src/data/slides.js`.
- Zdjęcie z sekcji „Jak powstał DAW” w mockupie ważyło 6,3 MB (PNG 4606 × 2624).
  Tutaj jest jako WebP 2200 px / 139 kB.
- Fonty (Archivo, IBM Plex Mono) idą z Google Fonts zamiast 20 plików woff2
  zaszytych w mockupie.
- W trybie deweloperskim instancja slidera siedzi pod `window.__showcase`.
