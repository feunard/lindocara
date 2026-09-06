# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""LCPixel drawings -> registered whole-body motion -> offline raster atlases."""
import argparse
import json
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
from registration import registered, rest_image, body_landmarks, CELL, ANCHOR
from run_poses import run_cycle, source_files, STRIDE_DISTANCE, FRAMES
from palette import colour_frame

OUT = REPO / "packages/renderer/src/assets/bonus/priest-prototype"
REVIEW = REPO / "artifacts/priest-prototype"
PP = 192 / 2.34
STRIDE = STRIDE_DISTANCE
SPEED = 234 / 64
SPECS = {
    "idle": dict(frames=16, durationMs=1600, loop=True),
    "run": dict(frames=FRAMES, durationMs=STRIDE / SPEED * 1000, loop=True),
    "jump": dict(frames=12, durationMs=300, loop=False),
    "jump-run": dict(frames=80, durationMs=300, loop=False, phaseBuckets=8, transitionFrames=10),
    "fall": dict(frames=12, durationMs=300, loop=False),
    "land": dict(frames=12, durationMs=180, loop=False),
    "land-run": dict(frames=48, durationMs=180, loop=False, phaseBuckets=8, transitionFrames=6),
    "stop": dict(frames=48, durationMs=120, loop=False, phaseBuckets=8, transitionFrames=6),
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


def orb_point(frame, near=None, max_y=None):
    """Locate the gold ring/orb, excluding the chest cross and cloth highlights."""
    r,g,b=[frame[:,:,i].astype("int16") for i in range(3)]
    gold=((r>165)&(g>110)&(r-b>85)&(g>b*1.45)&(frame[:,:,3]>0)).astype("uint8")
    if max_y is not None:
        gold[max(0,round(max_y)):]=0
    gold=cv2.morphologyEx(gold,cv2.MORPH_CLOSE,np.ones((3,3),"uint8"))
    count,_,stats,centres=cv2.connectedComponentsWithStats(gold,8)
    candidates=[i for i in range(1,count) if stats[i,4]>=5 and stats[i,2]>=3 and stats[i,3]>=3]
    if not candidates:
        return None
    if near is not None:
        best=min(candidates,key=lambda i:np.linalg.norm(centres[i]-near))
    else:
        best=min(candidates,key=lambda i:centres[i][1])
    x,y,w,h,_=stats[best]
    return [float(x+(w-1)/2),float(y+(h-1)/2)]


def death_keys(direction):
    raw=cells(f"death-{direction}")
    head=head_box(raw[0])
    rest_head=head_box(rest_image(direction))
    scale=(rest_head[2]-rest_head[0])/(head[2]-head[0])
    frames=[]
    for source in raw:
        bounds=source.getbbox()
        dx=ANCHOR[0]-(bounds[0]+bounds[2])/2*scale
        dy=ANCHOR[1]-bounds[3]*scale
        matrix=np.array([[scale,0,dx],[0,scale,dy]],dtype="float32")
        frame=cv2.warpAffine(np.array(source),matrix,(CELL,CELL),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
        frame[:,:,3]=(frame[:,:,3]>=128).astype("uint8")*255
        frame[frame[:,:,3]==0]=0
        frames.append(frame)
    frames[-1]=frames[-2].copy()
    return frames


def whole_pose_tweener():
    """Guidance moves the original painting together, including its head and neck."""
    cache={}
    def landmarks(frame):
        key=id(frame)
        if key not in cache:
            try:
                m=body_landmarks(Image.fromarray(frame))
                points=[m[name] for name in ["neck","chest","pelvis"]]
                orb=orb_point(frame,max_y=m["neck"][1]+5)
                cache[key]=points+[list(ANCHOR)]+([orb] if orb else [])
            except (ValueError,IndexError):
                cache[key]=[]
        return cache[key]
    def guide(a,b):
        aa,bb=landmarks(a),landmarks(b)
        length=min(len(aa),len(bb))
        return (aa[:length],bb[:length]) if length>=4 else None
    def between(nodes,count,loop=False,body_guidance=True):
        return interpolate(nodes,count,loop,guide=guide if body_guidance else None)
    return between


def witness(name, frames, sockets=None):
    REVIEW.mkdir(parents=True,exist_ok=True)
    sheet=Image.new("RGBA",(CELL*8,CELL*2),(48,65,68,255))
    for i in range(16):
        index=round(i/16*len(frames))%len(frames)
        image=Image.fromarray(frames[index])
        if sockets:
            x,y=sockets[index]["x"],sockets[index]["y"]
            ImageDraw.Draw(image).ellipse((x-2,y-2,x+2,y+2),outline="cyan")
        sheet.alpha_composite(image,(i%8*CELL,i//8*CELL))
    sheet.save(REVIEW/f"{name}-native.png")


def sockets(rows, name):
    result=[]
    for row in rows:
        points=[]
        for frame in row:
            point=orb_point(frame,max_y=None if name in ["death","hurt"] else 145)
            points.append({"x":round(point[0],3),"y":round(point[1],3)} if point else None)
        valid=[i for i,p in enumerate(points) if p is not None]
        if not valid:
            raise ValueError(f"{name}: no visible staff orb")
        for i,p in enumerate(points):
            if p is None:
                points[i]=points[min(valid,key=lambda j:abs(i-j))].copy()
        result.append(points)
    return result


def bake():
    OUT.mkdir(parents=True,exist_ok=True)
    colours=json.loads((SOURCE/"palette.json").read_text(encoding="utf-8"))["colours"]
    rendered={name:[] for name in SPECS}
    registrations={}
    for direction in NAMES:
        rest=np.array(rest_image(direction))
        run,runreg=run_cycle(direction)
        c,castreg=registered("cast",direction)
        death=death_keys(direction)
        registrations[direction]={"cast":castreg,"run":runreg}
        between=whole_pose_tweener()
        rendered["run"].append(run)
        yy,xx=np.mgrid[:CELL,:CELL].astype("float32")
        shift=np.clip((ANCHOR[1]-yy)/35,0,1)
        breath=cv2.remap(rest,xx,yy+shift,cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
        rendered["idle"].append(between([(0,rest),(.5,breath),(1,rest)],16,True))
        at=lambda phase:run[round(phase*len(run))%len(run)]
        apex=at(1/3);reach=at(0);compress=at(1/6)
        for name,spec in SPECS.items():
            if name in ["run","idle"]:
                continue
            if "phaseBuckets" in spec:
                bank=[]
                for b in range(spec["phaseBuckets"]):
                    pose=run[round(b/spec["phaseBuckets"]*len(run))%len(run)]
                    nodes=[(0,pose),(.55,compress),(1,apex)] if name=="jump-run" else [(0,reach),(.3,compress),(1,pose)] if name=="land-run" else [(0,pose),(1,rest)]
                    bank.extend(between(nodes,spec["transitionFrames"]))
                rendered[name].append(bank)
                continue
            if name=="jump": nodes=[(0,rest),(.45,compress),(1,apex)]
            elif name=="fall": nodes=[(0,apex),(.45,at(.9)),(1,reach)]
            elif name=="land": nodes=[(0,reach),(.3,compress),(1,rest)]
            elif name=="hurt": nodes=[(0,rest),(.25,death[0]),(1,rest)]
            elif name=="swim": nodes=[(0,apex),(.5,at(.9)),(1,apex)]
            elif name=="glide": nodes=[(0,apex),(.5,compress),(1,apex)]
            elif name=="death": nodes=[(0,rest)]+list(zip([.10,.23,.35,.47,.59,.73,.88,1],death))
            else:
                release=spec["activeFrame"]/(spec["frames"]-1)
                if name in ["radiant-bolt","mend"]:
                    nodes=[(0,rest),(release*.35,c[5]),(release,c[3]),(release+(1-release)*.45,c[4]),(1,rest)]
                elif name=="blink": nodes=[(0,rest),(release*.6,c[5]),(release,c[6]),(release+(1-release)*.35,c[5]),(1,rest)]
                elif name=="prayer": nodes=[(0,rest),(release*.6,c[5]),(release,c[6]),(release+(1-release)*.65,c[5]),(1,rest)]
                else: nodes=[(0,rest),(release*.5,c[5]),(release*.8,c[6]),(release,c[7]),(release+(1-release)*.5,c[6]),(1,rest)]
            rendered[name].append(between(nodes,spec["frames"],spec["loop"],body_guidance=name not in ["death","hurt"]))
        for name in rendered:
            rendered[name][-1]=[colour_frame(frame,colours) for frame in rendered[name][-1]]
        for name in ["run","radiant-bolt","divine-nova","death"]:
            witness(f"{name}-{direction}",rendered[name][-1])
        print(f"Baked {direction}",flush=True)
    clips={}
    for name,rows in rendered.items():
        clips[name]=pack(OUT,name,rows,{**SPECS[name],"weaponSockets":sockets(rows,name)},anchor=ANCHOR,pixels_per_tile=PP)
    clips["start"]={**clips["stop"],"durationMs":100}
    paintings=sorted(p for p in SOURCE.glob('*.png') if p.name.startswith(('canonical-','cast-','death-')))
    inputs=[Path(__file__),*[ROOT/name for name in ["source_tools.py","registration.py","run_poses.py","palette.py"]],ROOT.parent/"lib/raster_animation.py",*paintings,*source_files(),SOURCE/"canonical-registration.json",SOURCE/"palette.json",ROOT.parents[1]/"styles/lcpixel/style.json"]
    report={'registration':registrations,
            'method':'Whole painted keys. Landmarks describe key registration only, not a reconstructed skeleton or proof of foot contact.'}
    report_path=ROOT/'authoring-report.json'
    report_path.write_text(json.dumps(report,separators=(',',':'))+'\n',encoding='utf-8')
    manifest={"version":4,"body":"priest","style":"LCPixel","method":"registered whole painted poses and offline bidirectional raster inbetweening, shared with Rogue V2","sourceFrame":{"width":CELL,"height":CELL,"anchor":{"x":ANCHOR[0],"y":ANCHOR[1]}},"pixelsPerTile":PP,"strideDistance":STRIDE,"referenceSpeed":SPEED,"runtimeScale":1,"directions":NAMES,"palette":colours,"authoringReportSha256":sha(report_path),"sourceSha256":{p.relative_to(REPO).as_posix():sha(p) for p in inputs},"clips":clips}
    (OUT/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    Image.open(SOURCE/"canonical-front.png").save(OUT/"portrait.png")
    print(f"Packed {len(clips)} clips",flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--pilot",choices=NAMES)
    args=parser.parse_args()
    if args.pilot:
        run,tracks=run_cycle(args.pilot)
        colours=json.loads((SOURCE/"palette.json").read_text())["colours"]
        run=[colour_frame(frame,colours) for frame in run]
        witness(f"run-{args.pilot}",run,sockets([run],"run")[0])
        REVIEW.mkdir(parents=True,exist_ok=True)
        (REVIEW/f"motion-{args.pilot}.json").write_text(json.dumps({"tracks":tracks},indent=2))
        return
    bake()


if __name__=="__main__":
    main()
