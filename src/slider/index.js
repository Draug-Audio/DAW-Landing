import { CanvasCarousel } from './CanvasCarousel.js';
import { SyncedCaptions, SyncedDots } from './captions.js';
import { buildTexture, loadImage } from './texture.js';
import { clamp } from './math.js';

const AUTOPLAY_DELAY = 5600;

const GRID_FONT = 'RuneScript Monospace Variable';
const GRID_FONT_FILE = 'runescript-monospace-variable.ttf';

/**
 * Znaki w kafelkach siatki rysuje canvas, a nie DOM — więc czcionka musi być
 * gotowa, zanim powstanie atlas glifów. Gdy się nie wczyta, atlas spadnie na
 * systemowy monospace i scena zadziała tak samo, tylko bez run.
 */
async function loadGridFont() {
  if (!('FontFace' in window)) return false;
  try {
    // Zakres wagi MUSI być zadeklarowany. Bez niego FontFace zgłasza się jako
    // statyczny krój 400, przeglądarka nie sięga po oś zmienną i każda waga
    // poniżej 600 renderuje się identycznie (a powyżej — syntetycznie pogrubia).
    const face = new FontFace(GRID_FONT, `url(${import.meta.env.BASE_URL}assets/${GRID_FONT_FILE})`, {
      weight: '100 900',
    });
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (error) {
    console.warn('[showcase] nie udało się wczytać czcionki siatki', error);
    return false;
  }
}

export async function mountShowcase(root, slides) {
  const canvas = root.querySelector('[data-showcase-canvas]');
  const stage = root.querySelector('[data-showcase-stage]');
  const captionsRoot = root.querySelector('[data-captions]');
  const dotsRoot = root.querySelector('[data-showcase-dots]');
  const progressBar = root.querySelector('[data-showcase-progress]');
  const live = root.querySelector('[data-showcase-live]');
  if (!canvas) return null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tekstura ma być dokładnie tak szeroka, jak przedni kafel — a ten ma
  // szerokość kontenera. Przy ośmiu slajdach każdy piksel ponad to mnoży się
  // razy osiem, więc górny limit trzymamy krótko.
  const cardWidth = (stage ?? canvas).getBoundingClientRect().width || 1200;
  const textureWidth = clamp(
    Math.round(cardWidth * Math.min(window.devicePixelRatio || 1, 2)),
    880,
    1500,
  );

  const [images] = await Promise.all([
    Promise.all(slides.map((slide) => loadImage(slide.src))),
    loadGridFont(),
  ]);
  const textures = images.map((img) => buildTexture(img, textureWidth));

  const captions = new SyncedCaptions(captionsRoot, slides);
  let carousel = null;

  // ── autoodtwarzanie (deklarowane przed sceną — onFrame czyta postęp) ──
  let lastAdvance = performance.now();
  let paused = reducedMotion;
  let timer = null;

  const autoplayProgress = () =>
    paused || !timer ? 0 : clamp((performance.now() - lastAdvance) / AUTOPLAY_DELAY, 0, 1);

  function startAutoplay() {
    if (reducedMotion || timer) return;
    lastAdvance = performance.now();
    timer = setInterval(() => {
      if (paused || document.hidden || !carousel) return;
      // gdy klatki nie lecą (zdławiony rAF, karta w tle), nie kolejkujemy
      // kolejnych przejść — inaczej po powrocie scena wystrzeliwuje serią
      if (Math.abs(carousel.pos - carousel.targetPos) > 0.5) return;
      carousel.next();
      lastAdvance = performance.now();
    }, AUTOPLAY_DELAY);
  }

  function stopAutoplay() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** Po ręcznej interakcji odsuwamy automat, żeby nie „wyrywał” slajdu. */
  function holdAutoplay() {
    stopAutoplay();
    startAutoplay();
  }

  const dots = new SyncedDots(dotsRoot, slides, (i) => {
    carousel?.goTo(i);
    holdAutoplay();
  });

  carousel = new CanvasCarousel(canvas, {
    textures,
    frame: stage ?? canvas,
    options: { reducedMotion, gridFont: GRID_FONT },
    onFrame: ({ position, energy }) => {
      captions.update(position);
      dots.update(position);
      root.style.setProperty('--sc-energy', energy.toFixed(3));
      if (progressBar) {
        progressBar.style.transform = `scaleX(${autoplayProgress().toFixed(3)})`;
      }
    },
    onSettle: (index) => {
      if (live) live.textContent = `Widok ${slides[index].no} z ${slides.length}: ${slides[index].title}`;
    },
  });

  captions.update(0);
  dots.update(0);
  carousel.start();

  const pause = () => { paused = true; stopAutoplay(); };
  const resume = () => {
    if (reducedMotion) return;
    paused = false;
    startAutoplay();
  };

  root.addEventListener('pointerenter', pause);
  root.addEventListener('pointerleave', resume);
  root.addEventListener('focusin', pause);
  root.addEventListener('focusout', resume);
  canvas.addEventListener('pointerdown', pause);
  document.addEventListener('visibilitychange', () => (document.hidden ? stopAutoplay() : resume()));
  startAutoplay();

  // ── strzałki i klawiatura ──────────────────────────────────
  root.querySelector('[data-showcase-prev]')?.addEventListener('click', () => {
    carousel.prev();
    holdAutoplay();
  });
  root.querySelector('[data-showcase-next]')?.addEventListener('click', () => {
    carousel.next();
    holdAutoplay();
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { carousel.prev(); holdAutoplay(); }
    else if (event.key === 'ArrowRight') { carousel.next(); holdAutoplay(); }
    else return;
    event.preventDefault();
  });

  if (import.meta.env.DEV) window.__showcase = carousel;

  return carousel;
}
