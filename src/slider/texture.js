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

/** Linie skanujące CRT — kafel 1 × 4 px. */
export function makeScanlineTile(period = 4) {
  const canvas = makeCanvas(1, period);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, 1, 1);
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
