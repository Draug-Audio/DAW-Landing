const asset = (file) => `${import.meta.env.BASE_URL}assets/${file}`;

/**
 * Każdy slajd ma dwa pliki:
 *
 * - `src`   — lżejszy, 1280 px; z niego budowane są tekstury canvasu. Canvas
 *             i tak gubi ostrość przy rzucie perspektywicznym, więc wyższa
 *             rozdzielczość byłaby tu zmarnowana. Wczytywany od razu, dla
 *             wszystkich slajdów.
 * - `sharp` — pełna rozdzielczość; podkładana jako zwykły `<img>` nad canvas,
 *             gdy karuzela stoi. Rysuje ją renderer przeglądarki, więc
 *             interfejs jest ostry piksel w piksel. Wczytywany leniwie, tylko
 *             dla slajdu, na którym karuzela się zatrzymała.
 */
const slide = (n, no, title, desc) => ({
  src: asset(`${n}-lo.webp`),
  sharp: asset(`${n}.webp`),
  no,
  title,
  desc,
});

export const slides = [
  slide(1, '01', 'Timeline i historia',
    'Bloki audio i MIDI, krzywe automatyzacji i mikser w jednym widoku. Obok drzewiasty log operacji z sygnaturą czasu — wracasz do dowolnego stanu projektu.'),
  slide(2, '02', 'Wtyczki w mikserze',
    'VST3, CLAP i AU działają od pierwszego uruchomienia. Okna wtyczek dokowane obok torów, a każdy ich parametr jest widoczny dla agenta i automatyzacji.'),
  slide(3, '03', 'Nodowy routing',
    'Graf sygnału zamiast list rozwijanych. Szyny, sidechain i wysyłki widać na jednym ekranie — również w dużych, rozbudowanych projektach.'),
  slide(4, '04', 'Piano roll',
    'Edycja nut z podglądem prymy i skali, velocity pod ręką, obok krzywe automatyzacji i bloki audio. Bez przełączania okien.'),
  slide(5, '05', 'Pady i grupy ścieżek',
    'Ścieżki zwijane w grupy, edytor padów otwierany w miejscu, w którym pracujesz. Perkusja, automatyzacja i audio jeden pod drugim.'),
  slide(6, '06', 'Projekty i szablony',
    'Lista projektów z BPM, metrum, skalą i długością. Szablony pod konkretne zastosowanie, odsłuch renderów bez otwierania projektu.'),
  slide(7, '07', 'Render i stemy',
    'Presety renderowania obok siebie: WAV, MP3 i FLAC, cały utwór albo zaznaczenie, master albo stemy. Zaznaczasz i renderujesz wybrane naraz.'),
  slide(8, '08', 'Ustawienia',
    'Barwy przypisane do znaczeń, nie do ścieżek — wyjście, wyciszenie, sidechain, nagrywanie. Skróty, biblioteka i wtyczki w jednym miejscu.'),
];
