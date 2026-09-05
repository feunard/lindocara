# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Authored Priest raster keys -> shared Assassin V2 inbetweens -> fixed-anchor atlases."""
import argparse
import json
import math
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(ROOT.parent / "lib"))
from raster_animation import interpolate, pack, sha
from source_tools import cells, head_box, NAMES, SOURCE

OUT = REPO / "packages/renderer/src/assets/bonus/priest-prototype"
REVIEW = REPO / "artifacts/priest-prototype"
CELL = 256
ANCHOR = (128, 190)
PP = 192 / 2.34
STRIDE = 1.4
SPEED = 234 / 64
SPECS = {
    "idle": dict(frames=16, durationMs=1600, loop=True),
    "run": dict(frames=36, durationMs=STRIDE / SPEED * 1000, loop=True),
    "jump": dict(frames=12, durationMs=300, loop=False),
    "jump-run": dict(frames=64, durationMs=300, loop=False, phaseBuckets=8, transitionFrames=8),
    "fall": dict(frames=12, durationMs=300, loop=False),
    "land": dict(frames=12, durationMs=180, loop=False),
    "land-run": dict(frames=40, durationMs=180, loop=False, phaseBuckets=8, transitionFrames=5),
    "stop": dict(frames=32, durationMs=120, loop=False, phaseBuckets=8, transitionFrames=4),
    "hurt": dict(frames=12, durationMs=200, loop=False),
    "swim": dict(frames=16, durationMs=1000, loop=True),
    "glide": dict(frames=16, durationMs=1800, loop=True),
    "radiant-bolt": dict(frames=24, durationMs=325, loop=False, activeFrame=10),
    "mend": dict(frames=32, durationMs=840, loop=False, activeFrame=9),
    "blink": dict(frames=24, durationMs=600, loop=False, activeFrame=7),
    "prayer": dict(frames=32, durationMs=960, loop=False, activeFrame=10),
    "divine-nova": dict(frames=36, durationMs=1100, loop=False, activeFrame=13),
    "death": dict(frames=40, durationMs=1000, loop=False),
}


def shifted(a, dx=0, dy=0):
    out = Image.new("RGBA", (CELL, CELL))
    out.alpha_composite(Image.fromarray(a), (round(dx), round(dy)))
    return np.array(out)


def rest_image(direction):
    out = Image.new("RGBA", (CELL, CELL))
    out.alpha_composite(Image.open(SOURCE / f"canonical-{direction}.png").convert("RGBA"), (32,54))
    return out


def pose_head(image):
    a=np.array(image);r,g,b=[a[:,:,i].astype("int16") for i in range(3)]
    mask=((r>30)&(r<155)&(g<160)&(b>r+3)&(g>=r)&(a[:,:,3]>0)).astype("uint8")
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),"uint8"))
    count,_,stats,_=cv2.connectedComponentsWithStats(mask,8)
    candidates=[i for i in range(1,count) if stats[i,2]>stats[i,3]*.6 and stats[i,2]<stats[i,3]*2.0]
    if not candidates: raise ValueError("Missing head landmark")
    best=max(candidates,key=lambda i:stats[i,4]); x,y,w,h,_=map(int,stats[best])
    return [x-2,y-2,x+w+2,round(y+w*.98)]


def feet(image):
    a=np.array(image);r,g,b=[a[:,:,i].astype("int16") for i in range(3)]
    bounds=image.getbbox()
    mask=(r<165)&(r>25)&(g<105)&(r>g*1.18)&(g>b*1.1)&(a[:,:,3]>0)
    mask[:round(bounds[1]+(bounds[3]-bounds[1])*.67)]=False
    yy,xx=np.nonzero(mask)
    if len(xx)<20: raise ValueError("Missing foot landmark")
    return float(np.median(xx)),int(np.quantile(yy,.99))+1


def belt(image, head):
    """The brown belt is a stable body landmark; an advancing foot is not a root."""
    a=np.array(image);r,g,b=[a[:,:,i].astype("int16") for i in range(3)]
    width=head[2]-head[0]; centre=(head[0]+head[2])/2
    left,right=round(centre-width*.48),round(centre+width*.48)
    top,bottom=round(head[3]+width*.50),round(head[3]+width*.95)
    mask=(r>25)&(r<195)&(g<130)&(b<95)&(r>g*1.13)&(g>b*1.08)&(a[:,:,3]>0)
    area=mask[top:bottom,left:right]
    score=np.convolve(area.sum(1),np.ones(5)/5,mode="same")
    y=int(score.argmax())+top
    yy,xx=np.nonzero(mask[max(0,y-2):y+3,left:right])
    return (float(np.median(xx))+left if len(xx) else centre),y


def registered(name, direction):
    raw=cells(f"{name}-{direction}", 3 if name=="run" and direction!="side" else 4, 2)
    # These three source drawings put the staff in the wrong hand. Reflect the
    # symmetric costume before registration, then restore the canonical head.
    if name=="cast":
        for i in {"front":[6,7],"front-quarter":[6,7],"back":[3]}.get(direction,[]):
            raw[i]=raw[i].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    rest=rest_image(direction)
    rest_head=json.loads((SOURCE/"canonical-registration.json").read_text())[NAMES.index(direction)]["head"]
    rest_head=[v+(32 if i%2==0 else 54) for i,v in enumerate(rest_head)]
    boxes=[pose_head(frame) for frame in raw]
    feet_at=[feet(frame) for frame in raw]
    source_belts=[belt(frame,box) for frame,box in zip(raw,boxes)]
    rest_belt=belt(rest,rest_head)
    # Calibrate the source drawing's torso and leg density once for the whole clip.
    # Generated sheets use a different drawing scale from the canonical turnaround.
    # Reusing these constants for every pose preserves bends instead of fitting each
    # frame's bounding box (which would lengthen a tucked leg and shorten a contact).
    scale=(rest_belt[1]-rest_head[3])/(source_belts[0][1]-boxes[0][3])
    leg_scale=(ANCHOR[1]-rest_belt[1])/(feet_at[0][1]-source_belts[0][1])
    density=(scale+leg_scale)/2
    head=rest.crop(tuple(rest_head)); frames=[]; registration=[]
    for i,(source,box,(foot_x,foot_y)) in enumerate(zip(raw,boxes,feet_at)):
        canvas=Image.new("RGBA",(CELL,CELL))
        dx=round(rest_belt[0]-source_belts[i][0]*density)
        pelvis_y=rest_belt[1]
        if name=="run" and ((direction=="side" and i in [1,5]) or (direction!="side" and i in [2,5])): pelvis_y-=3
        if name=="cast": pelvis_y=ANCHOR[1]-(foot_y-source_belts[i][1])*leg_scale
        dy=pelvis_y-source_belts[i][1]*scale
        yy,xx=np.mgrid[:CELL,:CELL].astype("float32")
        source_y=source_belts[i][1]+(yy-pelvis_y)/np.where(yy<pelvis_y,scale,leg_scale)
        a=cv2.remap(np.array(source),(xx-dx)/density,source_y.astype('float32'),cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
        a[:,:,3]=(a[:,:,3]>=128).astype("uint8")*255;a[a[:,:,3]==0]=0
        canvas=Image.fromarray(a)
        target_neck=round(box[3]*scale+dy)
        # Canonical face pixels travel with the authored neck, never stretch with optical flow.
        erase=[round(box[0]*density+dx)-2,round(box[1]*scale+dy)-2,round(box[2]*density+dx)+2,target_neck]
        ImageDraw.Draw(canvas).rectangle(erase,fill=(0,0,0,0))
        target_x=round((box[0]+box[2])/2*density+dx-(rest_head[2]-rest_head[0])/2)
        canvas.alpha_composite(head,(target_x,rest_head[1]+target_neck-rest_head[3]))
        frames.append(np.array(canvas))
        registration.append({"scale":density,"torsoScale":scale,"legScale":leg_scale,"offset":[dx,dy],"sourceHead":box,"headOffset":[target_x-rest_head[0],target_neck-rest_head[3]],"sourceFeet":[foot_x,foot_y],"sourceBelt":source_belts[i]})
    return frames,registration


def death_keys(direction):
    raw=cells(f"death-{direction}")
    rest=rest_image(direction)
    # Fixed density from the first standing flinch. Ground is the same throughout the collapse.
    scale=(rest.getbbox()[3]-rest.getbbox()[1])/(raw[0].getbbox()[3]-raw[0].getbbox()[1])
    rest_head=json.loads((SOURCE/'canonical-registration.json').read_text())[NAMES.index(direction)]['head']
    head_width=rest_head[2]-rest_head[0];head_height=rest_head[3]-rest_head[1]
    frames=[]
    for index,source in enumerate(raw):
        bounds=source.getbbox()
        canvas=Image.new("RGBA",(CELL,CELL))
        cut=source.resize((round(source.width*scale),round(source.height*scale)),Image.Resampling.LANCZOS)
        dx=round(ANCHOR[0]-(bounds[0]+bounds[2])/2*scale);dy=round(ANCHOR[1]-bounds[3]*scale)
        canvas.alpha_composite(cut,(dx,dy))
        box=pose_head(source)
        # As the face rolls towards the floor its chin moves below the hair bounds.
        box[3]+=round((box[2]-box[0])*.23*min(1,index/5))
        # The source drawing's expression and turn are retained, but its skull cannot
        # shrink halfway through a collapse. Density is calibrated before inbetweening.
        head=source.crop(tuple(box)).resize((head_width,head_height),Image.Resampling.LANCZOS)
        tx=round((box[0]+box[2])/2*scale+dx-head_width/2)
        ty=round(box[3]*scale+dy-head_height)
        ImageDraw.Draw(canvas).rectangle([round(box[0]*scale+dx)-1,round(box[1]*scale+dy)-1,round(box[2]*scale+dx)+1,round(box[3]*scale+dy)],fill=(0,0,0,0))
        canvas.alpha_composite(head,(tx,ty))
        a=np.array(canvas);a[:,:,3]=(a[:,:,3]>=128).astype("uint8")*255;a[a[:,:,3]==0]=0
        frames.append(a)
    # One stable final drawing, not two independently redrawn resting bodies.
    frames[-1]=frames[-2].copy()
    return frames


def witness(name, frames):
    REVIEW.mkdir(parents=True,exist_ok=True)
    sheet=Image.new("RGBA",(CELL*8,CELL*2),(48,65,68,255))
    for i in range(16):
        index=round(i/16*len(frames))%len(frames)
        sheet.alpha_composite(Image.fromarray(frames[index]),(i%8*CELL,i//8*CELL))
    sheet.save(REVIEW/f"{name}-native.png")


def run_keys(direction):
    raw,reg=registered("run",direction)
    order=[0,3,1,4,7,5] if direction=="side" else list(range(6))
    return [raw[i] for i in order], [reg[i] for i in order]


def orb_point(frame, max_y=None):
    r,g,b=[frame[:,:,i].astype("int16") for i in range(3)]
    mask=((r>120)&(g<95)&(b<85)&(r>g*1.8)&(frame[:,:,3]>0)).astype("uint8")
    if max_y is not None: mask[max_y:]=0
    count,_,stats,centers=cv2.connectedComponentsWithStats(mask,8)
    if count<2: return None
    best=1+stats[1:,4].argmax();x,y=centers[best]
    return [float(x),float(y)]


def sockets(rows, name):
    result=[]
    for row in rows:
        points=[]
        for frame in row:
            point=orb_point(frame,None if name in ['death','hurt'] else 150)
            if point:
                x,y=point
                points.append({"x":round(float(x),3),"y":round(float(y),3)})
            else: points.append(None)
        valid=[i for i,p in enumerate(points) if p is not None]
        if not valid: raise ValueError("No visible weapon orb in clip")
        for i,p in enumerate(points):
            if p is None: points[i]=points[min(valid,key=lambda j:abs(i-j))].copy()
        result.append(points)
    return result


def head_tweener(direction, positions):
    rect=json.loads((SOURCE/"canonical-registration.json").read_text())[NAMES.index(direction)]["head"]
    rect=[v+(32 if i%2==0 else 54) for i,v in enumerate(rect)]
    head=rest_image(direction).crop(tuple(rect))
    def between(nodes,count,loop=False):
        if not all(id(frame) in positions for _,frame in nodes): return interpolate(nodes,count,loop)
        headless=[]; guides={}; head_mask=np.array(head)[:,:,3]>0
        for at,frame in nodes:
            dx,dy=positions[id(frame)]
            source=frame.copy()
            patch=source[rect[1]+dy:rect[3]+dy,rect[0]+dx:rect[2]+dx]
            patch[head_mask]=0
            orb=orb_point(frame,150)
            guides[id(source)]=[[128+dx,rect[3]+dy],[128,149],[128,190],*([orb] if orb else [])]
            headless.append((at,source))
        def correspondences(a,b):
            aa,bb=guides[id(a)],guides[id(b)]
            return (aa,bb) if len(aa)==len(bb) else (aa[:3],bb[:3])
        frames=interpolate(headless,count,loop,guide=correspondences)
        for i,frame in enumerate(frames):
            phase=i/(count if loop else count-1)
            segment=min(len(nodes)-2,next((j for j in range(len(nodes)-1) if phase<=nodes[j+1][0]),len(nodes)-2))
            (ta,a),(tb,b)=nodes[segment:segment+2]
            t=(phase-ta)/(tb-ta)
            dx,dy=[round(positions[id(a)][axis]*(1-t)+positions[id(b)][axis]*t) for axis in range(2)]
            image=Image.fromarray(frame)
            image.alpha_composite(head,(rect[0]+dx,rect[1]+dy))
            frames[i]=np.array(image);positions[id(frames[i])]=[dx,dy]
        return frames
    return between


def bake():
    OUT.mkdir(parents=True,exist_ok=True);REVIEW.mkdir(parents=True,exist_ok=True)
    rendered={name:[] for name in SPECS}; registrations={}; head_registration={}
    phases=[0,.1,.26,.5,.6,.76]
    for direction in NAMES:
        rest=np.array(rest_image(direction)); k,reg=run_keys(direction); c,castreg=registered("cast",direction); death=death_keys(direction)
        registrations[direction]={"run":reg,"cast":castreg}
        head_positions={id(rest):[0,0],**{id(frame):entry["headOffset"] for frame,entry in zip(k,reg)},**{id(frame):entry["headOffset"] for frame,entry in zip(c,castreg)}}
        between=head_tweener(direction,head_positions)
        run=between(list(zip(phases,k))+[(1,k[0])],SPECS["run"]["frames"],True)
        rendered["run"].append(run)
        # The idle breath moves the upper silhouette by one native pixel while the feet stay planted.
        yy,xx=np.mgrid[:CELL,:CELL].astype("float32")
        shift=np.clip((ANCHOR[1]-yy)/35,0,1)
        breath=cv2.remap(rest,xx,yy+shift,cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
        head_positions[id(breath)]=[0,-1]
        rendered["idle"].append(between([(0,rest),(.5,breath),(1,rest)],16,True))
        apex=k[2];reach=k[0];compress=k[1]
        for name,spec in SPECS.items():
            if name in ["run","idle"]: continue
            if "phaseBuckets" in spec:
                bank=[]
                for b in range(spec["phaseBuckets"]):
                    pose=run[round(b/spec["phaseBuckets"]*len(run))%len(run)]
                    nodes=[(0,pose),(.55,k[1]),(1,apex)] if name=="jump-run" else [(0,reach),(.3,compress),(1,pose)] if name=="land-run" else [(0,pose),(1,rest)]
                    bank.extend(between(nodes,spec["transitionFrames"]))
                rendered[name].append(bank);continue
            if name=="jump": nodes=[(0,rest),(.45,k[1]),(1,apex)]
            elif name=="fall": nodes=[(0,apex),(.45,k[5]),(1,reach)]
            elif name=="land": nodes=[(0,reach),(.3,compress),(1,rest)]
            elif name=="hurt": nodes=[(0,rest),(.25,death[0]),(1,rest)]
            elif name=="swim": nodes=[(0,k[2]),(.5,k[5]),(1,k[2])]
            elif name=="glide": nodes=[(0,k[2]),(.5,k[1]),(1,k[2])]
            elif name=="death": nodes=[(0,rest)]+[(t,im) for t,im in zip([.10,.23,.35,.47,.59,.73,.88,1],death)]
            else:
                release=spec["activeFrame"]/(spec["frames"]-1)
                if name in ["radiant-bolt","mend"]:
                    nodes=[(0,rest),(release*.35,c[5]),(release,c[3]),(release+(1-release)*.45,c[4]),(1,rest)]
                elif name=="blink": nodes=[(0,rest),(release*.6,c[5]),(release,c[6]),(release+(1-release)*.35,c[5]),(1,rest)]
                elif name=="prayer": nodes=[(0,rest),(release*.6,c[5]),(release,c[6]),(release+(1-release)*.65,c[5]),(1,rest)]
                else: nodes=[(0,rest),(release*.5,c[5]),(release*.8,c[6]),(release,c[7]),(release+(1-release)*.5,c[6]),(1,rest)]
            rendered[name].append(between(nodes,spec["frames"],spec["loop"]))
        head_registration[direction]={name:[head_positions.get(id(frame)) for frame in rows[-1]] for name,rows in rendered.items()}
        for name in ["run","radiant-bolt","divine-nova","death"]: witness(f"{name}-{direction}",rendered[name][-1])
        print(f"Baked {direction}",flush=True)
    clips={}
    for name,rows in rendered.items():
        clips[name]=pack(OUT,name,rows,{**SPECS[name],"weaponSockets":sockets(rows,name)},anchor=ANCHOR,pixels_per_tile=PP)
    clips["start"]={**clips["stop"],"durationMs":100}
    inputs=[Path(__file__),ROOT/"source_tools.py",ROOT.parent/"lib/raster_animation.py",*sorted(SOURCE.glob("*.png")),SOURCE/"canonical-registration.json"]
    manifest={"version":1,"body":"priest","method":"registered raster keys and the shared Assassin V2 offline inbetween pipeline","sourceFrame":{"width":CELL,"height":CELL,"anchor":{"x":ANCHOR[0],"y":ANCHOR[1]}},"pixelsPerTile":PP,"strideDistance":STRIDE,"referenceSpeed":SPEED,"runtimeScale":1,"directions":NAMES,"registration":registrations,"headRegistration":head_registration,"sourceSha256":{p.relative_to(REPO).as_posix():sha(p) for p in inputs},"clips":clips}
    (OUT/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    Image.open(SOURCE/"canonical-front.png").save(OUT/"portrait.png")
    print(f"Packed {len(clips)} clips",flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot", action="store_true")
    args = parser.parse_args()
    if args.pilot:
        k, reg = run_keys("side")
        nodes = list(zip([0,.1,.26,.5,.6,.76],k))+[(1,k[0])]
        run = interpolate(nodes,36,True)
        witness("run-side",run)
        (REVIEW / "registration-side.json").write_text(json.dumps(reg,indent=2))
        return
    bake()


if __name__ == "__main__":
    main()
