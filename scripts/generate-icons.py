"""Regenerate the native geometric app icons (Pillow, development only)."""
from pathlib import Path
from PIL import Image, ImageDraw
out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for name, size in [('icon-192.png',192),('icon-512.png',512),('maskable-512.png',512),('apple-touch-icon.png',180)]:
    im = Image.new('RGB', (size,size), '#141c17')
    d = ImageDraw.Draw(im)
    s = size / 128
    def box(coords, radius=5, width=3):
        d.rounded_rectangle(tuple(round(x*s) for x in coords), radius=round(radius*s), outline='#c5f476', width=round(width*s))
    box((43,31,87,95),4,3)
    box((33,36,77,100),4,3)
    for pts in [[(23,43),(23,23),(43,23)],[(85,23),(105,23),(105,43)],[(23,85),(23,105),(43,105)],[(85,105),(105,105),(105,85)]]:
        d.line([(round(x*s),round(y*s)) for x,y in pts],fill='#c5f476',width=round(3*s))
    im.save(out/name)
