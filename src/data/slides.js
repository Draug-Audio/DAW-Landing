const asset = (file) => `${import.meta.env.BASE_URL}assets/${file}`;

/**
 * Mockup korzysta z jednego zrzutu ekranu dla wszystkich trzech widoków —
 * tak jest tutaj odwzorowany. Podmiana na docelowe zrzuty to zmiana `src`.
 */
export const slides = [
  {
    src: asset('dau-screen.png'),
    no: '01',
    title: 'Timeline i automatyzacja',
    desc: 'Bloki audio i MIDI, krzywe automatyzacji wtyczek oraz markery struktury utworu w jednym widoku.',
  },
  {
    src: asset('dau-screen.png'),
    no: '02',
    title: 'Mikser',
    desc: 'Wszystkie tory, szyny i master obok siebie. Poziomy, mute, solo i wysyłki bez przełączania okien.',
  },
  {
    src: asset('dau-screen.png'),
    no: '03',
    title: 'Historia operacji',
    desc: 'Drzewiasty log zmian z sygnaturą czasu. Wracasz do dowolnego stanu projektu i do równoległych wariantów.',
  },
];
