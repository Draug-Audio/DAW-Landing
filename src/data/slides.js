const asset = (file) => `${import.meta.env.BASE_URL}assets/${file}`;

export const slides = [
  {
    src: asset('1.webp'),
    no: '01',
    title: 'Timeline i historia',
    desc: 'Bloki audio i MIDI, krzywe automatyzacji i mikser w jednym widoku. Obok drzewiasty log operacji z sygnaturą czasu — wracasz do dowolnego stanu projektu.',
  },
  {
    src: asset('2.webp'),
    no: '02',
    title: 'Wtyczki w mikserze',
    desc: 'VST3, CLAP i AU działają od pierwszego uruchomienia. Okna wtyczek dokowane obok torów, a każdy ich parametr jest widoczny dla agenta i automatyzacji.',
  },
  {
    src: asset('3.webp'),
    no: '03',
    title: 'Nodowy routing',
    desc: 'Graf sygnału zamiast list rozwijanych. Szyny, sidechain i wysyłki widać na jednym ekranie — również w dużych, rozbudowanych projektach.',
  },
  {
    src: asset('4.webp'),
    no: '04',
    title: 'Piano roll',
    desc: 'Edycja nut z podglądem prymy i skali, velocity pod ręką, obok krzywe automatyzacji i bloki audio. Bez przełączania okien.',
  },
  {
    src: asset('5.webp'),
    no: '05',
    title: 'Pady i grupy ścieżek',
    desc: 'Ścieżki zwijane w grupy, edytor padów otwierany w miejscu, w którym pracujesz. Perkusja, automatyzacja i audio jeden pod drugim.',
  },
  {
    src: asset('6.webp'),
    no: '06',
    title: 'Projekty i szablony',
    desc: 'Lista projektów z BPM, metrum, skalą i długością. Szablony pod konkretne zastosowanie, odsłuch renderów bez otwierania projektu.',
  },
  {
    src: asset('7.webp'),
    no: '07',
    title: 'Render i stemy',
    desc: 'Presety renderowania obok siebie: WAV, MP3 i FLAC, cały utwór albo zaznaczenie, master albo stemy. Zaznaczasz i renderujesz wybrane naraz.',
  },
  {
    src: asset('8.webp'),
    no: '08',
    title: 'Ustawienia',
    desc: 'Barwy przypisane do znaczeń, nie do ścieżek — wyjście, wyciszenie, sidechain, nagrywanie. Skróty, biblioteka i wtyczki w jednym miejscu.',
  },
];
