import { clamp, smoothstep, wrapDelta } from './math.js';

/**
 * Drugi, zsynchronizowany slider: opisy pod sceną.
 *
 * Nie reaguje na „zmianę slajdu”, tylko na ciągłą pozycję karuzeli — dlatego
 * przenikanie idzie dokładnie w rytm obrotu canvasu, także w trakcie
 * przeciągania myszą, gdy pozycja nigdzie się nie „zatrzaskuje”.
 */
export class SyncedCaptions {
  constructor(root, slides) {
    this.root = root;
    this.count = slides.length;
    this.nodes = slides.map((slide, i) => {
      const el = document.createElement('article');
      el.className = 'caption';
      el.dataset.index = String(i);
      el.innerHTML = `
        <p class="caption__title">${slide.no} — ${slide.title}</p>
        <p class="caption__desc">${slide.desc}</p>`;
      root.append(el);
      return el;
    });
  }

  update(position) {
    for (let i = 0; i < this.count; i += 1) {
      const rel = wrapDelta(i - position, this.count);
      const distance = Math.abs(rel);
      // wąskie okno widoczności: w połowie przejścia oba opisy są prawie
      // przezroczyste, więc nigdy nie nakładają się czytelnymi warstwami
      const visibility = smoothstep(0.62, 0.08, distance);
      const away = 1 - visibility;
      const node = this.nodes[i];
      const active = distance < 0.5;

      node.style.setProperty('--cap-opacity', visibility.toFixed(3));
      node.style.setProperty('--cap-x', `${(rel * 34).toFixed(1)}px`);
      node.style.setProperty('--cap-y', `${(away * 10).toFixed(1)}px`);
      node.style.setProperty('--cap-blur', `${(away * 5).toFixed(2)}px`);
      if (node.dataset.active !== String(active)) {
        node.dataset.active = String(active);
        node.setAttribute('aria-hidden', active ? 'false' : 'true');
      }
    }
  }
}

/** Kropki nawigacji z wypełnieniem sterowanym tą samą pozycją. */
export class SyncedDots {
  constructor(root, slides, onSelect) {
    this.count = slides.length;
    this.nodes = slides.map((slide, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dot';
      button.setAttribute('aria-label', `Widok ${slide.no}: ${slide.title}`);
      button.innerHTML = '<span class="dot__track"><span class="dot__fill"></span></span>';
      button.addEventListener('click', () => onSelect(i));
      root.append(button);
      return button;
    });
  }

  update(position) {
    for (let i = 0; i < this.count; i += 1) {
      const distance = Math.abs(wrapDelta(i - position, this.count));
      const fill = clamp(1 - distance, 0, 1);
      const node = this.nodes[i];
      node.style.setProperty('--dot-fill', fill.toFixed(3));
      const current = fill > 0.5;
      if (node.dataset.current !== String(current)) {
        node.dataset.current = String(current);
        node.setAttribute('aria-current', current ? 'true' : 'false');
      }
    }
  }
}
