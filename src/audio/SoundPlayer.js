import { Knob } from './Knob.js';

/**
 * Odtwarzacz w nagłówku: play / pauza, oś czasu z przewijaniem i gałka
 * głośności. Nie trzyma własnego stanu — wszystko czyta z `BackgroundSound`
 * i elementu audio, więc zgadza się z wyłącznikiem i z pierścieniami hero.
 */

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function mountSoundPlayer(root, sound) {
  if (!root) return;
  const { audio } = sound;
  const play = root.querySelector('[data-player-play]');
  const timeline = root.querySelector('[data-player-timeline]');
  const current = root.querySelector('[data-player-current]');
  const duration = root.querySelector('[data-player-duration]');

  root.hidden = false;

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

  // ── oś czasu ──────────────────────────────────────────────
  let scrubbing = false;

  const paintProgress = (time) => {
    const total = audio.duration;
    const p = Number.isFinite(total) && total > 0 ? time / total : 0;
    timeline.style.setProperty('--progress', `${(p * 100).toFixed(3)}%`);
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
