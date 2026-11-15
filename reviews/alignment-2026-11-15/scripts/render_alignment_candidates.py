"""Blender worker: change cameras only, render, and verify geometry unchanged."""
import bpy, sys, json, hashlib, os, runpy
import numpy as np
from pathlib import Path
from mathutils import Matrix
plan=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
def fingerprint():
    h=hashlib.sha256()
    for obj in sorted((o for o in bpy.context.scene.objects if o.type=='MESH'),key=lambda o:o.name):
        h.update(obj.name.encode());h.update(np.asarray(obj.matrix_world,dtype='<f4').tobytes())
        a=np.empty(len(obj.data.vertices)*3,'float32');obj.data.vertices.foreach_get('co',a);h.update(a.tobytes())
        for uv in obj.data.uv_layers:
            a=np.empty(len(uv.data)*2,'float32');uv.data.foreach_get('uv',a);h.update(a.tobytes())
    return h.hexdigest()
for job in plan:
    bpy.ops.wm.open_mainfile(filepath=job['scene']);s=bpy.context.scene;before=fingerprint()
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
    for dev in prefs.devices:dev.use=dev.type=='CUDA'
    s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=job.get('samples',48);s.cycles.use_denoising=True
    s.render.resolution_x=s.render.resolution_y=1024;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.film_transparent=True
    s.render.use_persistent_data=True
    for v in job['candidates']:
        cam=s.camera;cam.matrix_world=Matrix(v['matrix_world']);cam.data.type='PERSP';cam.data.sensor_fit='HORIZONTAL';cam.data.sensor_width=36
        cam.data.lens=v['lens_mm'];cam.data.shift_x=v['shift_x'];cam.data.shift_y=v['shift_y'];bpy.context.view_layer.update()
        s.render.filepath=v['output'];bpy.ops.render.render(write_still=True)
        assert fingerprint()==before,'Geometry/UV changed'
        if job.get('final'):
            out=Path(v['output']).parent;s.render.use_persistent_data=False;bpy.context.preferences.filepaths.save_version=0
            bpy.ops.wm.save_as_mainfile(filepath=str(out/'registered.blend'))
            os.environ['SHOWCASE_UV_DATA']=str(out/'projection.npz')
            runpy.run_path('F:/NERVFaceWeb/tools/export_uv_surface.py',run_name='__main__')
            s.render.engine='BLENDER_WORKBENCH';sh=s.display.shading;sh.light='STUDIO';sh.color_type='SINGLE';sh.single_color=(.51,.51,.51);sh.show_shadows=False;sh.show_cavity=False;sh.show_object_outline=False
            s.render.filepath=str(out/'mesh.png');bpy.ops.render.render(write_still=True)
            (out/'geometry-verification.json').write_text(json.dumps({'before':before,'after':fingerprint(),'unchanged':before==fingerprint()}))
    print('COMPLETE',job['id'],flush=True)
