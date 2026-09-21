import { Knob } from './Knob.js';

/**
 * Odtwarzacz w nagłówku: play / pauza, oś czasu z przewijaniem i gałka
 * głośności. Nie trzyma własnego stanu — wszystko czyta z `BackgroundSound`
 * i elementu audio, więc zgadza się z wyłącznikiem i z pierścieniami hero.
 */

/** zanik błysku poświaty po uderzeniu, s — przed kolejnym (625 ms) już zgaszony */
const GLOW_DECAY = 0.14;
/** szczytowe krycie błysku na „raz” i na pozostałych uderzeniach taktu */
const GLOW_ACCENT = [0.5, 0.3, 0.3, 0.3];

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Cień fali: obwiednia (0–100) jako zamknięty kształt symetryczny względem
 * osi — górna krawędź od lewej do prawej, dolna z powrotem. viewBox ma
 * szerokość `n − 1` i wysokość 2 (od −1 do 1), a SVG rozciąga go na oś czasu.
 */
function wavePath(values) {
  const top = values.map((v, i) => `${i} ${(-v / 100).toFixed(2)}`);
  const bottom = values.map((v, i) => `${i} ${(v / 100).toFixed(2)}`).reverse();
  return `M${top.join('L')}L${bottom.join('L')}Z`;
}

export function mountSoundPlayer(root, sound, { waveform, author, title } = {}) {
  if (!root) return;
  const { audio } = sound;
  const play = root.querySelector('[data-player-play]');
  const timeline = root.querySelector('[data-player-timeline]');
  const current = root.querySelector('[data-player-current]');
  const duration = root.querySelector('[data-player-duration]');
  // postęp ustawiany na wspólnym rodzicu: czyta go i suwak, i cień fali
  const track = root.querySelector('[data-player-track]') ?? timeline;

  if (waveform?.length) {
    const d = wavePath(waveform);
    for (const svg of root.querySelectorAll('.player__wave')) {
      svg.setAttribute('viewBox', `0 -1 ${waveform.length - 1} 2`);
      svg.querySelector('[data-player-wave]').setAttribute('d', d);
    }
  }

  root.hidden = false;

  const authorEl = root.querySelector('[data-player-author]');
  const titleEl = root.querySelector('[data-player-title]');
  if (authorEl) authorEl.textContent = author ?? '';
  if (titleEl) titleEl.textContent = title ?? '';

  // ── play / pauza ──────────────────────────────────────────
  // Przycisk wyłączony z automatycznego startu przy pierwszym geście —
  // sam decyduje, co zrobić (patrz `BackgroundSound._onGesture`).
  play.dataset.soundControl = '';
  play.addEventListener('click', () => sound.setEnabled(!sound.isActive()));

  const syncPlay = () => {
    const state = !sound.enabled ? 'off' : sound.isPlaying() ? 'playing' : 'waiting';
    const active = sound.isActive();
    play.dataset.state = state;
    play.dataset.active = String(active);
    play.setAttribute('aria-label', active ? 'Wstrzymaj muzykę w tle' : 'Odtwórz muzykę w tle');
  };
  sound.onChange(syncPlay);
  syncPlay();

  // ── poświata w rytm ───────────────────────────────────────
  // Osobna warstwa pod przyciskiem, a pętla zmienia wyłącznie jej krycie —
  // warstwa jest promowana (`will-change`), więc miganie nie przemalowuje
  // niczego. Rytm z tej samej siatki co puls pierścieni, z poprawką na
  // opóźnienie wyjścia audio. Pętla chodzi tylko przy grającej muzyce.
  const glow = play.querySelector('[data-player-glow]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let glowFrame = 0;
  const beatGlow = () => {
    glowFrame = 0;
    const beat = sound.beatPosition();
    if (beat == null) {
      glow.style.opacity = '0';
      return;
    }
    const n = Math.floor(beat);
    const seconds = ((beat - n) * 60) / sound.bpm;
    const level = GLOW_ACCENT[((n % 4) + 4) % 4] * Math.exp(-seconds / GLOW_DECAY);
    // odtwarzacz schowany poniżej progu szerokości — nic nie zapisujemy
    if (play.offsetParent !== null) glow.style.opacity = level.toFixed(3);
    glowFrame = requestAnimationFrame(beatGlow);
  };
  if (glow && !reducedMotion) {
    sound.onChange(() => {
      if (!glowFrame && sound.isPlaying()) glowFrame = requestAnimationFrame(beatGlow);
    });
  }

  // ── oś czasu ──────────────────────────────────────────────
  let scrubbing = false;

  const paintProgress = (time) => {
    const total = audio.duration;
    const p = Number.isFinite(total) && total > 0 ? time / total : 0;
    track.style.setProperty('--progress', `${(p * 100).toFixed(3)}%`);
    current.textContent = formatTime(time);
    timeline.setAttribute('aria-valuetext', `${formatTime(time)} z ${formatTime(total)}`);
  };

  const syncDuration = () => {
    const total = audio.duration;
    if (Number.isFinite(total)) timeline.max = String(total);
    duration.textContent = formatTime(total);
    paintProgress(audio.currentTime);
  };

  audio.addEventListener('loadedmetadata', syncDuration);
  audio.addEventListener('durationchange', syncDuration);
  audio.addEventListener('timeupdate', () => {
    // w trakcie przeciągania suwak należy do użytkownika — `timeupdate`
    // odbijałby go co 250 ms z powrotem
    if (scrubbing) return;
    timeline.value = String(audio.currentTime);
    paintProgress(audio.currentTime);
  });

  timeline.addEventListener('pointerdown', () => { scrubbing = true; });
  const release = () => { scrubbing = false; };
  timeline.addEventListener('pointerup', release);
  timeline.addEventListener('pointercancel', release);
  timeline.addEventListener('change', release);
  timeline.addEventListener('input', () => {
    const time = Number(timeline.value);
    paintProgress(time);
    if (Number.isFinite(audio.duration)) audio.currentTime = time;
  });

  syncDuration();

  // ── głośność ──────────────────────────────────────────────
  new Knob(root.querySelector('[data-player-knob]'), {
    value: sound.volume,
    defaultValue: sound.defaultVolume,
    valueEl: root.querySelector('[data-player-volume]'),
    onInput: (value) => sound.setVolume(value),
  });
}
