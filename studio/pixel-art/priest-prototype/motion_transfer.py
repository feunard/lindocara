"""Offline upper-body motion transfer from approved Assassin V2 raster motion.

Only the compact rigid chest/hip motion is retained, not its artwork or shape.
The Priest's entire upper painting, including the neck, follows one transform.
"""
import hashlib
import json
import math
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
sys.path.insert(0,str(ROOT.parent/"lib"))
from raster_animation import Tween
from registration import body_landmarks


def extract_reference():
    folder=REPO/"packages/renderer/src/assets/bonus/assassin-v2"
    manifest=json.loads((folder/"manifest.json").read_text())
    clip=manifest["clips"]["run"]
    atlas=Image.open(folder/"run.png").convert("RGBA")
    w,h=clip["frame"]["width"],clip["frame"]["height"]
    directions={}
    for row,name in enumerate(manifest["directions"]):
        frames=[]
        for f in range(clip["frames"]):
            index=row*clip["directionStride"]+f
            image=Image.new("RGBA",(192,192))
            image.alpha_composite(atlas.crop((index%clip["columns"]*w,index//clip["columns"]*h,index%clip["columns"]*w+w,index//clip["columns"]*h+h)),(96-clip["frame"]["anchor"]["x"],136-clip["frame"]["anchor"]["y"]))
            frames.append(np.array(image))
        base=frames[0]
        yy,xx=np.mgrid[:192,:192]
        chest=(xx>=80)&(xx<=113)&(yy>=91)&(yy<=108)&(base[:,:,3]>0)
        hips=(xx>=85)&(xx<=108)&(yy>=112)&(yy<=122)&(base[:,:,3]>0)
        points=np.column_stack([xx[chest],yy[chest]]).astype(float)
        centred=points-points.mean(0)
        values=[]
        for frame in frames:
            flow=Tween(base,frame).forward
            target=points+flow[chest]
            u,_,vt=np.linalg.svd(centred.T@(target-target.mean(0)))
            rotation=u@vt
            angle=math.atan2(rotation[0,1],rotation[0,0])
            delta=np.median(flow[chest],axis=0)-np.median(flow[hips],axis=0)
            values.append([float(np.clip(angle,-.105,.105)),*np.clip(delta,-4,4).tolist()])
        values=np.array(values)
        values=sum(np.roll(values,shift,axis=0)*weight for shift,weight in [(-2,1),(-1,2),(0,3),(1,2),(2,1)])/9
        values-=values.mean(0)
        directions[name]=np.round(values,6).tolist()
    data={"source":"packages/renderer/src/assets/bonus/assassin-v2/run.png","sourceSha256":hashlib.sha256((folder/"run.png").read_bytes()).hexdigest(),"sampleCount":36,"columns":["rollRadians","chestRelativeHipX","chestRelativeHipY"],"directions":directions}
    (ROOT/"sources/simplified/reference-motion.json").write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
    for name,values in directions.items():
        a=np.array(values)
        print(name,"roll span",round(float(np.ptp(a[:,0])*180/math.pi),2),"chest travel",np.round(np.ptp(a[:,1:],axis=0),2).tolist())
    return data


def motion_at(data,direction,phase):
    values=data["directions"][direction]
    at=(phase%1)*len(values);index=int(at);t=at-index
    return np.array(values[index])*(1-t)+np.array(values[(index+1)%len(values)])*t


def upper_body(frame,motion,orb=None,gain=1,pelvis=None):
    """Continuous rigid upper body / planted lower body blend, baked before packing."""
    pivot=np.array(pelvis if pelvis is not None else body_landmarks(Image.fromarray(frame))["pelvis"],dtype="float32")
    angle=float(motion[0])*gain
    translation=np.asarray(motion[1:],dtype="float32")*gain
    # Preserve lengths: this is a rotation/translation, never a torso scale.
    c,s=math.cos(angle),math.sin(angle)
    rotation=np.array([[c,s],[-s,c]],dtype="float32")
    yy,xx=np.mgrid[:frame.shape[0],:frame.shape[1]].astype("float32")
    weight=np.clip((pivot[1]+10-yy)/25,0,1)
    weight=weight*weight*(3-2*weight)
    if orb is not None:
        r,g,b=[frame[:,:,i].astype("int16") for i in range(3)]
        brown=(r>25)&(r<180)&(g<135)&(b<110)&(r>g*1.08)&(frame[:,:,3]>0)
        shaft=[];last=float(orb[0])
        for y in range(round(orb[1])+12,min(frame.shape[0],round(pivot[1])+45)):
            xs=np.flatnonzero(brown[y]&(np.abs(np.arange(frame.shape[1])-last)<7))
            if len(xs):
                last=float(np.median(xs));shaft.append([y,last])
        if len(shaft)>12:
            points=np.array(shaft);slope,intercept=np.polyfit(points[:,0],points[:,1],1)
            # Carry the entire painted staff as one rigid object with the hand.
            weapon=np.clip((11-np.abs(xx-(yy*slope+intercept)))/3,0,1)
            weight=np.maximum(weight,weapon)
    grid=np.stack([xx,yy],axis=-1)
    rigid=(grid-pivot-translation)@rotation+pivot
    uv=(grid+(rigid-grid)*weight[:,:,None]).astype("float32")
    result=cv2.remap(frame,uv[:,:,0],uv[:,:,1],cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
    result[:,:,3]=(result[:,:,3]>=128).astype("uint8")*255
    result[result[:,:,3]==0]=0
    return result


if __name__=="__main__":
    extract_reference()
