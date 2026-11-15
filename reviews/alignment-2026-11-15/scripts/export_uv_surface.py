"""Export the actual registered head's camera projection and per-corner native UVs."""
import os
import bpy
import numpy as np
from pathlib import Path
from bpy_extras.object_utils import world_to_camera_view

root = Path(__file__).resolve().parents[1]
out = root / '_build/showcase-qa'
out.mkdir(parents=True, exist_ok=True)
s = bpy.context.scene
head = max((o for o in s.objects if o.type == 'MESH' and not o.hide_render and o.data.uv_layers.active), key=lambda o: len(o.data.vertices))
mesh = head.data
mesh.calc_loop_triangles()
projection = []
for vertex in mesh.vertices:
    p = world_to_camera_view(s, s.camera, head.matrix_world @ vertex.co)
    projection.append([p.x, 1 - p.y, p.z])
triangles = np.asarray([t.vertices[:] for t in mesh.loop_triangles])
uv = np.asarray([[mesh.uv_layers.active.data[i].uv[:] for i in t.loops] for t in mesh.loop_triangles])
eye_projection, eye_triangles = [], []
for eye in s.objects:
    if eye.type != 'MESH' or eye.hide_render or 'eye' not in eye.name.lower():
        continue
    offset = len(eye_projection)
    eye.data.calc_loop_triangles()
    for vertex in eye.data.vertices:
        p = world_to_camera_view(s, s.camera, eye.matrix_world @ vertex.co)
        eye_projection.append([p.x, 1-p.y, p.z])
    eye_triangles.extend([[i+offset for i in t.vertices] for t in eye.data.loop_triangles])
np.savez(os.environ.get('SHOWCASE_UV_DATA', str(out/'aerith-uv-surface.npz')), projection=projection, triangles=triangles, uv=uv, perspective=s.camera.data.type == 'PERSP', eye_projection=eye_projection, eye_triangles=eye_triangles)
print('UV_SURFACE_EXPORTED', len(projection), len(triangles))
