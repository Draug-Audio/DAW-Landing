/**
 * Muzyka w tle: plik i wszystko, co o nim zmierzono. Liczby dotyczą tego
 * konkretnego nagrania — przy zmianie pliku trzeba je zmierzyć od nowa
 * (metoda opisana w README, „Muzyka w tle i kolumny głośnikowe”).
 */
export const backgroundTrack = {
  src: `${import.meta.env.BASE_URL}assets/background.mp3`,
  /** podpis w odtwarzaczu: autor nad tytułem */
  author: 'Author Name',
  title: 'Background',

  /**
   * Tempo i pierwsza „raz” zmierzone z nagrania: dopasowanie siatki do
   * obwiedni pasm daje dokładnie 96,000 BPM bez dryfu; stopa akcentuje
   * uderzenie w 0,025 s, a werbel gra na 2 i 4 — to jest początek taktu.
   */
  bpm: 96,
  downbeat: 0.025,

  /**
   * Obwiednia głośności do cienia fali na osi czasu: 256 przedziałów po ok.
   * 0,75 s, RMS sumy kanałów w dB względem najgłośniejszego przedziału,
   * odwzorowane liniowo z zakresu −18…0 dB na 0…100. Skala decybelowa, bo
   * utwór jest mocno zmasterowany — mediana tylko 3,8 dB pod maksimum, więc
   * liniowa amplituda dałaby prawie płaski prostokąt. Policzona raz, z
   * nagrania: liczenie jej u użytkownika wymagałoby pobrania całych 7,6 MB,
   * zanim cokolwiek zagra.
   */
  waveform: [
    43, 41, 50, 46, 45, 46, 45, 46, 43, 42, 41, 44, 36, 52, 56, 51,
    49, 51, 49, 49, 50, 47, 53, 51, 51, 52, 64, 60, 54, 58, 69, 55,
    58, 70, 58, 61, 67, 61, 56, 59, 84, 80, 80, 83, 80, 79, 82, 79,
    70, 73, 71, 70, 77, 90, 97, 97, 99, 99, 97, 97, 97, 97, 100, 98,
    96, 94, 93, 83, 81, 81, 83, 79, 76, 82, 74, 69, 69, 79, 66, 72,
    81, 81, 81, 85, 79, 78, 79, 85, 79, 79, 84, 79, 78, 79, 73, 73,
    75, 77, 66, 67, 76, 72, 68, 75, 62, 57, 68, 69, 66, 65, 65, 65,
    67, 70, 68, 66, 65, 64, 63, 70, 78, 79, 76, 83, 80, 79, 79, 83,
    79, 80, 83, 79, 78, 83, 78, 77, 77, 81, 76, 77, 82, 79, 78, 80,
    80, 78, 80, 83, 80, 81, 85, 81, 80, 81, 82, 77, 80, 84, 80, 81,
    89, 86, 83, 86, 89, 83, 83, 87, 84, 81, 84, 83, 81, 82, 62, 52,
    45, 33, 27, 12, 24, 46, 41, 39, 22, 22, 53, 82, 82, 82, 87, 81,
    79, 82, 88, 86, 86, 88, 82, 83, 90, 87, 84, 86, 89, 86, 85, 89,
    84, 81, 89, 85, 84, 84, 89, 85, 85, 88, 84, 84, 86, 91, 90, 89,
    91, 89, 88, 90, 85, 87, 88, 87, 84, 86, 91, 84, 88, 90, 87, 83,
    84, 68, 60, 51, 48, 45, 40, 48, 49, 43, 40, 36, 34, 17, 0, 0,
  ],
};
