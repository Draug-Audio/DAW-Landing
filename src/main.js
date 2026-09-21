import './styles/main.scss';
import { slides } from './data/slides.js';
import { mountShowcase } from './slider/index.js';
import { BackgroundSound } from './audio/BackgroundSound.js';
import { mountSoundPlayer } from './audio/SoundPlayer.js';
import { SpeakerRings, svgSpeakers } from './audio/SpeakerRings.js';
import { backgroundTrack } from './data/track.js';
import { SpectrumGrid } from './audio/SpectrumGrid.js';

// ── muzyka w tle + pierścienie hero jako kolumny głośnikowe ──
// tempo, pierwsza „raz” i obwiednia zmierzone z nagrania — src/data/track.js
const sound = new BackgroundSound(backgroundTrack.src, {
  volume: 0.5,
  bpm: backgroundTrack.bpm,
  downbeat: backgroundTrack.downbeat,
});
const soundToggle = document.querySelector('[data-sound-toggle]');
if (soundToggle) {
  // przycisk ma sens dopiero z działającym skryptem — bez JS nic nie gra
  soundToggle.hidden = false;
  sound.bindToggle(soundToggle);
}
mountSoundPlayer(document.querySelector('[data-player]'), sound, backgroundTrack);

// Kolumny głośnikowe w hero i w sekcji agenta — zbudowane identycznie (osobny
// SVG na grupę pierścieni) i renderowane tą samą ścieżką. Każda sekcja
// animuje się tylko wtedy, gdy jest na ekranie.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const speakers = [...document.querySelectorAll('[data-speakers]')]
  .map((container) => new SpeakerRings(svgSpeakers(container), sound, { reducedMotion }));
if (import.meta.env.DEV) window.__speakers = speakers;

// retro analizator widma za zdjęciem w sekcji „Jak powstał DAW”
const gridStage = document.querySelector('[data-spectrum-grid]');
const spectrumGrid = gridStage ? new SpectrumGrid(gridStage, sound, { reducedMotion }) : null;
if (import.meta.env.DEV) window.__grid = spectrumGrid;
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
