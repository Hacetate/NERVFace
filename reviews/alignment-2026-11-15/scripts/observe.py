from pathlib import Path
import numpy as np, cv2, json,sys
from PIL import Image
import mediapipe as mp
o=Path(__file__).resolve().parent
old=o.parent/'cvpr9_rebald_registered';src=o.parent/'cvpr9_rebald_20261113'
KEYS={'bridge':[168,6,197,195,5,4],'nose':[1,2,98,327,97,326],'lip':[61,291,0,13,14,17,37,267,84,314],'chin':[149,176,148,152,377,400,378],'eyes':[33,133,362,263,159,145,386,374],'iris':[468,473]}
def read(p):return json.loads(p.read_text('utf8'))
def take(det,im):
    land=det.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(im))).face_landmarks
    if not land:raise ValueError('face undetected')
    return np.array([[a.x*1024-.5,a.y*1024-.5] for a in land[0]])
def comp(p):
    im=Image.open(p).convert('RGBA');bg=Image.new('RGBA',im.size,(191,191,191,255));bg.alpha_composite(im);return np.array(bg.convert('RGB'))
def detect(det,im):
    # Reduce sensitivity of a single detection to crop and handedness; all
    # coordinates map back into the original 1024-square camera frame.
    all=[]
    for k,x,y in [(1,0,0),(.94,23,36),(1.05,-19,-22)]:
        A=np.array([[k,0,x],[0,k,y]],dtype='float32');test=cv2.warpAffine(im,A,(1024,1024),borderMode=cv2.BORDER_REPLICATE)
        all.append((take(det,test)-[x,y])/k)
    return np.median(all,axis=0)
def detector():
    opts=mp.tasks.vision.FaceLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(src/'ours/texture_inputs/shared/face_landmarker.task')),num_faces=1)
    return mp.tasks.vision.FaceLandmarker.create_from_options(opts)
if __name__=='__main__':
    with detector() as det:
        for d in sorted(old.glob('*/registered.blend')):
            dest=o/d.parent.name;dest.mkdir(exist_ok=True);ref=np.array(Image.open(src/'inputs'/(dest.name+'.png')).convert('RGB'))
            im=comp(d.parent/'render.png');a=detect(det,ref);b=detect(det,im);np.savez(dest/'observations.npz',original=a,previous=b)
            print(dest.name,[(s,np.round((b-a)[ids].mean(0),1).tolist()) for s,ids in KEYS.items()])
