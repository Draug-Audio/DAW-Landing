import { clamp } from '../slider/math.js';

/**
 * Wspólna kalibracja widma dla wszystkiego, co reaguje na muzykę w tle
 * (pierścienie-kolumny, siatka analizatora przy zdjęciu) — żeby każdy efekt
 * odczytywał ten sam utwór tak samo.
 *
 * Dane wejściowe to `getByteFrequencyData`: 0–255 w skali decybelowej między
 * `minDecibels` a `maxDecibels` analizatora (BackgroundSound).
 */

/**
 * Korekcja nachylenia widma, w dB na oktawę względem 1 kHz. Muzyka traci
 * energię ku górze — w tym utworze ok. 4,7 dB/okt. poniżej 1 kHz i 7,7 powyżej
 * (zmierzone na średnich oktawowych). Bez korekcji tweeter prawie nie drgał
 * (średnio 0,02 przy 0,5 wooferu). 6 dB/okt. wyrównuje utwór do 0,39–0,47
 * w całym paśmie; analizatory studyjne stosują podobnie 3–6 dB/okt.
 */
export const TILT_DB = 6;
/** zakres analizatora w dB (`maxDecibels - minDecibels` w BackgroundSound) */
export const RANGE_DB = 70;
/**
 * Bramka ciszy przed korekcją, w jednostkach analizatora (0–255, ok. 0,27 dB
 * na jednostkę). Korekcja podnosi górę pasma nawet o 0,33 skali, więc bez
 * bramki pusty przedział — ponad pasmem mp3 albo w ciszy — przechodził próg
 * i tweeter stał na stałej, zerowej w rzeczywistości kresce.
 */
export const SILENCE = 16;
/** okno odpowiedzi po korekcji (0–1 w skali dB analizatora): poniżej FLOOR —
 *  szum tła, od CEIL — pełne wychylenie */
export const FLOOR = 0.22;
export const CEIL = 0.7;

/** korekcja nachylenia dla częstotliwości `f`, w jednostkach skali 0–1 */
export const tiltAt = (f) => (TILT_DB * Math.log2(f / 1000)) / RANGE_DB;

/**
 * Poziom pasma [fLo, fHi] w skali 0–1, po bramce ciszy, korekcji nachylenia
 * i oknie FLOOR–CEIL. Pasmo węższe niż przedział FFT (niskie tony) jest
 * interpolowane, szersze bierze maksimum — żeby transjenty nie rozmywały się
 * w średniej.
 */
export function bandLevel(data, binHz, fLo, fHi) {
  const top = data.length - 2;
  const lo = fLo / binHz;
  const hi = fHi / binHz;
  let v;
  if (hi - lo < 1) {
    const c = clamp((lo + hi) / 2, 0, top);
    const i = Math.floor(c);
    v = data[i] + (data[i + 1] - data[i]) * (c - i);
  } else {
    v = 0;
    const end = Math.min(Math.floor(hi), top);
    for (let i = Math.ceil(lo); i <= end; i += 1) if (data[i] > v) v = data[i];
  }
  if (v <= SILENCE) return 0;
  return clamp((v / 255 + tiltAt(Math.sqrt(fLo * fHi)) - FLOOR) / (CEIL - FLOOR), 0, 1);
}
