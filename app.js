'use strict';

const $ = (selector) => document.querySelector(selector);
const config = window.NERVFACE_CONFIG;
let toastTimer;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function mediaUrl(value) {
  if (!value) return null;
  const url = new URL(value, document.baseURI);
  return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
}
function setPublicationInfo() {
  if (config.title) { $('#projectTitle').textContent = config.title; document.title = `${config.title} | Project page`; }
  if (config.subtitle) $('#projectSubtitle').textContent = config.subtitle;
  if (config.description) { $('#projectDescription').textContent = config.description; $('#projectDescription').hidden = false; }
  if (config.venue) { $('#venue').textContent = config.venue; $('#venue').parentElement.hidden = false; }
  if (config.authors.length) {
    $('.metadata').hidden = false;
    $('#metadataSummary').textContent = `${config.authors.length} authors`;
    const body = $('#metadataBody');
    body.replaceChildren();
    for (const author of config.authors) {
      const line = document.createElement('p');
      line.textContent = `${author.name}${author.affiliation ? ` · ${author.affiliation}` : ''}`;
      body.append(line);
    }
  }
  $('#projectLinks').querySelectorAll('button').forEach((button) => button.remove());
  for (const [key, label] of [['paper', 'Paper'], ['code', 'Code'], ['dataset', 'Dataset']]) {
    const url = mediaUrl(config.links[key]);
    const control = document.createElement(url ? 'a' : 'button');
    control.className = 'button';
    control.textContent = label;
    if (url) { control.href = url; control.target = '_blank'; control.rel = 'noopener noreferrer'; }
    else {
      control.disabled = true;
      control.title = `${label} URL has not been provided`;
      const badge = document.createElement('span'); badge.className = 'soon'; badge.textContent = 'TBA'; control.append(badge);
    }
    $('#projectLinks').append(control);
  }
  const video = mediaUrl(config.teaserVideo);
  if (video && $('#videoSlot')) { $('#videoSlot').hidden = false; $('#teaserVideo').src = video; }
}
setPublicationInfo();

$('#menuButton').addEventListener('click', () => {
  const open = $('#menuButton').getAttribute('aria-expanded') !== 'true';
  $('#menuButton').setAttribute('aria-expanded', String(open));
  $('#navigation').dataset.open = String(open);
});
$('#navigation').addEventListener('click', (event) => {
  if (!event.target.closest('a')) return;
  $('#navigation').dataset.open = 'false';
  $('#menuButton').setAttribute('aria-expanded', 'false');
});
const lightbox = $('#lightbox');
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-lightbox]');
  if (!trigger) return;
  $('#lightboxImage').src = trigger.dataset.lightbox;
  $('#lightboxImage').alt = trigger.dataset.caption;
  $('#lightboxCaption').textContent = trigger.dataset.caption;
  lightbox.showModal();
});
$('#closeLightbox').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });

const frame = $('#compareFrame');
const handle = $('#compareHandle');
const split = { x: parseFloat(frame.style.getPropertyValue('--x')), y: parseFloat(frame.style.getPropertyValue('--y')) };
let splitAtNose = true;
function resetSplitToNose(announce = false) {
  const nose = cases[selectedHero]?.nose;
  if (!nose) return;
  updateSplit(nose[0], nose[1] - 3, announce);
  splitAtNose = true;
}
new ResizeObserver(() => { if (splitAtNose) resetSplitToNose(); }).observe(frame);
function updateSplit(x, y, announce = false) {
  splitAtNose = false;
  split.x = Math.max(0, Math.min(100, x)); split.y = Math.max(0, Math.min(100, y));
  frame.style.setProperty('--x', `${split.x}%`); frame.style.setProperty('--y', `${split.y}%`);
  if (announce) $('#comparePosition').textContent = `Dividers at ${Math.round(split.x)} percent horizontal and ${Math.round(split.y)} percent vertical.`;
}
function fromPointer(event) {
  const rect = frame.getBoundingClientRect();
  updateSplit((event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100);
}
frame.addEventListener('pointerdown', (event) => {
  if (frame.dataset.view !== 'split' || event.button > 0) return;
  stopReveal();
  event.preventDefault(); frame.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true }); fromPointer(event);
});
frame.addEventListener('pointermove', (event) => { if (frame.hasPointerCapture(event.pointerId)) fromPointer(event); });
frame.addEventListener('pointerup', (event) => {
  if (frame.hasPointerCapture(event.pointerId)) { frame.releasePointerCapture(event.pointerId); updateSplit(split.x, split.y, true); }
});
handle.addEventListener('keydown', (event) => {
  stopReveal();
  const step = event.shiftKey ? 10 : 2;
  const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (event.key === 'Home') { event.preventDefault(); resetSplitToNose(true); }
  else if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; updateSplit(split.x + x, split.y + y, true); }
});
const heroRegions = Array.from(document.querySelectorAll('[data-hero-region]'), select => ({
  select,
  image: frame.querySelector(`[data-hero-image="${select.dataset.heroRegion}"]`),
  badge: frame.querySelector(`[data-hero-label="${select.dataset.heroRegion}"]`),
}));
let heroCatalog = new Map();

function setHeroRegion(item, { select, image, badge }) {
  const kind = select.value;
  const label = select.selectedOptions[0].textContent;
  badge.textContent = label;
  image.src = heroImageUrl(item, kind);
  image.alt = `${item.label} · ${kind === 'uv' ? 'UV coordinates on the head' : label}`;
}

function syncHeroRegions(item) {
  for (const region of heroRegions) setHeroRegion(item, region);
}

for (const region of heroRegions) {
  region.select.addEventListener('change', () => {
    stopReveal();
    if (cases[selectedHero]) setHeroRegion(cases[selectedHero], region);
  });
}

let cases = [];
let assetCases = [];
let selectedHero = -1;
let selectedAsset = 1;
let heroSequence = 0;
let viewer;
let viewerPromise;
let selectedMaterial = 'full';
let selectedRenderMode = 'pathtraced';
function syncRenderControls() {
  document.querySelectorAll('.renderer-switch button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.renderMode === selectedRenderMode)));
  const wire = selectedMaterial === 'wireframe';
  $('#renderModeBadge').textContent = wire ? 'WIREFRAME / RASTER' : selectedRenderMode === 'pathtraced' ? 'PROGRESSIVE / PT' : 'REAL-TIME / RASTER';
}
function showSceneReport() {
  const report = viewer?.getReport();
  if (!report) return;
  $('#fidelityNotes').textContent = report.notes.join('\n\n');
  window.dispatchEvent(new CustomEvent('nervface-renderer-ready', { detail: { mode: report.mode, source: report.sourceURL } }));
}
syncRenderControls();
function selectButtons(container, index) {
  container.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
}
function makeCaseButtons(container, callback, collection=cases, active=selectedHero) {
  collection.forEach((item, index) => {
    const button = document.createElement('button'); button.className = 'case-chip';
    button.setAttribute('aria-pressed', String(index === active)); button.setAttribute('aria-label', `Select ${item.label}`);
    const image = new Image(); image.loading='lazy'; image.src = `${item.root}/${item.images?.input || 'thumb.webp'}`; image.alt = '';
    [image.width, image.height] = item.frameSize || [128, 128];
    const label = document.createElement('span'); label.textContent = item.label;
    button.append(image, label); button.addEventListener('click', () => callback(index)); container.append(button);
  });
}
function heroImageUrl(item, kind) {
  return `${item.root}/${item.images[kind]}`;
}
async function selectHero(index) {
  stopReveal();
  const sequence = ++heroSequence;
  const item = cases[index];
  $('#comparisonPanel').setAttribute('aria-busy', 'true');
  try {
    const filenames = [...new Set(heroRegions.map(region => region.select.value))];
    await Promise.all(filenames.map((filename) => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = heroImageUrl(item, filename);
    })));
    if (sequence !== heroSequence) return;
    selectedHero = index;
    syncHeroRegions(item);
    frame.closest('.comparison').style.setProperty('--portrait-ratio', item.frameSize[0] / item.frameSize[1]);
    resetSplitToNose(true);
    selectButtons($('#heroCases'), index);
    selectButtons($('#stageCases'), index);
    $('#compareCaseLabel').textContent = item.label;
    const inSupplement = assetCases.some(asset => asset.sourceName === item.sourceName);
    const explore = $('#inspectCase');
    explore.firstChild.textContent = inSupplement ? 'Explore this face in 3D ' : 'Find this face in the collection ';
    explore.setAttribute('aria-label', inSupplement ? `Explore ${item.label} in 3D` : 'Find this face in the collection');
  } catch { notify('Could not load this comparison. Please check the case image files.'); }
  finally { if (sequence === heroSequence) $('#comparisonPanel').removeAttribute('aria-busy'); }
}
function viewerError(message) {
  $('#viewerFrame').dataset.state = 'error'; $('#viewerStatusText').textContent = message; $('#retryViewer').hidden = false;
}
async function loadCase(index) {
  const item=assetCases[index];
  await viewer.load(`${item.root}/${item.model}`, 'viewer-scene.json');
  if (index === selectedAsset) showSceneReport();
}
async function ensureViewer() {
  if (viewerPromise) return viewerPromise;
  if (viewer) return viewer;
  viewerPromise = (async () => {
    try {
      const module = await import('./viewer.bundle.js?v=viewer-recovery7');
      viewer = await module.createViewer({
        host: $('#viewerCanvas'), initialRenderMode: selectedRenderMode,
        onState(state, text, progress = 0) {
          $('#viewerFrame').dataset.state = state;
          $('#viewerStatusText').textContent = text;
          $('#modelProgress').value = progress;
          $('#retryViewer').hidden = state !== 'error';
        },
        onInfo(text) { $('#rendererInfo').textContent = text.split(' · ').slice(0, 3).join(' · '); }
      });
      viewer.setRenderMode(selectedRenderMode);
      viewer.setMaterial(selectedMaterial);
      await environmentsReady;
      for (const entry of environments) {
        await viewer.registerEnvironment({ id: entry.id, url: entry.file, name: entry.name, intensity: entry.intensity, rotation: (entry.rotation || 0) * Math.PI / 180 });
      }
      if (selectedEnvironment !== 'source') await viewer.setEnvironment(selectedEnvironment);
      await loadCase(selectedAsset);
      viewer.setAutoRotate($('#rotateButton').getAttribute('aria-pressed') === 'true');
      return viewer;
    } catch (error) {
      viewerError(`Viewer could not start: ${error.message} Reload the page to retry.`);
      console.error('Viewer initialization failed:', error);
      return null;
    } finally { viewerPromise = null; }
  })();
  return viewerPromise;
}
async function selectAsset(index) {
  selectedAsset = index; const item = assetCases[index];
  $('#assetCaseSelect').value=String(index);
  selectButtons($('#assetCases'), index);
  $('#assetInput').src = `${item.root}/${item.images.input}`; $('#assetInput').alt = `${item.label} input portrait`;
  $('#assetInputLabel').textContent = item.label; $('#viewerTitle').textContent = item.label;
  try {
    if (viewer) await loadCase(index);
    else await ensureViewer();
  } catch (error) { if (index === selectedAsset) viewerError(error.message); }
}
let recoveryPromise = null;
function recoverViewer() {
  if (recoveryPromise) return recoveryPromise;
  const controls = [...document.querySelectorAll('#assets button, #assets select, #assets input')];
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  $('#reloadViewer').textContent = 'Reloading…';
  recoveryPromise = (async () => {
    try {
      if (viewerPromise) await viewerPromise;
      const previous = viewer;
      const report = previous?.getReport();
      viewer = null;
      viewerPromise = null;
      $('#viewerFrame').dataset.state = 'loading';
      $('#viewerStatusText').textContent = 'Rebuilding the viewer and reloading textures…';
      $('#retryViewer').hidden = true;
      // Recreate GPU resources as well as the model: a material refresh alone
      // cannot recover stale atlas bindings or a lost WebGPU device.
      await previous?.dispose().catch(error => console.warn('Previous viewer cleanup:', error));
      const instance = await ensureViewer();
      if (instance && report?.sourceURL) {
        instance.setCameraMatrix(report.camera.matrixWorld);
        if (report.environment.id !== 'source') {
          instance.setEnvironmentIntensity(report.environment.intensity);
          instance.setEnvironmentRotation(report.environment.rotationDegrees);
        }
        showSceneReport();
      }
    } catch (error) {
      viewerError(`Viewer recovery failed: ${error.message} Try Reload viewer again.`);
    } finally {
      controls.forEach((control, i) => { control.disabled = disabled[i]; });
      $('#reloadViewer').textContent = '↻ Reload viewer';
      recoveryPromise = null;
    }
  })();
  return recoveryPromise;
}
// Lighting environments. 'source' is the inherited Blender world + area lights.
let environments = [];
let resolveEnvironmentsReady;
const environmentsReady = new Promise((resolve) => { resolveEnvironmentsReady = resolve; });
let selectedEnvironment = 'source';
let environmentBusy = false;
function syncEnvironmentControls() {
  document.querySelectorAll('.environment-option').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.environment === selectedEnvironment)));
  const entry = environments.find(item => item.id === selectedEnvironment);
  $('#environmentStatus').textContent = selectedEnvironment === 'source' ? 'Source lighting' : `${entry?.name || selectedEnvironment} · HDRI`;
  $('#environmentAdjust').hidden = selectedEnvironment === 'source';
  if (entry && selectedEnvironment !== 'source') {
    $('#environmentIntensity').value = entry.intensity;
    $('#environmentIntensityValue').textContent = `${Number(entry.intensity).toFixed(2).replace(/0$/, '')}×`;
    $('#environmentRotation').value = entry.rotation || 0;
    $('#environmentRotationValue').textContent = `${entry.rotation || 0}°`;
  }
}
async function selectEnvironment(id) {
  if (environmentBusy || id === selectedEnvironment) return;
  const previous = selectedEnvironment;
  selectedEnvironment = id;
  syncEnvironmentControls();
  if (!viewer) { await ensureViewer(); return; }
  environmentBusy = true;
  try {
    await viewer.setEnvironment(id);
    showSceneReport();
  } catch (error) {
    selectedEnvironment = previous;
    syncEnvironmentControls();
    notify(`Lighting change failed: ${error.message}`);
  } finally { environmentBusy = false; }
}
async function initializeEnvironments() {
  try {
    const response = await fetch('assets/hdri/manifest.json');
    if (!response.ok) throw new Error('Missing HDRI manifest');
    environments = await response.json();
    const container = $('#environmentOptions');
    for (const entry of environments) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'environment-option';
      button.dataset.environment = entry.id;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', `Use ${entry.name} HDRI lighting`);
      const swatch = document.createElement('span'); swatch.className = 'environment-swatch';
      const image = new Image(); image.src = entry.thumb; image.alt = ''; image.loading = 'lazy';
      swatch.append(image);
      const name = document.createElement('span'); name.className = 'environment-name';
      name.textContent = entry.name;
      button.append(swatch, name);
      button.addEventListener('click', () => selectEnvironment(entry.id));
      container.append(button);
    }
    container.querySelector('[data-environment="source"]').addEventListener('click', () => selectEnvironment('source'));
    syncEnvironmentControls();
  } catch (error) {
    $('#environmentStatus').textContent = 'Could not load HDRI list';
    console.error('HDRI manifest failed:', error);
  } finally { resolveEnvironmentsReady(); }
}
initializeEnvironments();
let environmentAdjustTimer;
function scheduleEnvironmentAdjust(kind, value) {
  clearTimeout(environmentAdjustTimer);
  environmentAdjustTimer = setTimeout(() => {
    const entry = environments.find(item => item.id === selectedEnvironment);
    if (!entry || !viewer) return;
    try {
      if (kind === 'intensity') { entry.intensity = value; viewer.setEnvironmentIntensity(value); }
      else { entry.rotation = value; viewer.setEnvironmentRotation(value); }
    } catch (error) { notify(error.message); }
  }, 120);
}
$('#environmentIntensity').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  $('#environmentIntensityValue').textContent = `${value.toFixed(2).replace(/0$/, '')}×`;
  scheduleEnvironmentAdjust('intensity', value);
});
$('#environmentRotation').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  $('#environmentRotationValue').textContent = `${value}°`;
  scheduleEnvironmentAdjust('rotation', value);
});

document.querySelectorAll('[data-material]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedMaterial = button.dataset.material;
    document.querySelectorAll('[data-material]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    viewer?.setMaterial(selectedMaterial);
    syncRenderControls();
  });
});
document.querySelectorAll('.renderer-switch button').forEach(button => {
  button.addEventListener('click', async () => {
    selectedRenderMode = button.dataset.renderMode;
    if (selectedRenderMode === 'pathtraced' && selectedMaterial === 'wireframe') {
      selectedMaterial = 'full';
      document.querySelectorAll('[data-material]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.material === 'full')));
      viewer?.setMaterial('full');
    }
    syncRenderControls();
    if (viewer) { viewer.setRenderMode(selectedRenderMode); showSceneReport(); }
    else await ensureViewer();
  });
});
$('#rotateButton').addEventListener('click', () => {
  const rotate = $('#rotateButton').getAttribute('aria-pressed') !== 'true';
  $('#rotateButton').setAttribute('aria-pressed', String(rotate));
  viewer?.setAutoRotate(rotate);
});
$('#resetButton').addEventListener('click', () => viewer?.reset());
$('#fullscreenButton').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#viewerFrame').requestFullscreen(); }
  catch { notify('Fullscreen is not supported in this browser.'); }
});
if (!document.fullscreenEnabled) $('#fullscreenButton').hidden = true;
$('#retryViewer').addEventListener('click', recoverViewer);
$('#reloadViewer').addEventListener('click', recoverViewer);

async function initializeCases() {
  try {
    const response = await fetch('assets/cases.json?v=rgb-cover-2');
    if (!response.ok) throw new Error('Missing case manifest');
    cases = await response.json();
    if (!cases.length) throw new Error('No cases available');
    selectedHero = Math.max(0, cases.findIndex(item => item.sourceName === 'sam'));
    const assetResponse=await fetch('assets/showcase/cases.json?v=rgb-cover-2');
    if(!assetResponse.ok) throw new Error('Missing full character collection');
    const gallery = (await assetResponse.json()).map(item => ({...item, sourceName: item.selectionId.split('/').pop()}));
    heroCatalog = new Map(gallery.map(item => [item.sourceName, item]));
    const supplementResponse = await fetch('assets/motion/supplement.json');
    if (!supplementResponse.ok) throw new Error('Missing supplement character list');
    const supplement = new Set(await supplementResponse.json());
    assetCases = gallery.filter(item => supplement.has(item.id));
    if(!assetCases.length) throw new Error('No 3D characters available');
    selectedAsset=Math.max(0,assetCases.findIndex(item=>item.sourceName==='Elon_Musk_02'));
    makeCaseButtons($('#assetCases'), selectAsset, assetCases, selectedAsset);
    $('#assetCaseSelect').replaceChildren(...assetCases.map((item,index)=>{
      const option=document.createElement('option'); option.value=String(index); option.textContent=item.label; return option;
    }));
    $('#assetCaseSelect').value=String(selectedAsset);
    $('#assetCaseSelect').addEventListener('change',event=>selectAsset(Number(event.target.value)));
    makeCaseButtons($('#heroCases'), selectHero);
    cases.forEach((item, index) => {
      const button = document.createElement('button');
      button.title = item.label;
      button.setAttribute('aria-label', `Select ${item.label}`);
      button.setAttribute('aria-pressed', String(index === selectedHero));
      button.addEventListener('click', () => selectHero(index));
      $('#stageCases').append(button);
    });
    await selectHero(selectedHero);
    $('#assetInput').src = `${assetCases[selectedAsset].root}/${assetCases[selectedAsset].images.input}`;
    $('#assetInput').alt = `${assetCases[selectedAsset].label} input portrait`;
    $('#assetInputLabel').textContent = assetCases[selectedAsset].label;
    $('#viewerTitle').textContent = assetCases[selectedAsset].label;
    selectButtons($('#assetCases'), selectedAsset);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); ensureViewer(); }
    }, { rootMargin: '250px' });
    observer.observe($('#assets'));
  } catch (error) {
    viewerError('Assets could not be loaded. Start the local server with start.cmd instead of opening index.html directly.');
    notify('Start the local server with start.cmd to enable interactive features.');
    console.error(error);
  }
}
initializeCases();
const sections = [...document.querySelectorAll('main > section[id]')];
const navigationObserver = new IntersectionObserver((entries) => {
  const active = entries.find((entry) => entry.isIntersecting);
  if (!active) return;
  $('#navigation').querySelectorAll('a').forEach((link) => {
    if (link.hash === `#${active.target.id}`) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
}, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
sections.forEach((section) => navigationObserver.observe(section));

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function inspectAsset(index) {
  const assetIndex=assetCases.findIndex(item=>item.sourceName===cases[index].sourceName);
  if (assetIndex < 0) {
    const item = heroCatalog.get(cases[index].sourceName);
    if (item) location.hash = `compare-${item.id}`;
    return;
  }
  selectAsset(assetIndex);
  $('#assets').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
}
$('#inspectCase').addEventListener('click', (event) => {
  if (!cases.length) return;
  event.preventDefault(); inspectAsset(selectedHero);
});

// The slim red rule reflects actual reading position, not a looping decoration.
let progressQueued = false;
function updateReadingProgress() {
  const length = document.documentElement.scrollHeight - window.innerHeight;
  const progress = length > 0 ? Math.min(1, Math.max(0, window.scrollY / length)) : 0;
  $('#readingProgress').style.transform = `scaleX(${progress})`;
  progressQueued = false;
}
function requestProgressUpdate() {
  if (progressQueued) return;
  progressQueued = true; requestAnimationFrame(updateReadingProgress);
}
window.addEventListener('scroll', requestProgressUpdate, { passive: true });
window.addEventListener('resize', requestProgressUpdate);
new ResizeObserver(requestProgressUpdate).observe(document.body);
requestProgressUpdate();

// Optional, one-shot comparison choreography. Any manual action takes over immediately.
let revealFrame = 0;
function stopReveal() {
  cancelAnimationFrame(revealFrame); revealFrame = 0;
  $('#playReveal').setAttribute('aria-pressed', 'false');
  $('#playReveal').setAttribute('aria-label', 'Play comparison reveal');
  $('#playReveal').title = 'Play comparison reveal';
}
$('#playReveal').addEventListener('click', () => {
  if (revealFrame) { stopReveal(); return; }
  if (reducedMotion.matches) return;
  frame.dataset.view = 'split';
  document.querySelectorAll('.compare-modes button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === 'split')));
  const startedAtNose = splitAtNose;
  const points = [[split.x, split.y], [65, 12], [12, 86], [88, 86], [split.x, split.y]];
  const start = performance.now();
  $('#playReveal').setAttribute('aria-label', 'Stop comparison reveal');
  $('#playReveal').title = 'Stop comparison reveal';
  $('#playReveal').setAttribute('aria-pressed', 'true');
  function animate(now) {
    const phase = Math.min(4, (now - start) / 850);
    if (phase >= 4) {
      if (startedAtNose) resetSplitToNose(true); else updateSplit(...points[4], true);
      stopReveal();
      return;
    }
    const segment = Math.floor(phase);
    const local = phase - segment;
    const eased = local * local * (3 - 2 * local);
    updateSplit(points[segment][0] + (points[segment + 1][0] - points[segment][0]) * eased,
      points[segment][1] + (points[segment + 1][1] - points[segment][1]) * eased);
    revealFrame = requestAnimationFrame(animate);
  }
  revealFrame = requestAnimationFrame(animate);
});
function syncMotionPreference() {
  if (reducedMotion.matches) stopReveal();
  $('#playReveal').disabled = reducedMotion.matches;
  $('#playReveal').title = reducedMotion.matches ? 'Animation disabled by your reduced-motion preference' : 'Preview all three views; drag at any time to take control';
}
document.querySelectorAll('#focusCompare, #resetCompare').forEach(button => {
  button.addEventListener('click', () => {
    stopReveal();
    frame.dataset.view = 'split';
    document.querySelectorAll('.compare-modes button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.view === 'split')));
    if (button.id === 'resetCompare') resetSplitToNose(true);
    handle.focus({ preventScroll: true });
  });
});
reducedMotion.addEventListener('change', syncMotionPreference);
syncMotionPreference();
document.addEventListener('visibilitychange', () => { if (document.hidden) stopReveal(); });
document.querySelectorAll('[data-camera]').forEach(button => {
  button.addEventListener('click', () => {
    if (!viewer) return;
    viewer.setAutoRotate(false);
    $('#rotateButton').setAttribute('aria-pressed', 'false');
    viewer.setView(Number(button.dataset.camera));
  });
});
