import './styles/main.scss';
import { slides } from './data/slides.js';
import { mountShowcase } from './slider/index.js';
import { BackgroundSound } from './audio/BackgroundSound.js';
import { mountSoundPlayer } from './audio/SoundPlayer.js';
import { SpeakerRings, svgSpeakers } from './audio/SpeakerRings.js';

// ── muzyka w tle + pierścienie hero jako kolumny głośnikowe ──
// Tempo i pierwsza „raz” zmierzone z nagrania: dopasowanie siatki do
// obwiedni pasm daje dokładnie 96,000 BPM bez dryfu; stopa akcentuje
// uderzenie w 0,025 s, a werbel gra na 2 i 4 — to jest początek taktu.
const sound = new BackgroundSound(`${import.meta.env.BASE_URL}assets/background.mp3`, {
  volume: 0.5,
  bpm: 96,
  downbeat: 0.025,
});
const soundToggle = document.querySelector('[data-sound-toggle]');
if (soundToggle) {
  // przycisk ma sens dopiero z działającym skryptem — bez JS nic nie gra
  soundToggle.hidden = false;
  sound.bindToggle(soundToggle);
}
mountSoundPlayer(document.querySelector('[data-player]'), sound);

// Kolumny głośnikowe w hero i w sekcji agenta — zbudowane identycznie (osobny
// SVG na grupę pierścieni) i renderowane tą samą ścieżką. Każda sekcja
// animuje się tylko wtedy, gdy jest na ekranie.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const speakers = [...document.querySelectorAll('[data-speakers]')]
  .map((container) => new SpeakerRings(svgSpeakers(container), sound, { reducedMotion }));
if (import.meta.env.DEV) window.__speakers = speakers;
if (import.meta.env.DEV) window.__sound = sound;

const showcase = document.querySelector('[data-showcase]');

if (showcase) {
  mountShowcase(showcase, slides).catch((error) => {
    console.error('[showcase]', error);
    // awaryjnie: statyczny zrzut ekranu zamiast pustej sceny
    const canvas = showcase.querySelector('[data-showcase-canvas]');
    if (!canvas) return;
    const img = new Image();
    img.src = slides[0].src;
    img.alt = 'Interfejs Draug Audio Workstation';
    img.className = 'showcase__fallback';
    canvas.replaceWith(img);
  });
}
