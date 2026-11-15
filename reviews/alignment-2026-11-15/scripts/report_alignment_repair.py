"""Create native-UV before/after pairs, clearly separating the two repair groups."""
from pathlib import Path
import json,gzip,html,sys,zipfile,shutil
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from prepare_uv_surface import build
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'_build/release61/alignment-repair';ARC=ROOT/'selected_cases_archive'
def rgb(p):
    im=Image.open(p).convert('RGBA');return Image.alpha_composite(Image.new('RGBA',im.size,'white'),im).convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS)
def mask(u):
    u=u.astype(float)/65535;dy,dx=np.gradient(u);g=np.maximum(1/65535,np.hypot(dx,dy));return Image.fromarray(np.rint(np.clip(.5+(u-.5)/g,0,1)*255).astype('uint8'))
summary=json.loads((OUT/('pilot-summary.json' if '--pilot' in sys.argv else 'summary.json')).read_text())
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',28)
sections={'7_target_mismatch':('A组：7例配准目标不一致',[]),'14_other_residuals':('B组：其他14例局部偏差',[])}
totals=[]
for s in summary:
    c=s['source'];d=OUT/c['web_id'];before=ROOT/'compressed_release_61/assets/showcase/cases'/c['web_id']
    if not (d/'uv-surface.bin').exists() or (d/'projection.npz').stat().st_mtime>(d/'uv-surface.bin').stat().st_mtime:
        build(d,d/'projection.npz')
    u=(np.cumsum(np.frombuffer(gzip.decompress((before/'uv-surface.delta.gz').read_bytes()),'<u2').reshape(1024,1024),axis=1,dtype=np.uint32)&65535).astype('<u2')
    v=np.frombuffer((d/'uv-surface.bin').read_bytes(),'<u2').reshape(1024,1024)
    photo=rgb(ARC/c['assets']['input']['path'])
    first=Image.composite(rgb(ARC/c['assets']['render']['path']),photo,mask(u));last=Image.composite(rgb(d/'render.png'),photo,mask(v))
    first.save(d/'before-uv.png');last.save(d/'after-uv.png')
    group=sections[s['group']][0];pair=Image.new('RGB',(2048,1100),'white');draw=ImageDraw.Draw(pair)
    for x,label,im in [(0,'修复前',first),(1024,'相机重新配准后',last)]:
        draw.text((x+12,5),group+' / '+c['case_name'],font=font,fill='black');draw.text((x+12,40),label+' · 原图左 / 渲染右 · Native U=0.5',font=font,fill='black');pair.paste(im,(x,76))
    pair.save(d/'before-after-uv.jpg',quality=96,subsampling=0)
    m=s['finalMetrics'];old=s['before'];delta=np.mean(list(old.values()))-np.mean(list(m.values()))
    text='；'.join(k+': '+f'{old[k]:.2f} → {m[k]:.2f} px' for k in old)
    changed=s['current']!=s['initial']
    if changed and delta<=0:text+='；平均误差未下降：当前候选主要降低最差区域误差，不能视为整体改善。'
    if not changed:text+='。本轮候选未优于原版，保留原相机；未解决。'
    if max(m.values())>=8:text+='。仍有区域达到8px复核阈值，不能标为完全对齐。'
    totals.append(dict(id=s['id'],group=s['group'],cameraChanged=changed,beforeMean=float(np.mean(list(old.values()))),afterMean=float(np.mean(list(m.values()))),beforeMax=max(old.values()),afterMax=max(m.values()),geometryUnchanged=json.loads((d/'geometry-verification.json').read_text())['unchanged']))
    sections[s['group']][1].append('<article><h3>'+html.escape(c['case_name'])+'</h3><p>'+text+'</p><a href="'+c['web_id']+'/before-after-uv.jpg"><img loading="lazy" src="'+c['web_id']+'/before-after-uv.jpg"></a></article>')
    print(c['id'],'mean improvement',round(delta,2),flush=True)
parts=['<!doctype html><meta charset="utf-8"><title>UV配准修复前后对比</title><style>body{font:16px system-ui;margin:32px auto;max-width:1500px;background:#fafafa}img{width:100%}article{background:white;padding:18px;margin:24px 0}h2{border-bottom:3px solid #c33;padding:15px}p{line-height:1.7}</style><h1>UV 半脸拼合：相机重新配准前后</h1><p>每格左半是真人原图，右半是渲染，沿各自相机投影的 Native U=0.5 切分。原图保持同一1024画幅；未做二维人脸变形。头部几何、UV、皮肤贴图与灯光保持不变。数值是自动关键点区域RMS，不代表零误差或人工真值。</p>']
for title,cards in sections.values():
    if cards:parts+=['<h2>'+title+'</h2>',*cards]
(OUT/('pilot.html' if '--pilot' in sys.argv else 'index.html')).write_text('\n'.join(parts),encoding='utf8')
if '--pilot' not in sys.argv:
    (OUT/'comparison-metrics.json').write_text(json.dumps(totals,indent=2),encoding='utf8')
    bundle=OUT/'comparisons';bundle.mkdir(exist_ok=True)
    for group,(label,_) in sections.items():
        groupdir=bundle/group;groupdir.mkdir(exist_ok=True)
        members=[s for s in summary if s['group']==group]
        for s in members:shutil.copy2(OUT/s['source']['web_id']/'before-after-uv.jpg',groupdir/(s['source']['case_name']+'.jpg'))
        for page in range((len(members)+6)//7):
            chunk=members[page*7:(page+1)*7];sheet=Image.new('RGB',(1024,len(chunk)*550),'white')
            for i,s in enumerate(chunk):sheet.paste(Image.open(OUT/s['source']['web_id']/'before-after-uv.jpg').resize((1024,550),Image.Resampling.LANCZOS),(0,i*550))
            sheet.save(groupdir/f'overview-{page+1}.jpg',quality=94)
    with zipfile.ZipFile(OUT/'UV-before-after-7-plus-14.zip','w',zipfile.ZIP_DEFLATED) as z:
        for p in bundle.rglob('*.jpg'):z.write(p,p.relative_to(bundle))
        z.write(OUT/'comparison-metrics.json','comparison-metrics.json')
