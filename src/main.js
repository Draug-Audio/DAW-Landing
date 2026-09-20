import './styles/main.scss';
import { slides } from './data/slides.js';
import { mountShowcase } from './slider/index.js';

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
