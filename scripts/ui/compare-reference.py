#!/usr/bin/env python3
"""Compare equal-size UI captures without resizing or silently hiding differences.
Requires Pillow. Output includes a pixel diff and reproducible JSON measurements;
small pixel error does not prove interaction or service parity.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageEnhance, ImageStat, ImageDraw


def compare(reference, candidate, output, masks=None):
    def read_opaque(path):
        with Image.open(path) as image:
            rgba=image.convert('RGBA')
            if rgba.getchannel('A').getextrema() != (255,255):
                raise ValueError('Transparent captures require an explicit matching compositing background; refusing to discard alpha')
            return rgba.convert('RGB')
    first=read_opaque(reference)
    second=read_opaque(candidate)
    if first.size != second.size:
        raise ValueError(f'Capture sizes differ: {first.size} vs {second.size}; no automatic resizing is allowed')
    include=Image.new('L',first.size,255)
    for region in masks or []:
        if not region.get('reason') or not region.get('name'):
            raise ValueError('Each optional mask needs a name and reason')
        x,y,w,h=region['rect']
        if any(type(v) is not int for v in (x,y,w,h)) or x<0 or y<0 or w<1 or h<1 or x+w>first.width or y+h>first.height:
            raise ValueError('Mask is outside the image')
        ImageDraw.Draw(include).rectangle((x,y,x+w-1,y+h-1),fill=0)
    pixels=include.histogram()[255]
    if not pixels:
        raise ValueError('Masks hide the entire image')
    raw=ImageChops.difference(first,second)
    stats=ImageStat.Stat(raw,include)
    # Exact RGB comparison; no threshold quietly forgives icon/font differences.
    red,green,blue=raw.split()
    changed_mask=ImageChops.lighter(ImageChops.lighter(red,green),blue).point(lambda value: 255 if value else 0)
    changed=ImageChops.multiply(changed_mask,include).histogram()[255]
    output.mkdir(parents=True,exist_ok=True)
    ImageEnhance.Brightness(raw).enhance(4).save(output/'difference.png')
    report={'schema_version':1,'reference_sha256':hashlib.sha256(Path(reference).read_bytes()).hexdigest(),
        'candidate_sha256':hashlib.sha256(Path(candidate).read_bytes()).hexdigest(),
        'width':first.width,'height':first.height,'compared_pixels':pixels,'different_pixels':changed,
        'mean_absolute_rgb_error':stats.mean,'masks':masks or [],
        'scope':'Pixel comparison only. Does not verify behavior; no parity percentage or automatic pass is assigned.'}
    (output/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference',type=Path);parser.add_argument('candidate',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--masks',type=Path,help='Optional explicit [{name,reason,rect:[x,y,width,height]}]')
    args=parser.parse_args()
    print(json.dumps(compare(args.reference,args.candidate,args.output,json.loads(args.masks.read_text()) if args.masks else None),indent=2))
