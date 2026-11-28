import { characterName } from './character-names.js';

const assets = 'assets/motion/pt/';
const portrait = document.querySelector('#expressionFaces');
const clip = document.querySelector('#expressionClip');
const play = document.querySelector('#expressionPlay');
const timeline = document.querySelector('#expressionTime');
const expressionStatus = document.querySelector('#expressionStatus');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let wantsPlayback = !reducedMotion.matches;
let finished = false;
let inView = false;

function status(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function syncPlayback() {
  if (!inView || document.hidden || !wantsPlayback || finished) {
    portrait.pause();
    return;
  }
  if (!portrait.getAttribute('src')) loadExpression();
  portrait.play().catch(error => {
    if (error.name === 'NotAllowedError') play.textContent = 'Play';
  });
}

function loadExpression() {
  timeline.value = '0';
  timeline.disabled = true;
  status(expressionStatus, '');
  portrait.src = assets + clip.value + '.mp4';
}

clip.addEventListener('change', () => {
  finished = false;
  wantsPlayback = !reducedMotion.matches;
  play.textContent = 'Play';
  loadExpression();
  syncPlayback();
});
play.addEventListener('click', () => {
  if (finished) {
    portrait.currentTime = 0;
    finished = false;
  }
  wantsPlayback = portrait.paused;
  syncPlayback();
});
portrait.addEventListener('play', () => { play.textContent = 'Pause'; });
portrait.addEventListener('pause', () => { play.textContent = finished ? 'Replay' : 'Play'; });
portrait.addEventListener('ended', () => {
  finished = true;
  wantsPlayback = false;
  play.textContent = 'Replay';
});
portrait.addEventListener('loadedmetadata', () => { timeline.disabled = false; });
portrait.addEventListener('error', () => status(expressionStatus, 'This expression could not be loaded.'));
portrait.addEventListener('timeupdate', () => {
  if (!portrait.duration) return;
  timeline.value = String(1000 * portrait.currentTime / portrait.duration);
  timeline.setAttribute('aria-valuetext', `${portrait.currentTime.toFixed(1)} seconds`);
});
timeline.addEventListener('input', () => {
  if (!Number.isFinite(portrait.duration)) return;
  if (finished && Number(timeline.value) < 1000) {
    finished = false;
    play.textContent = 'Play';
  }
  portrait.currentTime = Number(timeline.value) * portrait.duration / 1000;
});
document.addEventListener('visibilitychange', syncPlayback);
reducedMotion.addEventListener('change', () => {
  wantsPlayback = !reducedMotion.matches;
  syncPlayback();
});
new IntersectionObserver(([entry]) => {
  inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
  if (inView && !portrait.getAttribute('src')) loadExpression();
  syncPlayback();
}, { threshold: [0, 0.5] }).observe(portrait);

const sculptFaces = document.querySelector('#motionFaces');
const preset = document.querySelector('#sculptPreset');
const strength = document.querySelector('#sculptStrength');
const strengthValue = document.querySelector('#sculptValue');
const sculptStatus = document.querySelector('#sculptStatus');

async function initSculpt() {
  const response = await fetch(assets + 'sculpt.json');
  if (!response.ok) throw new Error('Shape editing could not be loaded.');
  const { faces, columns, faceRows, step } = await response.json();
  const rows = faces.length * faceRows;
  const views = faces.map(({ id, label }) => {
    const figure = document.createElement('figure');
    const surface = document.createElement('div');
    const image = new Image();
    const caption = document.createElement('figcaption');
    surface.className = 'motion-portrait';
    image.src = assets + id + '.webp';
    image.alt = '';
    caption.textContent = characterName(label);
    surface.append(image);
    figure.append(surface, caption);
    sculptFaces.append(figure);
    return { surface, image };
  });
  let atlas;

  function loadAtlas(index) {
    const image = new Image();
    const pending = { index, image, ready: false };
    atlas = pending;
    image.src = `${assets}sculpt-${index}.webp`;
    image.decode().then(() => {
      if (atlas !== pending) return;
      pending.ready = true;
      draw();
    }).catch(() => {
      if (atlas !== pending) return;
      atlas = undefined;
      if (Number(strength.value)) status(sculptStatus, 'This preset could not be loaded.');
    });
  }

  function draw() {
    const value = Number(strength.value);
    strengthValue.value = `${value}%`;
    if (!value) {
      status(sculptStatus, '');
      for (const { surface, image } of views) {
        surface.style.backgroundImage = '';
        image.hidden = false;
      }
      return;
    }
    if (atlas?.index !== preset.selectedIndex) loadAtlas(preset.selectedIndex);
    if (!atlas.ready) return;
    status(sculptStatus, '');
    const frame = value / step - 1;
    const x = (frame % columns) * 100 / (columns - 1);
    views.forEach(({ surface, image }, face) => {
      const y = (face * faceRows + Math.floor(frame / columns)) * 100 / (rows - 1);
      surface.style.backgroundImage = `url("${atlas.image.src}")`;
      surface.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
      surface.style.backgroundPosition = `${x}% ${y}%`;
      image.hidden = true;
    });
  }

  preset.addEventListener('change', () => {
    loadAtlas(preset.selectedIndex);
    draw();
  });
  strength.step = String(step);
  strength.addEventListener('input', draw);
  strength.disabled = preset.disabled = false;
  loadAtlas(preset.selectedIndex);
  draw();
}

const sculptObserver = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  sculptObserver.disconnect();
  initSculpt().catch(() => status(sculptStatus, 'Shape editing could not be loaded.'));
}, { rootMargin: '160px 0px' });
sculptObserver.observe(preset);
