"""Register whole painted poses without cutting or pasting the neck/head."""
import cv2
import numpy as np
from PIL import Image
from source_tools import cells, head_box, SOURCE

CELL = 256
ANCHOR = (128, 190)


def rest_image(direction):
    image = Image.new("RGBA", (CELL, CELL))
    image.alpha_composite(Image.open(SOURCE / f"canonical-{direction}.png").convert("RGBA"), (32,54))
    return image


def body_landmarks(image):
    head = head_box(image)
    # The beard can become disconnected from the hair after palette reduction.
    # Its connected-component bottom then jumps between eyes and chin. Use the
    # locked skull proportion for the anatomical neck, never that colour seam.
    head[3] = head[1] + round((head[2]-head[0])*.98)
    a = np.array(image)
    r,g,b = [a[:,:,i].astype("int16") for i in range(3)]
    cx = (head[0]+head[2])/2
    width = head[2]-head[0]
    left,right = max(0,round(cx-width*.55)),min(image.width,round(cx+width*.55))
    top,bottom = round(head[3]+width*.34),min(image.height,round(head[3]+width*.95))
    brown = (r>25)&(r<180)&(g<130)&(b<100)&(r>g*1.08)&(g>b*1.04)&(a[:,:,3]>0)
    score = np.convolve(brown[top:bottom,left:right].sum(1),np.ones(5)/5,mode="same")
    belt_y = top+int(score.argmax())
    yy,xx = np.nonzero(brown[max(0,belt_y-2):belt_y+3,left:right])
    belt_x = float(np.median(xx))+left if len(xx) else cx
    boot_mask=brown.copy()
    boot_mask[:round(belt_y+width*.35)] = False
    yy,xx=np.nonzero(boot_mask)
    if len(xx)<5:
        raise ValueError("Missing foot landmark")
    foot_y=float(np.quantile(yy,.995))+1
    # This is an anatomical correspondence for motion estimation, not a fixed spine.
    neck=[cx,float(head[3])]
    chest=[cx*.4+belt_x*.6,head[3]+(belt_y-head[3])*.48]
    return {"head":head,"neck":neck,"chest":chest,"pelvis":[belt_x,float(belt_y)],"ground":foot_y}


def registered(kind,direction):
    if kind!='cast':
        raise ValueError('This entry registers cast poses; run_poses.py registers whole running keys.')
    raw=cells(f"{kind}-{direction}",4,2)
    source_density=[1.0]*8
    if kind=="cast" and direction=="front-quarter":
        overhead=cells("cast-front-quarter-overhead",2,1)
        width=lambda image:head_box(image)[2]-head_box(image)[0]
        density=float(np.median([width(image) for image in raw[:6]]))/float(np.median([width(image) for image in overhead]))
        # This two-pose authoring sheet has a different source resolution. One
        # density conversion for BOTH drawings, preserving their full anatomy.
        raw[6:]=[image.resize((round(image.width*density),round(image.height*density)),Image.Resampling.LANCZOS) for image in overhead]
        source_density[6:]=[density,density]
    target=body_landmarks(rest_image(direction))
    measurements=[body_landmarks(image) for image in raw]
    # One uniform image density for the entire clip: no independent torso/leg fit,
    # no per-pose size normalization and no rectangular head replacement.
    scale=(target["head"][2]-target["head"][0])/float(np.median([m["head"][2]-m["head"][0] for m in measurements]))
    frames=[]; registrations=[]
    for i,(image,m) in enumerate(zip(raw,measurements)):
        dx=ANCHOR[0]-m["pelvis"][0]*scale
        dy=ANCHOR[1]-m["ground"]*scale
        matrix=np.array([[scale,0,dx],[0,scale,dy]],dtype="float32")
        frame=cv2.warpAffine(np.array(image),matrix,(CELL,CELL),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
        frame[:,:,3]=(frame[:,:,3]>=128).astype("uint8")*255
        frame[frame[:,:,3]==0]=0
        transform=lambda point:[round(point[0]*scale+dx,4),round(point[1]*scale+dy,4)]
        landmarks={key:transform(m[key]) for key in ["neck","chest","pelvis"]}
        landmarks["head"]=[round(m["head"][0]*scale+dx,4),round(m["head"][1]*scale+dy,4),round(m["head"][2]*scale+dx,4),round(m["head"][3]*scale+dy,4)]
        frames.append(frame)
        registrations.append({"scale":scale,"sourceSheetDensity":source_density[i],"offset":[dx,dy],"source":m,"landmarks":landmarks})
    return frames,registrations
