import { CanvasCarousel } from './CanvasCarousel.js';
import { SyncedCaptions, SyncedDots } from './captions.js';
import { buildTexture, loadImage } from './texture.js';
import { clamp } from './math.js';

const AUTOPLAY_DELAY = 5600;
/** czas wyostrzania po zatrzymaniu karuzeli */
const SHARPEN_MS = 280;

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
  const sharp = root.querySelector('[data-showcase-sharp]');
  const captionsRoot = root.querySelector('[data-captions]');
  const dotsRoot = root.querySelector('[data-showcase-dots]');
  const progressBar = root.querySelector('[data-showcase-progress]');
  const live = root.querySelector('[data-showcase-live]');
  if (!canvas) return null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tekstura ma być dokładnie tak szeroka, jak przedni kafel — a ten ma
  // szerokość kontenera. Przy ośmiu slajdach każdy piksel ponad to mnoży się
  // razy osiem, więc górny limit trzymamy krótko.
  // Tekstura odpowiada ZAWARTOŚCI kafla, czyli jego szerokości bez ramki
  // (1 px z każdej strony). Przy dpr 1 daje to kopię 1:1 — obraz nie jest ani
  // skalowany w dół, ani rozciągany. Górny limit to szerokość pliku `-lo`,
  // żeby nie skalować w górę.
  const cardWidth = (stage ?? canvas).getBoundingClientRect().width || 1200;
  const textureWidth = clamp(
    Math.round(cardWidth * Math.min(window.devicePixelRatio || 1, 1.25)) - 2,
    900,
    1536,
  );

  const [images] = await Promise.all([
    Promise.all(slides.map((slide) => loadImage(slide.src))),
    loadGridFont(),
  ]);
  const textures = images.map((img) => buildTexture(img, textureWidth));

  const captions = new SyncedCaptions(captionsRoot, slides);
  let carousel = null;
  let sharpState = null;

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
    onFrame: ({ position, energy, settled }) => {
      captions.update(position);
      dots.update(position);
      sharpState?.(settled);
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

  sharpState = mountSharpOverlay({ stage, canvas, sharp, slides, carousel });
  sharpState(carousel.isSettled());

  if (import.meta.env.DEV) window.__showcase = carousel;

  return carousel;
}


/**
 * Ostra kopia przedniego slajdu.
 *
 * Canvas rysuje kafel z tekstury o obniżonej rozdzielczości i przez własny
 * rzut, więc interfejs na nim mięknie. W spoczynku podkładamy więc nad canvas
 * zwykły `<img>` w pełnej rozdzielczości, ustawiony co do piksela na kaflu —
 * rysuje go renderer przeglądarki, czyli z maksymalną ostrością.
 *
 * Przy każdym ruchu karuzeli kopia znika natychmiast (bez przejścia, żeby nie
 * wlokła się za kaflem), a po zatrzymaniu wraca fadem. Pliki doczytywane są
 * leniwie: jeśli ostra wersja nie zdąży, kafel po prostu zostaje dłużej
 * miękki i wyostrzy się, gdy plik dojdzie.
 */
function mountSharpOverlay({ stage, canvas, sharp, slides, carousel }) {
  if (!sharp || !stage || !canvas) return () => {};

  const loaded = new Map();
  let shown = false;
  let wanted = -1;
  let fadeStart = 0;

  const place = () => {
    const rect = carousel.frontRect();
    if (!rect) return;
    const canvasBox = canvas.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    // Nakładka dostaje własną, przezroczystą ramkę 1 px i `border-box`, więc
    // jej POLE TREŚCI jest dokładnie takie samo jak pole treści kafla na
    // canvasie — obraz skaluje się w obu warstwach identycznie, bez odchyleń
    // między pikselami. Przezroczysty pierścień odsłania obrys z canvasu.
    sharp.style.left = `${canvasBox.left - stageBox.left + rect.left - rect.border}px`;
    sharp.style.top = `${canvasBox.top - stageBox.top + rect.top - rect.border}px`;
    sharp.style.borderWidth = `${rect.border}px`;
    sharp.style.borderColor = rect.borderColor;
    sharp.style.width = `${rect.width + 2 * rect.border}px`;
    sharp.style.height = `${rect.height + 2 * rect.border}px`;
  };

  const hide = () => {
    if (!shown) return;
    shown = false;
    // obrys na canvasie musi wrócić w tej samej klatce, w której znika kopia
    carousel.sharpCover = 0;
    sharp.style.transition = 'none';
    sharp.style.opacity = '0';
  };

  const show = () => {
    if (shown) return;
    shown = true;
    place();
    // wymuszenie przeliczenia stylu, żeby przejście ruszyło od zera,
    // a nie zostało scalone z wyłączeniem transition przy zgaszeniu
    void sharp.offsetWidth;
    fadeStart = performance.now();
    sharp.style.transition = `opacity ${SHARPEN_MS}ms linear`;
    sharp.style.opacity = '1';
  };

  const ensure = (index) => {
    if (loaded.has(index)) return loaded.get(index);
    const pending = loadImage(slides[index].sharp).then(() => slides[index].sharp);
    loaded.set(index, pending);
    return pending;
  };

  // przy zmianie rozmiaru kopia musi wrócić na swoje miejsce; gaszenie na
  // czas przeliczenia jest bezpieczniejsze niż pokazywanie jej nie tam, gdzie
  // trzeba, a najbliższa klatka i tak zapali ją z powrotem
  new ResizeObserver(() => {
    hide();
    wanted = -1;
    place();
  }).observe(canvas);

  // Przejście jest liniowe i znamy jego start, więc postęp liczymy z czasu —
  // dokładnie tak samo, jak robi to przeglądarka. Odczytywanie `opacity`
  // z `getComputedStyle` co klatkę wymuszałoby przeliczanie stylów.
  const cover = () => (shown ? Math.min(1, (performance.now() - fadeStart) / SHARPEN_MS) : 0);

  return (settledFlag) => {
    carousel.sharpCover = cover();
    if (!settledFlag) {
      wanted = -1;
      hide();
      return;
    }
    const index = carousel.index;
    if (index === wanted) return;
    wanted = index;
    ensure(index).then((src) => {
      // w międzyczasie karuzela mogła ruszyć albo przejść na inny slajd
      if (wanted !== index || !carousel.isSettled()) return;
      if (sharp.getAttribute('src') !== src) sharp.setAttribute('src', src);
      show();
    }).catch(() => {});
  };
}
