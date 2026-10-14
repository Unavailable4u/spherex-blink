#!/usr/bin/env python3
"""Circle the known asteroid position on every tile, to check the target is in the data.

    python mark_target.py --region pallas

Reads raw/<region>/region.json (obj_ra/obj_dec per frame, from JPL Horizons) plus
../web/tiles/<region>/manifest.json + wcs.json, then writes
../web/tiles/<region>/previews/marked_<region>.png  (all frames, time order, circled).
"""
import argparse, json, os, sys
import numpy as np
from astropy.wcs import WCS
from PIL import Image, ImageDraw


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--region", required=True)
    p.add_argument("--raw-root", default="raw")
    p.add_argument("--tiles-root", default=os.path.join("..", "web", "tiles"))
    p.add_argument("--cols", type=int, default=5)
    p.add_argument("--scale", type=float, default=0.5)
    a = p.parse_args()

    tdir = os.path.join(a.tiles_root, a.region)
    man = json.load(open(os.path.join(tdir, "manifest.json")))
    wj = json.load(open(os.path.join(tdir, "wcs.json")))
    obj = {f["file"]: (f["obj_ra"], f["obj_dec"])
           for f in json.load(open(os.path.join(a.raw_root, a.region, "region.json")))["files"]}

    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval, w.wcs.crpix, w.wcs.cdelt = wj["crval"], wj["crpix"], wj["cdelt"]
    n = wj["height"]

    frames = sorted(man["frames"], key=lambda f: f["mjd"])
    tiles, rows = [], []
    for f in frames:
        src = os.path.basename(f["source"])
        im = Image.open(os.path.join(tdir, f["path"])).convert("RGB")
        if src not in obj:
            print(f"{f['id']}: no target position"); continue
        x0, y0 = (float(v) for v in w.world_to_pixel_values(*obj[src]))
        col, row = x0, (n - 1) - y0
        inside = 0 <= col < n and 0 <= row < n
        print(f"{f['id']} {f['band']}: target at col {col:7.1f} row {row:7.1f}  {'' if inside else 'OUTSIDE tile'}")
        d = ImageDraw.Draw(im)
        if inside:
            d.ellipse([col - 14, row - 14, col + 14, row + 14], outline=(255, 40, 40), width=2)
        d.text((4, 4), f"{f['id']} {f['band']}", fill=(255, 255, 0))
        tiles.append(im.resize((int(n * a.scale),) * 2)); rows.append(inside)
    if not tiles:
        sys.exit("nothing to draw")
    s = tiles[0].width; c = min(a.cols, len(tiles)); r = -(-len(tiles) // c)
    sheet = Image.new("RGB", (c * (s + 4), r * (s + 4)), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % c) * (s + 4), (i // c) * (s + 4)))
    out = os.path.join(tdir, "previews", f"marked_{a.region}.png")
    sheet.save(out)
    print(f"\n{sum(rows)}/{len(rows)} frames contain the target. Wrote {out}")


if __name__ == "__main__":
    main()
