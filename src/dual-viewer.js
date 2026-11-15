import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { texture, lightViewPosition, cameraViewMatrix, vec4, uniform } from 'three/tsl';
import { rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { ShapedAreaLight } from 'three-gpu-pathtracer/src/objects/ShapedAreaLight.js';

const MAX_SAMPLES = 256;
const MAX_BOUNCES = 15;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

class ViewerRenderer extends THREE.WebGPURenderer {
  pending = new Set();
  failure = null;

  track(promise) {
    const tracked = promise.catch((error) => {
      this.failure = error;
      this.onError({ api: 'WebGPU', message: error.message });
      throw error;
    });
    this.pending.add(tracked);
    tracked.then(() => this.pending.delete(tracked), () => this.pending.delete(tracked));
    return tracked;
  }

  compileComputeAsync(...args) {
    return this.track(super.compileComputeAsync(...args).then(() => this.checkPipelines()));
  }

  compileAsync(...args) {
    return this.track(super.compileAsync(...args).then(() => this.checkPipelines()));
  }

  getArrayBufferAsync(...args) {
    return this.track(super.getArrayBufferAsync(...args));
  }

  resolveTimestampsAsync(...args) {
    return this.track(super.resolveTimestampsAsync(...args)).catch(() => undefined);
  }

  checkPipelines() {
    if (this.failure) throw this.failure;
    for (const pipeline of this._pipelines.caches.values()) {
      if (this.backend.get(pipeline).error) {
        throw new Error(`WebGPU shader compilation failed (${pipeline.computeProgram?.name || pipeline.fragmentProgram?.name || 'pipeline'}). See the browser console for WGSL diagnostics; update the browser/GPU driver and reload.`);
      }
    }
  }

  async settle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    await this.backend.device.queue.onSubmittedWorkDone();
  }
}

class ViewerPathTracer extends WebGPUPathTracer {
  async getSampleCountsAsync() {
    try { return await super.getSampleCountsAsync(); }
    catch (error) {
      this._renderer.onError({ api: 'WebGPU', message: error.message });
      return { min: 0, max: 0, avg: 0, samplesPerSecond: 0 };
    }
  }

  updateEnvironment() {
    const previous = this._pathTracer.envInfo.cdfNode.value;
    super.updateEnvironment();
    if (previous !== this._pathTracer.envInfo.cdfNode.value) previous.dispose();
  }
}

function requireNumber(value, label, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid scene.json ${label}.`);
  return value;
}

function requireVector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new Error(`Invalid scene.json ${label}: expected ${length} finite numbers.`);
  }
  return value;
}

function sourceMatrix(value, label) {
  const matrix = new THREE.Matrix4().fromArray(requireVector(value, 16, label));
  if (Math.abs(matrix.determinant()) < 1e-14 || Math.abs(value[3]) + Math.abs(value[7]) + Math.abs(value[11]) > 1e-8 || Math.abs(value[15] - 1) > 1e-8) {
    throw new Error(`Invalid scene.json ${label}: expected a nonsingular affine column-major matrix.`);
  }
  return matrix;
}

function validateMetadata(metadata) {
  if (metadata.coordinateSystem !== 'blender_source_no_normalization') throw new Error('scene.json must declare blender_source_no_normalization; normalized assets cannot restore the source camera.');
  sourceMatrix(metadata.camera?.matrixWorld, 'camera.matrixWorld');
  const camera = metadata.camera;
  if (requireNumber(camera.fovYDegrees, 'camera.fovYDegrees', 0) >= 180 || camera.fovYDegrees === 0) throw new Error('Invalid source camera field of view.');
  requireNumber(camera.aspect, 'camera.aspect', Number.EPSILON);
  requireNumber(camera.near, 'camera.near', Number.EPSILON);
  if (requireNumber(camera.far, 'camera.far') <= camera.near) throw new Error('Invalid source camera clipping planes.');
  requireVector(metadata.controlsTarget, 3, 'controlsTarget');
  if (new THREE.Vector3().setFromMatrixPosition(sourceMatrix(camera.matrixWorld, 'camera.matrixWorld')).distanceToSquared(new THREE.Vector3().fromArray(metadata.controlsTarget)) < 1e-14) throw new Error('Source camera and controls target coincide.');
  requireVector(metadata.world?.color, 3, 'world.color');
  if (metadata.world.color.some((v) => v < 0)) throw new Error('Negative world radiance is unsupported.');
  requireNumber(metadata.world.strength, 'world.strength', 0);
  if (typeof metadata.world.transparent !== 'boolean') throw new Error('Missing scene.json world.transparent.');
  if (!Array.isArray(metadata.lights) || !Array.isArray(metadata.materials)) throw new Error('scene.json must contain lights and materials arrays.');
  if (!metadata.colorManagement) throw new Error('Missing scene.json colorManagement.');
  requireNumber(metadata.colorManagement.exposure, 'colorManagement.exposure');
  requireNumber(metadata.colorManagement.gamma, 'colorManagement.gamma', Number.EPSILON);
}

function createSourceLight(source, notes, LightClass = ShapedAreaLight) {
  if (source.type !== 'AREA') throw new Error(`Unsupported source light type: ${source.type}. No replacement lighting was added.`);
  if (!['DISK', 'ELLIPSE', 'SQUARE', 'RECTANGLE'].includes(source.shape)) throw new Error(`Unsupported source area shape: ${source.shape}.`);
  const matrix = sourceMatrix(source.matrixWorld, `${source.name}.matrixWorld`);
  const axes = [0, 1, 2].map((index) => new THREE.Vector3().setFromMatrixColumn(matrix, index));
  const scale = axes.map((axis) => axis.length());
  const unit = axes.map((axis) => axis.clone().normalize());
  if (matrix.determinant() <= 0 || Math.abs(unit[0].dot(unit[1])) + Math.abs(unit[0].dot(unit[2])) + Math.abs(unit[1].dot(unit[2])) > 1e-5) {
    throw new Error(`${source.name}: mirrored/sheared area-light transforms are unsupported; not approximating the source.`);
  }
  const width = requireNumber(source.size, `${source.name}.size`, Number.EPSILON) * scale[0];
  const height = (['DISK', 'SQUARE'].includes(source.shape) ? source.size : requireNumber(source.sizeY, `${source.name}.sizeY`, Number.EPSILON)) * scale[1];
  const circular = ['DISK', 'ELLIPSE'].includes(source.shape);
  const area = width * height * (circular ? Math.PI / 4 : 1);
  if (typeof source.normalize !== 'boolean') throw new Error(`${source.name}: missing light normalization flag.`);
  const power = requireNumber(source.powerW, `${source.name}.powerW`, 0);
  const radiance = power / (Math.PI * (source.normalize ? area : 1));
  const color = new THREE.Color().fromArray(requireVector(source.color, 3, `${source.name}.color`));
  const light = new LightClass(color, radiance, width, height);
  light.name = source.name;
  light.isCircular = circular;
  light.matrixAutoUpdate = false;
  light.matrix.copy(matrix);
  light.matrixWorld.copy(matrix);
  light.visibleToCameraRays = source.visibleToCameraRays === true;
  light.userData.source = { shape: source.shape, powerW: power, normalize: source.normalize, area, emittedRadiance: radiance };
  const spread = requireNumber(source.spread, `${source.name}.spread`, 0);
  if (Math.abs(spread - Math.PI) > 1e-5) notes.add(`${source.name}: source spread ${THREE.MathUtils.radToDeg(spread).toFixed(2)}° unsupported; using 180° emission`);
  return light;
}

function applySourceCamera(camera, source, pivotArray, degrees) {
  const sourceWorld = sourceMatrix(source.matrixWorld, 'camera.matrixWorld');
  const pivot = new THREE.Vector3().fromArray(pivotArray);
  if (degrees === 0) camera.matrix.copy(sourceWorld);
  else {
    const rotation = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(degrees));
    camera.matrix.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(sourceWorld);
  }
  camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldNeedsUpdate = true;
  camera.updateMatrixWorld(true);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.fov = source.fovYDegrees; camera.aspect = source.aspect;
  camera.near = source.near; camera.far = source.far; camera.zoom = 1;
  camera.updateProjectionMatrix();
  if (source.frustum) {
    const f=source.frustum, n=source.near;
    for (const key of ['left','right','top','bottom']) requireNumber(f[key], `camera.frustum.${key}`);
    if (f.right<=f.left || f.top<=f.bottom) throw new Error('Invalid shifted source camera frustum.');
    camera.projectionMatrix.makePerspective(f.left*n,f.right*n,f.top*n,f.bottom*n,n,source.far,THREE.WebGPUCoordinateSystem);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}

function disposeRoots(roots, originals = new Map(), excluded = new Set()) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const images = new Set();
  for (const root of roots) root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (!object.material) return;
    const material = originals.get(object) || object.material;
    for (const item of Array.isArray(material) ? material : [material]) {
      if (excluded.has(item)) continue;
      materials.add(item);
      for (const value of Object.values(item)) if (value?.isTexture) textures.add(value);
    }
    object.skeleton?.dispose();
  });
  for (const texture of textures) {
    if (texture.source?.data) images.add(texture.source.data);
    texture.dispose();
  }
  for (const image of images) image.close?.();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) {
    geometry.boundsTree = null;
    geometry.dispose();
  }
}

export async function createViewer({ host, onState = () => {}, onInfo = () => {}, onCameraChange = () => {}, onEnvironmentChange = () => {}, interactive = true, initialRenderMode = 'pathtraced' }) {
  if (!host) throw new Error('createViewer requires a host element.');
  if (!globalThis.isSecureContext || !navigator.gpu) {
    const message = 'WebGPU path tracing requires a current WebGPU-enabled browser on localhost or HTTPS with hardware acceleration enabled.';
    onState('error', message, 0);
    throw new Error(message);
  }
  let renderer;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const requiredLimits = Object.fromEntries(['maxStorageBuffersPerShaderStage', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxTextureDimension2D', 'maxStorageTexturesPerShaderStage'].map((key) => [key, adapter.limits[key]]));
    renderer = new ViewerRenderer({ alpha: true, antialias: true, samples: 4, powerPreference: 'high-performance', trackTimestamp: true, requiredLimits });
    renderer.getFallback = null;
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) throw new Error('A native WebGPU backend is required.');
  } catch (error) {
    renderer?.dispose();
    const message = `WebGPU initialization failed: ${error.message} Enable hardware acceleration, update your browser/GPU driver, and use localhost or HTTPS.`;
    onState('error', message, 0);
    throw new Error(message);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.backgroundColor = 'white';
  canvas.style.objectFit = 'contain';
  host.append(canvas);
  const camera = new THREE.PerspectiveCamera();
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.matrixAutoUpdate = false;
  // Unproject in camera space before applying world translation. Combining the
  // matrices first loses pixel-sized differences for the source telephoto cameras
  // (tiny near plane, distant camera), producing blocky rays even at full resolution.
  camera.getCameraRayFn = () => {
    const inverseProjection = uniform(new THREE.Matrix4());
    const cameraWorld = uniform(new THREE.Matrix4());
    const clipRatio = uniform(1);
    return {
      update() {
        camera.updateMatrixWorld();
        inverseProjection.value.copy(camera.projectionMatrixInverse);
        cameraWorld.value.copy(camera.matrixWorld);
        clipRatio.value = camera.far / camera.near - 1;
        return false;
      },
      fn: wgslTagFn`
        fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${rayStruct}> ) -> bool {
          let nearH = ${inverseProjection} * vec4f(uv * 2.0 - vec2f(1.0), 0.0, 1.0);
          let localNear = nearH.xyz / nearH.w;
          let worldOffset = (${cameraWorld} * vec4f(localNear, 0.0)).xyz;
          let nearDistance = length(worldOffset);
          (*ray).origin = ${cameraWorld}[3].xyz + worldOffset;
          (*ray).direction = worldOffset / nearDistance;
          (*ray).maxDist = nearDistance * ${clipRatio};
          return true;
        }
      `,
    };
  };
  const orbitCamera = new THREE.PerspectiveCamera();
  const rasterCamera = new THREE.PerspectiveCamera();
  const sourceWorld = new THREE.Matrix4();
  const orbitHomeInverse = new THREE.Matrix4();
  const gray = new THREE.MeshStandardMaterial({ color: 0x989898, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const wireframe = new THREE.MeshBasicMaterial({ color: 0x333333, wireframe: true, side: THREE.DoubleSide });
  const sharedMaterials = new Set([gray, wireframe]);
  let ltcTextures;
  class ViewerAreaLight extends ShapedAreaLight {}
  class ViewerAreaLightNode extends THREE.RectAreaLightNode {
    setupDirectRectArea(builder) {
      ltcTextures ||= RectAreaLightTexturesLib.init.call({});
      const prefix = builder.isAvailable('float32Filterable') ? 'LTC_FLOAT_' : 'LTC_HALF_';
      return {
        lightColor: this.colorNode,
        lightPosition: lightViewPosition(this.light),
        halfWidth: cameraViewMatrix.mul(vec4(this.halfWidth, 0)).xyz,
        halfHeight: cameraViewMatrix.mul(vec4(this.halfHeight, 0)).xyz,
        ltc_1: texture(ltcTextures[`${prefix}1`]),
        ltc_2: texture(ltcTextures[`${prefix}2`])
      };
    }
  }
  ViewerAreaLight.registerNode(ViewerAreaLightNode);
  let tracer;
  let tracerScene = null;
  let tracerMaterialMode = null;
  let controls;
  let current;
  let request;
  let requestId = 0;
  let modeRevision = 0;
  let materialMode = 'full';
  let requestedRenderMode = initialRenderMode;
  let autoRotate = false;
  let loading = false;
  let disposed = false;
  let failed = false;
  let visible = false;
  let drawable = false;
  let frame = 0;
  let lastTime = 0;
  let needsRender = true;
  let pendingPTCamera = false;
  let rasterReady = false;
  let sampleCounts = { min: 0, max: 0, avg: 0 };
  let lastInfo = '';
  let lastStage = '';
  let lastPipelineCheck = 0;

  function effectiveMode() { return materialMode === 'wireframe' ? 'raster' : requestedRenderMode; }
  function state(kind, text, progress = 0) { if (!disposed) onState(kind, text, THREE.MathUtils.clamp(progress, 0, 100)); }
  function info() {
    const raster = effectiveMode() === 'raster';
    const stage = failed ? 'failed' : loading ? 'loading' : !current ? 'waiting for source assets' : !visible || document.hidden ? 'paused while hidden' : lastStage;
    const mode = raster ? `WebGPU raster · ${materialMode} · not path traced` : `WebGPU path tracing · ${materialMode} · ${sampleCounts.avg.toFixed(1)}/${MAX_SAMPLES} spp${tracer?.lowResMode ? ' · interactive low-res PT' : ''}`;
    const notes = current ? [...current.notes] : [];
    if (activeEnvironmentId !== 'source') notes.push(`relit by HDRI "${environmentLibrary.get(activeEnvironmentId)?.name || activeEnvironmentId}"; source world and area lights hidden`);
    if (raster && materialMode !== 'wireframe') notes.push('raster has no traced GI/shadows; disk/ellipse lights use rectangular LTC shading');
    const text = [mode, stage, ...notes].filter(Boolean).join(' · ');
    host.dataset.renderMode = effectiveMode();
    host.dataset.samples = String(sampleCounts.avg);
    const ptImage=tracer?.target?.image;
    host.dataset.ptResolution=ptImage?`${ptImage.width}x${ptImage.height}`:'';
    host.dataset.canvasResolution=`${canvas.width}x${canvas.height}`;
    host.dataset.ptLowResolution=String(Boolean(tracer?.lowResMode));
    if (text !== lastInfo) { lastInfo = text; onInfo(text); }
  }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
  function wake() {
    if (!frame && !disposed && !failed && !loading && current && drawable && visible && !document.hidden) frame = requestAnimationFrame(renderFrame);
  }
  function fail(error) {
    if (disposed || failed) return;
    failed = true;
    stop();
    if (controls) controls.enabled = false;
    state('error', `Renderer stopped: ${error.message || error} No raster fallback was substituted.`, 0);
    info();
  }
  renderer.onError = (error) => fail(new Error(error.message));
  renderer.onDeviceLost = (error) => fail(new Error(`WebGPU device lost: ${error.message}. Reload the page to restart.`));
  try {
    tracer = new ViewerPathTracer(renderer);
    tracer.maxBounces = MAX_BOUNCES;
    tracer.maxSamples = MAX_SAMPLES;
    // Keep the PT image at canvas resolution, including after camera resets.
    // The adaptive preview can otherwise enlarge a tiny image into visible blocks.
    tracer.dynamicLowRes = false;
    tracer.adaptiveDynamicRes = false;
    tracer.renderScale = 1;
    tracer.renderDelay = 0;
    tracer.fadeDuration = 0;
    tracer.asyncCompile = true;
    tracer.filterGlossyFactor = 0;
    tracer.clampDirect = 0;
    tracer.clampIndirect = 0;
    tracer.adaptiveFrameBudget = renderer.backend.trackTimestamp;
  } catch (error) {
    renderer.dispose(); canvas.remove(); gray.dispose(); wireframe.dispose();
    state('error', `WebGPU path-tracer initialization failed: ${error.message}`, 0);
    throw error;
  }

  function invalidateCamera() {
    needsRender = true;
    if (current && tracerScene === current.scene) {
      // Finish a visible full-resolution PT frame before adopting the latest
      // moving camera. Resetting every animation tick would never finish a frame.
      if (effectiveMode() === 'pathtraced' && sampleCounts.avg < 2) pendingPTCamera = true;
      else {
        pendingPTCamera = false;
        sampleCounts = { min: 0, max: 0, avg: 0 };
        tracer.updateCamera();
      }
    }
    wake();
  }
  function syncCameraFromControls() {
    orbitCamera.updateMatrixWorld(true);
    camera.matrix.multiplyMatrices(orbitCamera.matrixWorld, orbitHomeInverse).multiply(sourceWorld);
    camera.matrixWorldNeedsUpdate = true;
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld(true);
    host.dataset.sourceView = 'orbit';
    invalidateCamera();
    onCameraChange(camera.matrixWorld.toArray());
  }
  function installControls(position) {
    controls?.dispose();
    orbitCamera.position.copy(position);
    orbitCamera.up.copy(WORLD_UP);
    orbitCamera.fov = camera.fov;
    orbitCamera.aspect = camera.aspect;
    orbitCamera.near = camera.near;
    orbitCamera.far = camera.far;
    orbitCamera.updateProjectionMatrix();
    controls = new OrbitControls(orbitCamera, canvas);
    controls.target.fromArray(current.metadata.controlsTarget);
    const distance = new THREE.Vector3().setFromMatrixPosition(sourceWorld).distanceTo(controls.target);
    controls.minDistance = distance * 0.05;
    controls.maxDistance = distance * 20;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.update();
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.autoRotateSpeed = 1.2;
    controls.autoRotate = autoRotate;
    controls.enabled = interactive && !loading && !failed;
    controls.addEventListener('change', syncCameraFromControls);
    controls.addEventListener('start', wake);
  }
  function setView(degrees, distanceScale = 1) {
    requireNumber(degrees, 'view angle');
    if (!current || disposed) return;
    applySourceCamera(camera, current.metadata.camera, current.metadata.controlsTarget, degrees);
    if (distanceScale !== 1) {
      const target = new THREE.Vector3().fromArray(current.metadata.controlsTarget);
      camera.position.sub(target).multiplyScalar(distanceScale).add(target);
      camera.matrix.setPosition(camera.position);
      camera.matrixWorldNeedsUpdate = true;
      camera.updateMatrixWorld(true);
    }
    installControls(camera.position);
    host.dataset.sourceView = distanceScale === 1 ? String(degrees) : 'overview';
    host.dataset.cameraDistanceScale = String(distanceScale);
    invalidateCamera();
    onCameraChange(camera.matrixWorld.toArray());
  }
  function setCameraMatrix(matrix) {
    if (!current || loading || disposed) return;
    camera.matrix.fromArray(matrix);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.matrixWorldNeedsUpdate = true;
    camera.updateMatrixWorld(true);
    installControls(camera.position);
    host.dataset.sourceView = 'synchronized';
    invalidateCamera();
  }
  function reset() { setView(0); }
  function resize() {
    const side = Math.floor(Math.min(host.clientWidth, host.clientHeight));
    drawable = side > 0;
    if (!drawable) { stop(); return; }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== side || size.y !== side || renderer.getPixelRatio() !== ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(side, side, false);
      needsRender = true;
      sampleCounts = { min: 0, max: 0, avg: 0 };
      tracer.reset();
    }
    wake();
  }
  function disposeCase(value) {
    if (!value) return;
    disposeRoots(value.roots, value.originals, sharedMaterials);
    value.environment.dispose();
    value.originals.clear();
    value.scene.clear();
  }

  // ---- Relighting environments -------------------------------------------------
  // The default environment is always the inherited Blender world + area lights.
  // Alternative HDRIs replace the world and hide the source lights so the HDRI is
  // the only illumination; switching back restores the exact source setup.
  const environmentLibrary = new Map();
  let activeEnvironmentId = 'source';
  let environmentRevision = 0;

  function sourceLightObjects() {
    return current ? current.scene.children.filter((object) => object.userData.source) : [];
  }

  function applyEnvironmentToScene() {
    if (!current) return;
    const entry = activeEnvironmentId === 'source' ? null : environmentLibrary.get(activeEnvironmentId);
    const scene = current.scene;
    if (entry) {
      scene.environment = entry.texture;
      scene.background = entry.texture;
      scene.environmentIntensity = entry.intensity;
      scene.backgroundIntensity = entry.intensity;
      scene.backgroundBlurriness = 0;
      scene.environmentRotation.set(0, entry.rotation, 0);
      scene.backgroundRotation.set(0, entry.rotation, 0);
      for (const light of sourceLightObjects()) light.visible = false;
    } else {
      scene.environment = current.environment;
      scene.background = current.metadata.world.transparent ? null : current.environment;
      scene.environmentIntensity = 1;
      scene.backgroundIntensity = 1;
      scene.backgroundBlurriness = 0;
      scene.environmentRotation.set(0, 0, 0);
      scene.backgroundRotation.set(0, 0, 0);
      for (const light of sourceLightObjects()) light.visible = true;
    }
    host.dataset.environment = activeEnvironmentId;
    onEnvironmentChange(activeEnvironmentId);
  }

  function refreshEnvironmentRender() {
    if (!current || loading || failed || disposed) return;
    sampleCounts = { min: 0, max: 0, avg: 0 };
    needsRender = true;
    if (effectiveMode() === 'raster') {
      const revision = ++modeRevision;
      rasterReady = false;
      state('loading', 'Recompiling raster preview lighting…', 92);
      renderer.compileAsync(current.scene, camera).then(() => {
        if (disposed || revision !== modeRevision || loading) return;
        rasterReady = true; wake();
      }).catch(fail);
    } else if (tracerScene === current.scene) {
      tracer.updateEnvironment();
      tracer.updateLights();
    }
    info(); wake();
  }

  async function setEnvironment(id) {
    if (disposed || failed) throw new Error('Viewer is not running.');
    if (id !== 'source' && !environmentLibrary.has(id)) throw new Error(`Unknown environment: ${id}. Register it first.`);
    if (id === activeEnvironmentId) return activeEnvironmentId;
    const revision = ++environmentRevision;
    activeEnvironmentId = id;
    if (current) {
      applyEnvironmentToScene();
      await renderer.settle();
      if (disposed || revision !== environmentRevision) return activeEnvironmentId;
      refreshEnvironmentRender();
    }
    return activeEnvironmentId;
  }

  async function registerEnvironment({ id, url, name = id, intensity = 1, rotation = 0 }) {
    if (!id || typeof id !== 'string' || id === 'source') throw new Error('Environment id must be a non-empty string other than "source".');
    requireNumber(intensity, `${id}.intensity`, Number.EPSILON);
    requireNumber(rotation, `${id}.rotation`);
    const address = new URL(url, document.baseURI);
    if (!['http:', 'https:'].includes(address.protocol) || address.origin !== location.origin) throw new Error('Environment HDRIs must be served from this local site.');
    if (environmentLibrary.has(id)) {
      const entry = environmentLibrary.get(id);
      entry.intensity = intensity; entry.rotation = rotation; entry.name = name;
      if (id === activeEnvironmentId && current) { applyEnvironmentToScene(); refreshEnvironmentRender(); }
      return id;
    }
    const response = await fetch(address, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HDRI request failed (${response.status}): ${address.pathname}`);
    const buffer = await response.arrayBuffer();
    const parsed = new HDRLoader().setDataType(THREE.FloatType).parse(buffer);
    if (!parsed?.data) throw new Error(`HDRI decode failed: ${address.pathname}`);
    const maxSize = renderer.backend.device.limits.maxTextureDimension2D;
    if (Math.max(parsed.width, parsed.height) > maxSize) throw new Error(`HDRI ${id} exceeds this GPU's texture-size limit.`);
    const fullFloat = renderer.backend.device.features.has('float32-filterable');
    let data = parsed.data;
    let peak = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i] > peak) peak = data[i]; if (data[i + 1] > peak) peak = data[i + 1]; if (data[i + 2] > peak) peak = data[i + 2]; }
    if (!Number.isFinite(peak)) throw new Error(`HDRI ${id} contains non-finite radiance.`);
    if (!fullFloat) {
      if (peak > 65504) throw new Error(`HDRI ${id} exceeds this GPU's filterable HDR range.`);
      data = Uint16Array.from(data, (value) => THREE.DataUtils.toHalfFloat(value));
    }
    const texture = new THREE.DataTexture(data, parsed.width, parsed.height, THREE.RGBAFormat, fullFloat ? THREE.FloatType : THREE.HalfFloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false; texture.flipY = true; texture.needsUpdate = true;
    environmentLibrary.set(id, { id, name, texture, intensity, rotation, url: address.href });
    return id;
  }

  function setEnvironmentIntensity(value) {
    requireNumber(value, 'environment intensity', 0);
    const entry = environmentLibrary.get(activeEnvironmentId);
    if (!entry) throw new Error('The source environment keeps its inherited intensity; select an HDRI first.');
    entry.intensity = value;
    if (current) { applyEnvironmentToScene(); refreshEnvironmentRender(); }
  }

  function setEnvironmentRotation(degrees) {
    requireNumber(degrees, 'environment rotation');
    const entry = environmentLibrary.get(activeEnvironmentId);
    if (!entry) throw new Error('The source environment keeps its inherited orientation; select an HDRI first.');
    entry.rotation = THREE.MathUtils.degToRad(degrees);
    if (current) { applyEnvironmentToScene(); refreshEnvironmentRender(); }
  }
  function applyMaterial() {
    if (!current) return;
    for (const [mesh, original] of current.originals) {
      const replacement = materialMode === 'wireframe' ? wireframe : materialMode === 'gray' ? gray : null;
      mesh.material = replacement ? (Array.isArray(original) ? original.map(() => replacement) : replacement) : original;
    }
    host.dataset.material = materialMode;
  }
  function syncRasterCamera() {
    // Source scenes use extremely small near planes with distant telephoto
    // cameras. Fit raster depth to the asset, preserving the framing and the
    // source/PT clipping planes, so nearby face surfaces no longer z-fight.
    rasterCamera.copy(camera);
    const bounds = current.bounds;
    const center = bounds.center.clone().applyMatrix4(camera.matrixWorldInverse);
    const margin = Math.max(bounds.radius * 1.25, 0.01);
    const near = Math.max(camera.near, -center.z - margin);
    const far = Math.max(near + 0.01, -center.z + margin);
    rasterCamera.near = near; rasterCamera.far = far;
    const e = rasterCamera.projectionMatrix.elements;
    e[10] = far / (near - far);
    e[14] = far * near / (near - far);
    rasterCamera.projectionMatrixInverse.copy(rasterCamera.projectionMatrix).invert();
    host.dataset.rasterClip = `${near.toFixed(4)}–${far.toFixed(4)}`;
    return rasterCamera;
  }
  function prepareMode() {
    if (!current || loading || failed || disposed) return;
    const revision = ++modeRevision;
    needsRender = true;
    sampleCounts = { min: 0, max: 0, avg: 0 };
    if (effectiveMode() === 'raster') {
      rasterReady = false;
      state('loading', 'Compiling explicit WebGPU raster preview…', 90);
      renderer.compileAsync(current.scene, syncRasterCamera()).then(() => {
        if (disposed || revision !== modeRevision || loading) return;
        rasterReady = true; wake();
      }).catch(fail);
    } else {
      try {
        // Switching gray/full changes atlas and material-buffer capacities.
        // updateMaterials alone retains shader bindings sized for the old layout.
        if (tracerScene !== current.scene || tracerMaterialMode !== materialMode) {
          tracer.setScene(current.scene, camera);
          tracerScene = current.scene;
          tracerMaterialMode = materialMode;
        }
        else { tracer.updateMaterials(); tracer.updateCamera(); }
      } catch (error) { fail(error); return; }
      lastStage = 'compiling';
      state('loading', 'Compiling WebGPU path tracer…', 90);
    }
    info(); wake();
  }
  function setMaterial(mode) {
    if (!['full', 'gray', 'geometry', 'wireframe'].includes(mode)) throw new Error(`Unknown material mode: ${mode}`);
    materialMode = mode === 'geometry' ? 'gray' : mode;
    applyMaterial(); prepareMode(); info();
  }
  function setRenderMode(mode) {
    if (!['raster', 'pathtraced', 'pathtracing', 'pt', 'progressive'].includes(mode)) throw new Error(`Unknown render mode: ${mode}`);
    requestedRenderMode = mode === 'raster' ? 'raster' : 'pathtraced';
    prepareMode(); info();
  }
  function setAutoRotate(value) {
    autoRotate = Boolean(value);
    if (controls) controls.autoRotate = autoRotate;
    needsRender = true; wake();
  }

  tracer.addEventListener('progress', (event) => {
    if (disposed || loading || failed || !current || effectiveMode() !== 'pathtraced') return;
    lastStage = event.stage;
    if (event.samples) sampleCounts = event.samples;
    if (event.stage === 'compiling' || event.stage === 'building') {
      state('loading', `WebGPU path tracer: ${event.stage}…`, 80 + (event.progress || 0) * 19);
    } else if (event.samples?.avg > 0) {
      state('loaded', `WebGPU path tracing · ${event.samples.avg.toFixed(1)}/${MAX_SAMPLES} samples per pixel`, 100);
    }
    info();
  });
  tracer.addEventListener('complete', () => {
    if (disposed || loading || effectiveMode() !== 'pathtraced') return;
    lastStage = 'sample limit reached'; info();
  });

  function renderFrame(time) {
    frame = 0;
    if (disposed || failed || loading || !drawable || !visible || document.hidden || !current) { lastTime = 0; return; }
    try {
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      const changed = interactive ? controls.update(delta) : false;
      if (time - lastPipelineCheck > 250) { renderer.checkPipelines(); lastPipelineCheck = time; }
      if (effectiveMode() === 'raster') {
        if (rasterReady && (needsRender || changed || autoRotate)) {
          renderer.render(current.scene, syncRasterCamera());
          needsRender = false;
          lastStage = 'raster preview';
          state('loaded', materialMode === 'wireframe' ? 'Actual mesh triangles · WebGPU raster (not path traced)' : 'WebGPU raster preview (not path traced)', 100);
          info();
        }
        if (changed || autoRotate || !rasterReady) wake();
      } else if (needsRender || changed || autoRotate || !tracer.complete) {
        tracer.renderSample();
        if (pendingPTCamera && sampleCounts.avg >= 2) {
          pendingPTCamera = false;
          sampleCounts = { min: 0, max: 0, avg: 0 };
          tracer.updateCamera();
        }
        needsRender = false;
        wake();
      }
    } catch (error) { fail(error); }
  }

  function buildCase(gltf, metadata, url) {
    const notes = new Set((metadata.notes || []).map((note) => typeof note === 'string' ? note : JSON.stringify(note)));
    const scene = new THREE.Scene();
    const originals = new Map();
    const sourceMaterials = new Map(metadata.materials.map((material) => [material.name, material]));
    const matched = new Set();
    const textures = new Set();
    gltf.scene.traverse((object) => {
      if (object.isLight) object.visible = false;
      if (!object.isMesh) return;
      originals.set(object, object.material);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        const source = sourceMaterials.get(material.name);
        if (!source) { notes.add(`No source metadata for material ${material.name || '(unnamed)'}`); continue; }
        matched.add(source.name);
        if (source.baseColorMultiplier) {
          const multiplier = requireVector(source.baseColorMultiplier, 3, `${source.name}.baseColorMultiplier`);
          material.color.multiply(new THREE.Color().fromArray(multiplier));
        }
        if (source.ior != null) material.ior = requireNumber(source.ior, `${source.name}.ior`, 1);
        material.scatterStrength = 0;
        if (source.sss?.weight > 0) notes.add(`${source.name}: nonzero Blender SSS not converted; disabled (no validated mean-free-path conversion)`);
        if (source.clearcoatIor != null && Math.abs(source.clearcoatIor - 1.5) > 1e-5 && material.clearcoat > 0) notes.add(`${source.name}: coat IOR ${source.clearcoatIor} → fixed 1.5 in glTF path tracer`);
      }
    });
    if (!originals.size) throw new Error('The source glTF contains no renderable meshes.');
    for (const material of metadata.materials) if (!matched.has(material.name)) notes.add(`Source material not found in glTF: ${material.name}`);
    for (const texture of textures) if (Math.max(texture.width, texture.height) > renderer.backend.device.limits.maxTextureDimension2D) {
      throw new Error(`${texture.name || 'Source texture'} exceeds this GPU's texture-size limit; refusing to silently downsample.`);
    }
    for (const source of metadata.lights) scene.add(createSourceLight(source, notes, ViewerAreaLight));
    const hdr = metadata.world.color.map((value) => value * metadata.world.strength);
    if (!hdr.every(Number.isFinite)) throw new Error('Non-finite source world radiance.');
    const fullFloat = renderer.backend.device.features.has('float32-filterable');
    if (!fullFloat && Math.max(...hdr) > 65504) throw new Error('Source world radiance exceeds this GPU’s filterable HDR range.');
    const pixels = fullFloat ? new Float32Array(16 * 8 * 4) : new Uint16Array(16 * 8 * 4);
    const rgba = [...hdr, 1].map((value) => fullFloat ? value : THREE.DataUtils.toHalfFloat(value));
    for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
    const environment = new THREE.DataTexture(pixels, 16, 8, THREE.RGBAFormat, fullFloat ? THREE.FloatType : THREE.HalfFloatType);
    environment.mapping = THREE.EquirectangularReflectionMapping;
    environment.colorSpace = THREE.LinearSRGBColorSpace;
    environment.minFilter = THREE.LinearFilter; environment.magFilter = THREE.LinearFilter;
    environment.generateMipmaps = false; environment.needsUpdate = true;
    scene.environment = environment;
    scene.background = metadata.world.transparent ? null : environment;
    scene.environmentIntensity = 1; scene.backgroundIntensity = 1;
    if (!fullFloat) notes.add('World radiance stored at float16 precision on this GPU');
    const color = metadata.colorManagement;
    const standard = String(color.viewTransform).toLowerCase() === 'standard';
    const noLook = ['none', ''].includes(String(color.look ?? '').toLowerCase());
    if (!standard || !noLook || color.gamma !== 1) notes.add(`Source color management ${color.viewTransform}/${color.look}/gamma ${color.gamma} unsupported; preview uses Standard/None/gamma 1`);
    if (metadata.camera.aspect !== 1) notes.add('Source camera aspect is not square; source projection retained');
    notes.add('glTF BSDF is not Cycles; no image-match claim');
    scene.add(gltf.scene);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());
    return { scene, environment, originals, roots: gltf.scenes || [gltf.scene], metadata, notes, bounds, url };
  }

  async function load(url, metadataFile = 'scene.json') {
    if (disposed) throw new Error('Viewer has been disposed.');
    if (failed) throw new Error('Renderer failed; reload the page before loading another case.');
    const id = ++requestId;
    request?.controller.abort();
    const controller = new AbortController();
    const manager = new THREE.LoadingManager();
    request = { id, controller, manager };
    const objectURLs = new Set();
    let gltf;
    let candidate;
    let adopted = false;
    let dependencyError;
    const active = () => !disposed && id === requestId && !controller.signal.aborted;
    loading = true; ++modeRevision; stop();
    if (controls) controls.enabled = false;
    state('loading', 'Loading source glTF and scene.json…', 0); info();
    try {
      const modelURL = new URL(url, document.baseURI);
      if (!['http:', 'https:'].includes(modelURL.protocol) || modelURL.origin !== location.origin) throw new Error('Source assets must be served from this local site, not a CDN.');
      const baseURL = new URL('.', modelURL);
      const fetchAsset = async (address) => {
        const response = await fetch(address, { signal: controller.signal });
        if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${new URL(address).pathname}`);
        return response;
      };
      const [modelData, metadata] = await Promise.all([
        fetchAsset(modelURL).then((response) => response.arrayBuffer()),
        fetchAsset(new URL(metadataFile, baseURL)).then((response) => response.json())
      ]);
      if (!active()) return;
      const binary=new DataView(modelData);
      const isGLB=modelData.byteLength>=20&&binary.getUint32(0,true)===0x46546c67;
      if (isGLB&&(binary.getUint32(4,true)!==2||binary.getUint32(8,true)!==modelData.byteLength||binary.getUint32(16,true)!==0x4e4f534a)) throw new Error('Invalid GLB header.');
      const manifest=JSON.parse(new TextDecoder().decode(isGLB?new Uint8Array(modelData,20,binary.getUint32(12,true)):new Uint8Array(modelData)));
      validateMetadata(metadata);
      const dependencies = [...new Set([...(manifest.buffers || []), ...(manifest.images || [])].filter((entry) => entry.uri && !entry.uri.startsWith('data:')).map((entry) => new URL(entry.uri, baseURL).href))];
      if (dependencies.some((address) => new URL(address).origin !== modelURL.origin || !['http:', 'https:'].includes(new URL(address).protocol))) throw new Error('glTF dependencies must be local site assets.');
      const blobs = new Map();
      let next = 0; let done = 0;
      const downloads = await Promise.allSettled(Array.from({ length: Math.min(4, dependencies.length) }, async () => {
        while (next < dependencies.length && active()) {
          const address = dependencies[next++];
          const blob = await fetchAsset(address).then((response) => response.blob());
          if (!active()) return;
          const objectURL = URL.createObjectURL(blob);
          objectURLs.add(objectURL); blobs.set(address, objectURL);
          done++;
          state('loading', `Loading source buffers and textures · ${done}/${dependencies.length}`, 10 + done / dependencies.length * 60);
        }
      }));
      if (!active()) return;
      const rejected = downloads.find((result) => result.status === 'rejected');
      if (rejected) throw rejected.reason;
      manager.setURLModifier((address) => {
        if (address.startsWith('data:') || address.startsWith('blob:')) return address;
        const resolved = new URL(address, baseURL).href;
        if (!blobs.has(resolved)) throw new Error(`Undeclared glTF dependency: ${resolved}`);
        return blobs.get(resolved);
      });
      manager.onError = (address) => { dependencyError = new Error(`A source texture/buffer failed to decode: ${address}`); };
      state('loading', 'Decoding original-resolution source textures…', 72);
      gltf = await new GLTFLoader(manager).parseAsync(isGLB?modelData:JSON.stringify(manifest), baseURL.href);
      if (!active()) return;
      if (dependencyError) throw dependencyError;
      candidate = buildCase(gltf, metadata, modelURL.href);
      await renderer.settle();
      if (!active()) return;
      renderer.checkPipelines();
      const previous = current;
      current = candidate;
      adopted = true;
      sourceWorld.copy(sourceMatrix(metadata.camera.matrixWorld, 'camera.matrixWorld'));
      const position = new THREE.Vector3().setFromMatrixPosition(sourceWorld);
      const target = new THREE.Vector3().fromArray(metadata.controlsTarget);
      if (position.distanceToSquared(target) < 1e-14) throw new Error('Source camera and controls target coincide.');
      orbitHomeInverse.lookAt(position, target, WORLD_UP).setPosition(position).invert();
      renderer.toneMapping = metadata.colorManagement.exposure === 0 ? THREE.NoToneMapping : THREE.LinearToneMapping;
      renderer.toneMappingExposure = Math.pow(2, metadata.colorManagement.exposure);
      setView(0, 1.35); applyMaterial(); applyEnvironmentToScene();
      state('loading', requestedRenderMode === 'raster' ? 'Preparing real-time source materials…' : 'Building source-scene BVHs and texture atlas…', 80);
      try {
        if (requestedRenderMode !== 'raster') {
          tracer.setScene(current.scene, camera);
          tracerScene = current.scene;
          tracerMaterialMode = materialMode;
        }
      } finally { disposeCase(previous); }
      loading = false;
      controls.enabled = interactive;
      host.dataset.model = modelURL.href;
      host.dataset.meshes = String(current.originals.size);
      resize(); prepareMode();
      return getReport();
    } catch (error) {
      if (id !== requestId || disposed || error.name === 'AbortError') return;
      controller.abort(); manager.abort();
      loading = false;
      if (adopted) fail(error);
      else {
        state('error', `Source asset could not load: ${error.message}`, 0);
        lastStage = 'source load failed'; info();
        if (controls) controls.enabled = interactive;
      }
      throw error;
    } finally {
      for (const objectURL of objectURLs) URL.revokeObjectURL(objectURL);
      if (!adopted) {
        if (candidate) disposeCase(candidate);
        else if (gltf) disposeRoots(gltf.scenes || [gltf.scene]);
      }
      if (request?.id === id) request = null;
    }
  }

  function getReport() {
    return {
      backend: 'WebGPU', mode: effectiveMode(), requestedRenderMode, material: materialMode,
      maxSamples: MAX_SAMPLES, maxBounces: MAX_BOUNCES, samples: { ...sampleCounts },
      sourceURL: current?.url || null, notes: current ? [...current.notes] : [],
      environment: activeEnvironmentId === 'source'
        ? { id: 'source', origin: 'inherited Blender world + area lights' }
        : (() => { const entry = environmentLibrary.get(activeEnvironmentId); return { id: entry.id, name: entry.name, url: entry.url, intensity: entry.intensity, rotationDegrees: THREE.MathUtils.radToDeg(entry.rotation), sourceLightsHidden: true }; })(),
      camera: { matrixWorld: camera.matrixWorld.toArray(), projectionMatrix: camera.projectionMatrix.toArray(), fovYDegrees: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far },
      lights: current ? current.scene.children.filter((object) => object.isLight).map((light) => ({ name: light.name, matrixWorld: light.matrixWorld.toArray(), width: light.width, height: light.height, ...light.userData.source })) : [],
      lightConversion: 'Cycles area_light_eval: radiance = powerW / (PI * worldArea) when normalized, otherwise powerW / PI; full-spread Lambertian emission.',
      imageMatchVerified: false
    };
  }
  function keydown(event) {
    if (!interactive || !current || loading || failed || event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    if (event.key === 'Home') { event.preventDefault(); reset(); return; }
    const offset = orbitCamera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const step = event.shiftKey ? 0.15 : 0.06;
    const actions = {
      ArrowLeft: () => { spherical.theta -= step; }, ArrowRight: () => { spherical.theta += step; },
      ArrowUp: () => { spherical.phi -= step; }, ArrowDown: () => { spherical.phi += step; },
      '+': () => { spherical.radius *= 0.9; }, '=': () => { spherical.radius *= 0.9; }, '-': () => { spherical.radius *= 1.1; }
    };
    if (!actions[event.key]) return;
    event.preventDefault(); actions[event.key]();
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle + 1e-6, controls.maxPolarAngle - 1e-6);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    orbitCamera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    controls.update();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) wake(); else stop();
    info();
  });
  visibilityObserver.observe(host);
  function visibilityChanged() { if (document.hidden) stop(); else wake(); info(); }
  document.addEventListener('visibilitychange', visibilityChanged);
  host.addEventListener('keydown', keydown);
  async function dispose() {
    if (disposed) return;
    disposed = true; ++requestId; ++modeRevision; stop();
    request?.controller.abort();
    resizeObserver.disconnect(); visibilityObserver.disconnect(); controls?.dispose();
    document.removeEventListener('visibilitychange', visibilityChanged);
    host.removeEventListener('keydown', keydown);
    await renderer.settle().catch(() => undefined);
    tracer.dispose();
    tracer.material.turquinTexture?.dispose();
    disposeCase(current); current = null;
    for (const entry of environmentLibrary.values()) entry.texture.dispose();
    environmentLibrary.clear();
    for (const value of Object.values(ltcTextures || {})) if (value?.isTexture) value.dispose();
    gray.dispose(); wireframe.dispose(); renderer.dispose(); canvas.remove();
  }
  resize(); info();
  return { load, setMaterial, setView, setCameraMatrix, reset, setAutoRotate, setRenderMode, registerEnvironment, setEnvironment, setEnvironmentIntensity, setEnvironmentRotation, getReport, dispose };
}
