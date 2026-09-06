"""One reviewed material palette for every Priest pose and inbetween."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"sources/simplified"


def make_palette():
    colours=[]
    for name in ["front","front-quarter","side","back-quarter","back"]:
        a=np.array(Image.open(SOURCE/f"canonical-{name}.png").convert("RGBA"))
        colours.append(a[:,:,:3][a[:,:,3]>0])
    samples=np.concatenate(colours)
    palette=Image.fromarray(samples[None,:,:]).quantize(colors=48,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).getpalette()[:144]
    values=[palette[i:i+3] for i in range(0,len(palette),3)]
    (SOURCE/"palette.json").write_text(json.dumps({"style":"LCPixel","version":1,"colours":values},indent=2)+"\n",encoding="utf-8")
    return values


def colour_frame(frame,colours):
    palette=Image.new("P",(1,1))
    packed=[component for colour in colours for component in colour]
    palette.putpalette(packed+packed[:3]*((768-len(packed))//3))
    rgb=np.array(Image.fromarray(frame[:,:,:3]).quantize(palette=palette,dither=Image.Dither.NONE).convert("RGB"))
    out=frame.copy();out[:,:,:3]=rgb;out[out[:,:,3]==0]=0
    return out


if __name__=="__main__":
    colours=make_palette()
    sheet=Image.new("RGBA",(192*5,192))
    for i,name in enumerate(["front","front-quarter","side","back-quarter","back"]):
        image=Image.fromarray(colour_frame(np.array(Image.open(SOURCE/f"canonical-{name}.png").convert("RGBA")),colours))
        image.save(SOURCE/f"canonical-{name}.png");sheet.alpha_composite(image,(i*192,0))
    sheet.save(SOURCE/"canonical-native.png")
    print(f"LCPixel canonical Priest palette: {len(colours)} fixed colours, no dithering.")
