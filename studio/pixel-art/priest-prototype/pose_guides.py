# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==12.3.0"]
# ///
"""Authoring-only joint diagrams: explicit near/far legs for image key generation."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
# Side-view contacts -> passing -> toe-off -> flight, then exchange the two legs.
near = [
    [(240,320),(279,377),(300,444)],
    [(240,325),(249,386),(231,450)],
    [(240,316),(219,376),(174,422)],
    [(240,306),(212,363),(160,369)],
]
far = [
    [(240,320),(219,377),(178,421)],
    [(240,325),(294,358),(245,408)],
    [(240,316),(302,360),(275,417)],
    [(240,306),(305,357),(320,422)],
]
sheet = Image.new("RGB", (4*400, 2*500), "#28393e")
for frame in range(8):
    first, second = (near[frame], far[frame]) if frame < 4 else (far[frame-4], near[frame-4])
    tile = Image.new("RGB", (400,500), "#28393e")
    d = ImageDraw.Draw(tile)
    def leg(points, colour):
        d.line(points, fill=colour, width=22)
        for x,y in points: d.ellipse((x-12,y-12,x+12,y+12), fill=colour, outline="white", width=2)
        x,y=points[-1];d.polygon([(x-12,y-9),(x+12,y-9),(x+29,y+3),(x+29,y+12),(x-12,y+12)],fill=colour,outline="white")
    leg(second,"#3f97dc")
    hip=first[0]
    d.line([hip,(258,231),(271,189)],fill="#b7c9ce",width=42)
    d.ellipse((212,77,325,190),fill="#b7c9ce",outline="white",width=2)
    d.line([(253,232),(225,275),(205,252)],fill="#b7c9ce",width=20)
    leg(first,"#e85c55")
    d.line([(0,458),(400,458)],fill="#53666c",width=1)
    d.text((12,12),str(frame+1),fill="white")
    sheet.paste(tile,((frame%4)*400,(frame//4)*500))
sheet.save(ROOT / "sources/pose-guide-side.png")
