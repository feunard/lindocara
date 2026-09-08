# /// script
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Reproduce canonical registration and remove a generated sheet's empty border lines.

Accepted whole paintings are inputs. This does not generate poses or manipulate body parts.
"""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from source_tools import transparent, HANDED_SOURCE, HANDED_VIEWS, SOURCE
from registration import body_landmarks
from palette import colour_frame


def prepare():
    image=transparent(Image.open(HANDED_SOURCE/'turnaround.png'))
    xs=np.linspace(0,image.width,3).round().astype(int)
    ys=np.linspace(0,image.height,3).round().astype(int)
    raw=[image.crop((xs[x],ys[y],xs[x+1],ys[y+1])) for y in range(2) for x in range(2)]
    measurements=[body_landmarks(im) for im in raw]
    scale=106/float(np.median([m['ground']-m['head'][1] for m in measurements]))
    colours=json.loads((SOURCE/'palette.json').read_text(encoding='utf-8'))['colours']
    records={}
    for name,im,m in zip(HANDED_VIEWS,raw,measurements):
        im.save(HANDED_SOURCE/f'view-{name}.png')
        dx=96-m['pelvis'][0]*scale;dy=136-m['ground']*scale
        a=cv2.warpAffine(np.array(im),np.array([[scale,0,dx],[0,scale,dy]],dtype='float32'),(192,192),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_CONSTANT)
        a[:,:,3]=np.where(a[:,:,3]>=128,255,0)
        Image.fromarray(colour_frame(a,colours)).save(HANDED_SOURCE/f'canonical-{name}.png')
        records[name]={'scale':scale,'offset':[dx,dy],'source':m,'hand':'left'}
    (HANDED_SOURCE/'canonical-registration.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
    # Only the reviewed empty 3-pixel cell boundaries of this source contain grid lines.
    image=Image.open(HANDED_SOURCE/'cast-back-quarter-four-raw.png').convert('RGBA')
    a=np.array(image)
    for x in [0,image.width//2,image.width-1]:
        a[:,max(0,x-2):min(image.width,x+3)]=[255,0,255,255]
    for y in [0,image.height//2,image.height-1]:
        a[max(0,y-2):min(image.height,y+3),:]=[255,0,255,255]
    Image.fromarray(a).save(HANDED_SOURCE/'cast-back-quarter-four.png')


if __name__=='__main__':
    prepare()
