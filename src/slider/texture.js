/**
 * Przygotowanie tekstur dla slidera.
 *
 * Obraz jest przeskalowywany do rozmiaru, w jakim realnie pojawia się na
 * scenie, i podkładany na kryjącym tle — dzięki temu izolacja kanałów przy
 * aberracji (`multiply` z czystym kanałem) daje poprawny wynik.
 */

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Nie udało się wczytać obrazu: ${src}`));
    img.src = src;
  });
}

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas, options) {
  const ctx = canvas.getContext('2d', options);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Kafel szumu — ziarno nakładane na „ekrany” w slajdach. */
export function makeNoiseTile(size = 168, strength = 26) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * strength * 2;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Atlas znaków: każdy znak wypalony raz w kwadrat o boku `size`, w jednym
 * rzędzie obok siebie. Rysowanie kafelków sprowadza się potem do `drawImage`
 * z odpowiedniego wycinka — bez składu tekstu co klatkę.
 *
 * @param {string[]} chars
 * @param {number} size  bok kafelka w pikselach (mapowanie 1:1 z nakładką)
 * @param {string} font  rodzina czcionki; fallback na monospace
 * @param {object} [opts] kolor, waga ze zmiennej osi, rozmiar i minimalna kreska
 */
export function makeGlyphAtlas(
  chars,
  size,
  font,
  { color = '#c8ff3d', weight = 600, fontSize, minStroke = 0 } = {},
) {
  const canvas = makeCanvas(size * chars.length, size);
  const ctx = canvas.getContext('2d');
  // czcionka jest zmienna (oś wagi 100–900); rozmiar podawany wprost, bo przy
  // cienkich wagach to on decyduje, czy kreska zmieści się w pikselu
  ctx.font = `${weight} ${Math.round(fontSize ?? size * 0.72)}px "${font}", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  chars.forEach((ch, i) => {
    // Canvas nie hintuje, więc samo wyrównanie pozycji do całych pikseli nic
    // nie da — kreska 0,5 px zostaje 0,5 px, gdziekolwiek trafi (zmierzone:
    // identyczny udział pikseli pełnych i ta sama maksymalna alfa). Pełny
    // piksel wymusza dopiero obrys pod wypełnieniem. Całe piksele i tak
    // ustawiamy, bo nic nie kosztują.
    const x = Math.round(i * size + size / 2);
    const y = Math.round(size / 2);
    if (minStroke > 0) {
      ctx.lineWidth = minStroke;
      ctx.strokeText(ch, x, y);
    }
    ctx.fillText(ch, x, y);
  });
  return canvas;
}

/**
 * @param {HTMLImageElement} img
 * @param {number} maxWidth  docelowa szerokość tekstury w pikselach urządzenia
 * @param {string} [backdrop] tło podkładane pod obraz
 */
export function buildTexture(img, maxWidth, backdrop = '#0c0e0c') {
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const base = makeCanvas(w, h);
  const ctx = context2d(base);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return { base, width: w, height: h, aspect: h / w };
}
