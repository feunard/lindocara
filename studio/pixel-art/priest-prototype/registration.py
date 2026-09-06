"""Register whole painted poses without cutting or pasting the neck/head."""
import math
import cv2
import numpy as np
from PIL import Image
from source_tools import cells, head_box, SOURCE

CELL = 256
ANCHOR = (128, 190)
PHASES = [0, .10, .25, .40, .50, .60, .75, .90]


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
    grounded_pelvis=[ANCHOR[1]-(m["ground"]-m["pelvis"][1])*scale for m in measurements]
    frames=[]; registrations=[]
    for i,(image,m) in enumerate(zip(raw,measurements)):
        phase=PHASES[i]
        lateral=1.5*math.sin(math.tau*phase) if kind=="run" else 0
        dx=ANCHOR[0]+lateral-m["pelvis"][0]*scale
        if kind=="run" and i in (3,7):
            # Flight rises from THIS gait's adjacent support positions. The idle
            # pelvis is a different posture; snapping back to it made rear/side
            # runs drop their heads during the airborne part of every stride.
            pelvis_y=(grounded_pelvis[i-1]+grounded_pelvis[(i+1)%8])/2-3
            dy=pelvis_y-m["pelvis"][1]*scale
        else:
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


def pilot(direction="side"):
    import sys
    from pathlib import Path
    root=Path(__file__).resolve().parent
    sys.path.insert(0,str(root.parent/"lib"))
    from raster_animation import interpolate
    from palette import colour_frame
    from motion_transfer import upper_body,motion_at
    frames,registration=registered("run",direction)
    def guide(a,b):
        aa=registration[next(i for i,frame in enumerate(frames) if frame is a)]["landmarks"]
        bb=registration[next(i for i,frame in enumerate(frames) if frame is b)]["landmarks"]
        return ([aa[key] for key in ["neck","chest","pelvis"]]+[list(ANCHOR)], [bb[key] for key in ["neck","chest","pelvis"]]+[list(ANCHOR)])
    run=interpolate(list(zip(PHASES,frames))+[(1,frames[0])],36,True,guide=guide)
    out=root.parents[2]/"artifacts/priest-revision"
    out.mkdir(parents=True,exist_ok=True)
    sheet=Image.new("RGBA",(256*8,256*2),(48,65,68,255))
    import json
    colours=json.loads((SOURCE/"palette.json").read_text())["colours"]
    motion=json.loads((SOURCE/"reference-motion.json").read_text())
    for i,frame in enumerate(run):
        phase=i/len(run)
        section=min(7,next((j for j in range(7) if phase<=PHASES[j+1]),7))
        start,end=PHASES[section],PHASES[section+1] if section<7 else 1
        t=(phase-start)/(end-start)
        pelvis=np.array(registration[section]["landmarks"]["pelvis"])*(1-t)+np.array(registration[(section+1)%8]["landmarks"]["pelvis"])*t
        run[i]=upper_body(frame,motion_at(motion,direction,phase),gain=1,pelvis=pelvis)
    for i in range(16):
        sheet.alpha_composite(Image.fromarray(colour_frame(run[round(i/16*36)%36],colours)),(i%8*256,i//8*256))
    sheet.save(out/f"pilot-{direction}.png")
    (out/f"pilot-{direction}.json").write_text(json.dumps(registration,indent=2))
    print(f"Registered {direction}: uniform density {registration[0]['scale']:.4f}, whole painted head/neck preserved.")


if __name__=="__main__":
    import sys
    pilot(sys.argv[1] if len(sys.argv)>1 else "side")
