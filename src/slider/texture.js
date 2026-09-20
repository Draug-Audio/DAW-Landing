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
 * Siatka „dużych pikseli” — kafel komórek o losowej alfie, rozdzielonych
 * szczeliną. Używany wyłącznie jako maska (`destination-in`): liczy się sama
 * alfa, kolor bierze się z warstwy pod spodem. Dzięki temu ta sama siatka
 * daje i spokojną teksturę ekranu, i komórki podświetlane przez przemiatanie.
 *
 * @param {number} cell  bok komórki w pikselach tekstury
 * @param {number} count komórek na bok kafla wzoru
 * @param {number} gap   szczelina między komórkami
 * @param {number} floor minimalna alfa komórki
 */
export function makeGridTile(cell = 22, count = 24, gap = 3, floor = 0.32) {
  const size = cell * count;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      // kwadrat rozkładu zagęszcza komórki przy dolnym końcu skali,
      // więc siatka jest nierówna, a nie równomiernie szara
      const level = floor + (1 - floor) * Math.random() ** 2;
      ctx.fillStyle = `rgba(255,255,255,${level.toFixed(3)})`;
      ctx.fillRect(x * cell, y * cell, cell - gap, cell - gap);
    }
  }
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
