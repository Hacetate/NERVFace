import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export async function createShowcaseViewer(host, root) {
  const response = await fetch(`${root}/scene.json`);
  if (!response.ok) throw new Error('Scene parameters could not load.');
  const meta = await response.json();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  const gray = new THREE.MeshStandardMaterial({ color: 0x9d9e9c, roughness: 0.8, side: THREE.DoubleSide });
  let model, frame = 0, active = true;
  const originals = new Map();
  const target = new THREE.Vector3().fromArray(meta.controlsTarget);
  function reset() {
    new THREE.Matrix4().fromArray(meta.camera.matrixWorld).decompose(camera.position, camera.quaternion, camera.scale);
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    controls.target.copy(target);
    const d = camera.position.distanceTo(target);
    controls.minDistance = d * 0.25; controls.maxDistance = d * 2;
    controls.update();
    // Restore the exact registered orientation after OrbitControls' lookAt.
    new THREE.Matrix4().fromArray(meta.camera.matrixWorld).decompose(camera.position, camera.quaternion, camera.scale);
    const f = meta.camera.frustum;
    camera.near = meta.camera.near; camera.far = meta.camera.far;
    camera.projectionMatrix.makePerspective(f.left*camera.near, f.right*camera.near, f.top*camera.near, f.bottom*camera.near, camera.near, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  RectAreaLightUniformsLib.init();
  const sourceLights = new THREE.Group();
  const world = new THREE.AmbientLight(new THREE.Color().fromArray(meta.world.color), meta.world.strength);
  sourceLights.add(world);
  for (const l of meta.lights) {
    if (l.type !== 'AREA') continue;
    const height = ['DISK', 'SQUARE'].includes(l.shape) ? l.size : l.sizeY;
    const area = l.size * height * (['DISK','ELLIPSE'].includes(l.shape) ? Math.PI/4 : 1);
    const light = new THREE.RectAreaLight(new THREE.Color().fromArray(l.color), l.powerW/(Math.PI*(l.normalize ? area : 1)), l.size, height);
    new THREE.Matrix4().fromArray(l.matrixWorld).decompose(light.position, light.quaternion, light.scale);
    sourceLights.add(light);
  }
  scene.add(sourceLights);
  const studio = new THREE.Group();
  studio.add(new THREE.HemisphereLight(0xffffff, 0x76777b, 1.5));
  const key = new THREE.DirectionalLight(0xfff3e6, 2.4);
  key.position.copy(target).add(new THREE.Vector3(-3, 4, 6));
  key.target.position.copy(target); studio.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xe2edff, 1);
  fill.position.copy(target).add(new THREE.Vector3(3, 1, 4));
  fill.target.position.copy(target); studio.add(fill, fill.target);
  studio.visible = false; scene.add(studio);
  function resize() {
    const size = Math.max(1, Math.min(host.clientWidth, host.clientHeight));
    renderer.setSize(size, size);
  }
  const observer = new ResizeObserver(resize);
  function tick() {
    if (!active) return;
    frame = requestAnimationFrame(tick);
    if (document.hidden) return;
    if (controls.autoRotate) controls.update(1/60);
    renderer.render(scene, camera);
  }
  function dispose() {
    active=false; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
    const materials = new Set(originals.values()), textures = new Set();
    model?.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of materials) { for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); m.dispose(); }
    for (const t of textures) { t.source?.data?.close?.(); t.dispose(); }
    gray.dispose(); renderer.dispose(); renderer.domElement.remove();
  }
  try {
    const gltf = await new GLTFLoader().loadAsync(`${root}/model.glb`);
    model = gltf.scene;
    model.traverse(o => { if (o.isMesh) { originals.set(o,o.material); o.frustumCulled=false; } });
    scene.add(model); host.append(renderer.domElement);
    controls.enableDamping = false;
    // Target the camera's optical axis to preserve the registered roll and direction.
    const camMatrix = new THREE.Matrix4().fromArray(meta.camera.matrixWorld);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camMatrix);
    target.copy(camPos).add(new THREE.Vector3(0,0,-1).transformDirection(camMatrix).multiplyScalar(camPos.distanceTo(new THREE.Vector3().fromArray(meta.controlsTarget))));
    reset(); resize(); observer.observe(host); tick();
  } catch (error) { dispose(); throw error; }
  return {
    reset, dispose,
    setActive(value) { active=value; cancelAnimationFrame(frame); if (active) { resize(); tick(); } },
    setMaterial(mode) { model.traverse(o=>{ if(o.isMesh) o.material=mode==='mesh'?gray:originals.get(o); }); },
    setLighting(mode) { sourceLights.visible=mode==='source'; studio.visible=mode==='studio'; },
    setRotate(value) { controls.autoRotate=value; },
  };
}
