const asset = (file) => `${import.meta.env.BASE_URL}assets/${file}`;

/**
 * Każdy slajd ma dwa pliki:
 *
 * - `src`   — lżejszy, 1536 px; z niego budowane są tekstury canvasu. Canvas
 *             i tak gubi ostrość przy rzucie perspektywicznym, więc wyższa
 *             rozdzielczość byłaby tu zmarnowana. Wczytywany od razu, dla
 *             wszystkich slajdów.
 * - `sharp` — pełna rozdzielczość; podkładana jako zwykły `<img>` nad canvas,
 *             gdy karuzela stoi. Rysuje ją renderer przeglądarki, więc
 *             interfejs jest ostry piksel w piksel. Wczytywany leniwie, tylko
 *             dla slajdu, na którym karuzela się zatrzymała.
 *
 * Zrzuty samplera nie idą do karuzeli — mają własną sekcję „Sampler”.
 */
const slide = (n, no, title, desc) => ({
  src: asset(`${n}-lo.webp`),
  sharp: asset(`${n}.webp`),
  no,
  title,
  desc,
});

export const slides = [
  slide(1, '01', 'Timeline i agent',
    'Bloki MIDI i audio, grupy ścieżek i markery na jednej osi. Obok rozmowa z agentem: widać każdą operację, którą wykonał na projekcie, a gdy polecenie jest niejasne, agent dopytuje, zamiast zgadywać.'),
  slide(2, '02', 'Rack FX i nuty w miejscu',
    'Okna wtyczek VST3 i CLAP w racku FX obok osi, z presetem i miksem przy każdej. Nuty bloku edytujesz wprost na osi: edytor otwiera się między ścieżkami, z prymą, skalą i velocity.'),
  slide(3, '03', 'Nodowy routing',
    'Graf sygnału zamiast list rozwijanych. Szyny, rozdzielacze MIDI i częstotliwości, transpozycja i panel makr — całą drogę dźwięku widać na jednym ekranie.'),
  slide(4, '04', 'Piano roll, mikser i historia',
    'Piano roll z nazwami padów zamiast nut — RIDE BELL zamiast C4 — nad mikserem z grupami kanałów. Obok drzewiasta historia z sygnaturą czasu: wracasz do dowolnego stanu projektu.'),
  slide(5, '05', 'Wtyczki i grupy ścieżek',
    'Wtyczki w folderach, z wyszukiwarką i podglądem okna wtyczki prosto z listy. Grupy ścieżek zwijasz na osi i w mikserze, gdy projekt robi się duży.'),
  slide(6, '06', 'Menedżer projektów',
    'Projekty i foldery z miniaturą aranżacji, w siatce albo na liście. Ostatnie projekty, własne foldery i szablony pod ręką od pierwszego ekranu.'),
  slide(7, '07', 'Tekst i tryb karaoke',
    'Słowa piosenki w blokach tekstu na osi — przesuwasz je i tniesz razem z aranżacją. Zakładka Tekst pokazuje cały utwór dużym pismem i w trakcie grania podświetla śpiewany blok.'),
  slide(8, '08', 'Ustawienia',
    'Barwy przypisane do znaczeń, nie do ścieżek — wyjście, wyciszenie, sidechain, nagrywanie. Własny przebieg barw miernika, a zmiany zapisują się od razu.'),
];
