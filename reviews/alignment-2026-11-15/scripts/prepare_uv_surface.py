"""Depth-rasterize native UVs, then derive varying-U contours in the source camera."""
import os
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'blender-match/assets/showcase/cases/Aerith_01'
DATA = ROOT/'_build/showcase-qa/aerith-uv-surface.npz'

def build(output=OUT, source=DATA):
    output = Path(output)
    data = np.load(source)
    n = 1024
    depth = np.full((n,n), np.inf)
    field = np.full((n,n), np.nan)
    projection, triangles, uv = data['projection'], data['triangles'], data['uv']
    head_triangles = len(triangles)
    if 'eye_projection' not in data or not len(data['eye_projection']):
        raise ValueError('Re-export projection with eye occlusion geometry first')
    eye_triangles = data['eye_triangles'] + len(projection)
    projection = np.concatenate([projection, data['eye_projection']])
    triangles = np.concatenate([triangles, eye_triangles])
    uv = np.concatenate([uv, np.zeros((len(eye_triangles),3,2))])
    visible_eyes = np.zeros((n,n), dtype=bool)
    perspective = bool(data['perspective']) if 'perspective' in data else True
    for triangle_index, (ids, coords) in enumerate(zip(triangles, uv)):
        tri = projection[ids].copy()
        if not perspective:
            tri[:,2] = 1
        if (tri[:,2] <= 0).any():
            continue
        xy = tri[:,:2]*n
        lo = np.maximum(0, np.ceil(xy.min(0)-.5).astype(int))
        hi = np.minimum(n-1, np.floor(xy.max(0)-.5).astype(int))
        if (lo > hi).any():
            continue
        a,b,c = xy
        denominator = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
        if abs(denominator) < 1e-10:
            continue
        yy,xx = np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1] + .5
        w0 = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/denominator
        w1 = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/denominator
        w2 = 1-w0-w1
        inverse_z = w0/tri[0,2]+w1/tri[1,2]+w2/tri[2,2]
        z = 1/np.maximum(inverse_z, 1e-12)
        slices = np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        take = (w0>=-1e-8)&(w1>=-1e-8)&(w2>=-1e-8)&(z<depth[slices])
        interpolated = (w0*coords[0,0]/tri[0,2]+w1*coords[1,0]/tri[1,2]+w2*coords[2,0]/tri[2,2])/inverse_z
        depth[slices][take] = z[take]
        is_eye = triangle_index >= head_triangles
        field[slices][take] = np.nan if is_eye else interpolated[take]
        visible_eyes[slices][take] = is_eye
    mask = np.isfinite(field)
    if not mask.any():
        raise ValueError('No visible native UV pixels')
    # Fill only the background and eye openings; visible native head UVs stay exact.
    completed = field.copy()
    xs = np.arange(n)
    valid_rows = np.flatnonzero(mask.any(axis=1))
    for y in valid_rows:
        known = np.flatnonzero(mask[y])
        completed[y] = np.interp(xs, np.concatenate(([-1],known,[n])), np.concatenate(([0],field[y,known],[1])))
    for y in np.flatnonzero(~mask.any(axis=1)):
        completed[y] = completed[valid_rows[np.argmin(abs(valid_rows-y))]]
    assert np.array_equal(completed[mask], field[mask])
    encoded = np.rint(np.clip(completed,0,1)*65535).astype('<u2')
    (output/'uv-surface.bin').write_bytes(encoded.tobytes())
    metadata = {'version':2,'width':n,'height':n,'encoding':'uint16-little-endian','file':'uv-surface.bin',
        'coordinateSystem':'normalized_image_top_left','method':'Native mesh UV, perspective-correct barycentric interpolation, nearest-depth rasterization',
        'background':'Linear extension toward image borders; eye openings interpolated; rows outside head use nearest covered row.',
        'source':'Final registered scene / original head UV with eye depth occlusion','visibleHeadPixels':int(mask.sum()),
        'eyeOcclusionPixels':int(visible_eyes.sum()),'eyeHandling':'Visible eyeballs occlude the head interior; interpolate native U across each opening from the eyelid boundary.',
        'interaction':'Mask native U >= slider threshold; U=0.5 is midline. No screen-space translation.'}
    (output/'uv-surface.json').write_text(json.dumps(metadata,indent=2),encoding='utf8')
    if os.environ.get('SHOWCASE_UV_QA') == '1':
        np.savez_compressed(output/'uv-qa.npz', native=field, completed=completed, eyes=visible_eyes, head=mask)

if __name__=='__main__':
    build()
