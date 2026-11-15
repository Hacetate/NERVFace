// Float32 regression for the archived telephoto cameras: avoid cancellation in
// world-space unprojection while preserving shifted frusta and clipping planes.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { Matrix4, Vector3, Vector4, WebGPUCoordinateSystem } from 'three';

const root = new URL('../assets/showcase/cases/', import.meta.url);
const f = Math.fround;
function mul32(matrix, vector) {
  return [0, 1, 2, 3].map(row => {
    let sum = 0;
    for (let col = 0; col < 4; col++) sum = f(sum + f(f(matrix.elements[col * 4 + row]) * f(vector[col])));
    return sum;
  });
}
function dehom(v) { return v.slice(0, 3).map(x => f(x / v[3])); }
let worstStable = 0, worstLegacy = 0, count = 0;
for (const dir of await readdir(root)) {
  const { camera: c } = JSON.parse(await readFile(new URL(`${dir}/viewer-scene.json`, root), 'utf8'));
  const p = c.frustum;
  const projection = new Matrix4().makePerspective(p.left*c.near,p.right*c.near,p.top*c.near,p.bottom*c.near,c.near,c.far,WebGPUCoordinateSystem);
  const inverse = projection.clone().invert(), world = new Matrix4().fromArray(c.matrixWorld);
  const combined = new Matrix4().multiplyMatrices(world, inverse);
  const pixelAngle = (p.right - p.left) / 1024;
  for (const x of [-0.9, -0.13, 0, 0.37, 0.9]) for (const y of [-0.8, 0.21, 0.8]) {
    const localH = new Vector4(x,y,0,1).applyMatrix4(inverse);
    const local = new Vector3(localH.x/localH.w,localH.y/localH.w,localH.z/localH.w);
    const reference = local.clone().transformDirection(world);
    const offset = mul32(world, [...dehom(mul32(inverse,[x,y,0,1])),0]).slice(0,3);
    const stable = new Vector3(...offset).normalize();
    const near = dehom(mul32(combined,[x,y,0,1]));
    const far = dehom(mul32(combined,[x,y,1,1]));
    const legacy = new Vector3(...far.map((v,i)=>f(v-near[i]))).normalize();
    worstStable = Math.max(worstStable,stable.distanceTo(reference)/pixelAngle);
    worstLegacy = Math.max(worstLegacy,legacy.distanceTo(reference)/pixelAngle);
    const nearWorld = new Vector3(...offset).add(new Vector3().setFromMatrixPosition(world));
    const expectedNear = local.clone().applyMatrix4(world);
    assert(nearWorld.distanceTo(expectedNear) < 1e-6, `${dir}: near clipping changed`);
    assert(Math.abs(new Vector3(...offset).length()*(c.far/c.near-1)-local.length()*(c.far/c.near-1)) < 0.001, `${dir}: far clipping changed`);
  }
  count++;
}
assert.equal(count,61);
assert(worstStable < 0.02, `ray error ${worstStable} pixels`);
assert(worstLegacy > 1, 'fixture must reproduce the legacy precision defect');
console.log(JSON.stringify({cases:count,stableMaxErrorPixels:worstStable,legacyMaxErrorPixels:worstLegacy}));
