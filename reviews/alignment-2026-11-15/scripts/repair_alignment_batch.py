"""Camera-only fitting against real input, with render-measure-select iterations."""
from pathlib import Path
import sys,json,subprocess
import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation
from scipy.optimize import least_squares
from PIL import Image
sys.path.insert(0,'D:/ours_bundle_20261113/cvpr9_rebald_registered_v2')
from observe import detect,detector,KEYS
ROOT=Path(__file__).resolve().parents[1];ARC=ROOT/'selected_cases_archive';OUT=ROOT/'_build/release61/alignment-repair';OUT.mkdir(parents=True,exist_ok=True)
BLENDER='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
def read(p):return json.loads(p.read_text())
def save(p,j):p.write_text(json.dumps(j,indent=2))
def rgb(p):
    im=Image.open(p).convert('RGBA');return np.asarray(Image.alpha_composite(Image.new('RGBA',im.size,'white'),im).convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS))
def measure(a,b):return {k:float(np.sqrt(np.mean(np.sum((a[v]-b[v])**2,axis=1)))) for k,v in KEYS.items()}
def cost(m):return np.mean(list(m.values()))+.35*max(m.values())
def render(jobs,label):
    p=OUT/(label+'.json');save(p,jobs)
    with (OUT/(label+'.log')).open('w') as log:
        subprocess.run([BLENDER,'-b','-t','4','--python-exit-code','1','--python',str(ROOT/'tools/render_alignment_candidates.py'),'--',str(p)],stdout=log,stderr=subprocess.STDOUT,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
audit=read(ROOT/'_build/release61/all-image-review/report.json')['records'];wanted={r['id']:r for r in audit if r['reviewPriority']}
records=[r for r in read(ARC/'manifest.json')['records'] if r['id'] in wanted]
if '--pilot' in sys.argv:records=[r for r in records if r['case_name']=='Yao_Ming_01_v2_nobald']
states=[]
with detector() as det:
 for r in records:
    d=OUT/r['web_id'];d.mkdir(exist_ok=True);meta=ARC/'cases'/r['id']/'metadata';cm=read(meta/'camera.json');M=np.array(cm['matrix_world']);fr=np.array(cm['view_frame_local']);fr=fr[:,:2]/abs(fr[0,2]);left,right=fr[:,0].min(),fr[:,0].max();bottom,top=fr[:,1].min(),fr[:,1].max();f=1024/(right-left);pp=np.array([-left*f,top*f])
    geo=max(read(meta/'geometry.json'),key=lambda g:g['vertices']);z=np.load(ARC/geo['path']);v=np.c_[z['vertices_local'],np.ones(len(z['vertices_local']))]@z['matrix_world'].T;v=v[:,:3]
    target=detect(det,rgb(ARC/r['assets']['input']['path']));before=detect(det,rgb(ARC/r['assets']['render']['path']));camera=dict(matrix_world=M.tolist(),lens_mm=f*36/1024,shift_x=(512-pp[0])/1024,shift_y=(pp[1]-512)/1024)
    metrics=measure(before,target);state=dict(id=r['id'],group='7_target_mismatch' if wanted[r['id']]['differentRegistrationTarget'] else '14_other_residuals',source=r,initial=camera,current=camera,before=metrics,after=metrics,selectedRender=str(ARC/r['assets']['render']['path']),history=[])
    if (d/'state.json').exists():state=read(d/'state.json')
    states.append((state,d,v,target))
 for roundno in range(1,5):
    jobs=[]
    active=[item for item in states if item[0].get('stalled',0)<2]
    if not active:break
    for state,d,vertices,target in active:
        current=state['current'];M=np.array(current['matrix_world']);R=M[:3,:3];f=current['lens_mm']*1024/36;pp=np.array([512-current['shift_x']*1024,512+current['shift_y']*1024]);xyz=(vertices-M[:3,3])@R;xy=pp+f*xyz[:,:2]*[1,-1]/(-xyz[:,2:])
        observed=detect(det,rgb(Path(state['selectedRender'])));ids=sum(KEYS.values(),[]);pts=observed[ids];z=np.percentile(-xyz[cKDTree(xy).query(pts,k=20)[1],2],12,axis=1);features=np.c_[(pts-pp)*[1,-1]*z[:,None]/f,-z];pivot=features.mean(0);s0=f/-pivot[2];uv=pp+pivot[:2]*s0*[1,-1]
        def cam(p):
            rot=Rotation.from_rotvec(p[:3]).as_matrix();scale=s0*np.exp(p[3]);lens=f*np.exp(p[4]);center=pivot+rot@np.r_[(pp-uv-p[5:])*[1,-1]/scale,lens/scale];return rot,center,lens
        def proj(p):
            rot,c,lens=cam(p);q=(features-c)@rot;return pp+lens*q[:,:2]*[1,-1]/(-q[:,2:])
        candidates=[]
        for label,emphasis in [('balanced',False),('worst',True)]:
            weights=np.array([max(1,state['after'][k]/4) if emphasis else 1 for k in KEYS],dtype=float);weights/=weights.sum();wt=np.concatenate([np.full(len(ids),w/len(ids)) for ids,w in zip(KEYS.values(),weights)])
            def res(p):return np.r_[((proj(p)-target[ids])*np.sqrt(wt[:,None])).ravel(),p[:3]*3,p[4]*.7]
            p=least_squares(res,np.zeros(7),bounds=([-.16,-.16,-.08,-.08,-.7,-30,-30],[.16,.16,.08,.08,.4,30,30]),loss='soft_l1',f_scale=2,x_scale='jac',max_nfev=150).x
            rot,c,lens=cam(p);mat=np.eye(4);mat[:3,:3]=R@rot;mat[:3,3]=M[:3,3]+R@c
            candidates.append(dict(matrix_world=mat.tolist(),lens_mm=lens*36/1024,shift_x=current['shift_x'],shift_y=current['shift_y'],output=str(d/f'r{roundno}-{label}.png')))
        jobs.append(dict(id=state['id'],scene=str(ARC/state['source']['assets']['scene']['path']),candidates=candidates))
    render(jobs,f'round-{roundno}'+('-pilot' if '--pilot' in sys.argv else ''))
    for (state,d,v,target),job in zip(active,jobs):
        previous_cost=cost(state['after'])
        for candidate in job['candidates']:
            try:m=measure(detect(det,rgb(Path(candidate['output']))),target)
            except ValueError:continue
            state['history'].append(dict(output=candidate['output'],metrics=m))
            if cost(m)<cost(state['after']) and max(m.values())<=max(state['before'].values())+.25:
                state['current']={k:v for k,v in candidate.items() if k!='output'};state['after']=m;state['selectedRender']=candidate['output']
        state['stalled']=state.get('stalled',0)+1 if previous_cost-cost(state['after'])<.08 else 0
        save(d/'state.json',state);print(roundno,state['id'],round(cost(state['before']),2),round(cost(state['after']),2),flush=True)
 jobs=[dict(id=s['id'],scene=str(ARC/s['source']['assets']['scene']['path']),final=True,samples=192,candidates=[dict(**s['current'],output=str(d/'render.png'))]) for s,d,_,_ in states]
 render(jobs,'final'+('-pilot' if '--pilot' in sys.argv else ''))
 for s,d,_,target in states:
    s['finalMetrics']=measure(detect(det,rgb(d/'render.png')),target);save(d/'state.json',s)
save(OUT/('pilot-summary.json' if '--pilot' in sys.argv else 'summary.json'),[s for s,_,_,_ in states])
