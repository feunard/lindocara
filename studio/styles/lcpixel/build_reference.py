# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==12.3.0"]
# ///
"""Refresh approved references only when intentionally revising the LCPixel contract."""
import hashlib
import json
from pathlib import Path
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
STYLE=ROOT/"styles/lcpixel"
SOURCE=ROOT/"pixel-art/priest-prototype/sources/simplified"
existing=Image.open(SOURCE/"style-reference.png").convert("RGBA")
board=Image.new("RGBA",(1920,480),(48,65,68,255))
board.alpha_composite(existing,(0,0))
priest=Image.open(SOURCE/"canonical-front.png").convert("RGBA").resize((499,499),Image.Resampling.NEAREST)
board.alpha_composite(priest,(1430,-14))
d=ImageDraw.Draw(board)
for i,name in enumerate(["Assassin V2","Gardien runique","Rodeuse","Pretre"]):
    d.text((i*480+180,380),name,fill=(232,224,203,255))
board.save(STYLE/"characters.png")
files=[STYLE/"style.json",STYLE/"STYLE.md",STYLE/"characters.png",SOURCE/"canonical-native.png",SOURCE/"palette.json",SOURCE/"design-reference.png",SOURCE/"turnaround.png",SOURCE/"style-reference.png",*[SOURCE/f"{kind}-{name}.png" for kind in ["canonical","view"] for name in ["front","front-quarter","side","back-quarter","back"]]]
hashes={}
for path in files:
    data=path.read_bytes() if path.suffix==".png" else path.read_text(encoding="utf-8").replace("\r\n","\n").encode("utf-8")
    hashes[path.relative_to(ROOT).as_posix()]=hashlib.sha256(data).hexdigest()
(STYLE/"references.lock.json").write_text(json.dumps({"style":"LCPixel","styleVersion":1,"sha256":hashes},indent=2)+"\n",encoding="utf-8")
print("LCPixel board and approved reference fingerprints rebuilt.")
