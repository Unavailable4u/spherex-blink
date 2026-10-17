#!/usr/bin/env python3
"""Reality check: is the catalogued target really a moving source in the tiles?

    python verify_target.py --region pallas        # -> ../web/tiles/pallas/validation.json

For every frame this takes the ephemeris position of the known object (sky.json), finds the
brightest blob within a few pixels of it, and asks three questions:

  1. Is there a source there?              peak / local noise (robust, MAD based)
  2. How well does it sit on the position? centroid minus prediction, in pixels
  3. Is it a MOVER and not a star?         the same pixel must be (nearly) empty in the other
                                           frames of the band, i.e. the source left

The numbers are written to validation.json and shown in the app (Context tab), so a visitor can
see that the overlay is not decoration. The scatter of (centroid - prediction) is also the best
empirical estimate of how precisely a click on a source can be placed: the app uses it as the
error bar in the "Measure a mover" tool.

Needs only numpy, scipy and pillow (no astropy): the TAN projection is re-implemented from wcs.json.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

D = np.pi / 180


class Tan:
    def __init__(self, j):
        self.a0, self.d0 = j["crval"][0] * D, j["crval"][1] * D
        self.px, self.py = j["crpix"]
        self.sx, self.sy = j["cdelt"]
        self.h = j["height"]

    def to_pix(self, ra, dec):
        a, d = ra * D, dec * D
        da = a - self.a0
        cc = np.sin(self.d0) * np.sin(d) + np.cos(self.d0) * np.cos(d) * np.cos(da)
        xi = np.cos(d) * np.sin(da) / cc
        eta = (np.cos(self.d0) * np.sin(d) - np.sin(self.d0) * np.cos(d) * np.cos(da)) / cc
        return xi / (self.sx * D) + self.px - 1, self.h - (eta / (self.sy * D) + self.py)


def centroid(img, c, r, half=4):
    """Intensity-weighted centroid of the blob nearest (c, r), background removed."""
    ci, ri = int(round(c)), int(round(r))
    h, w = img.shape
    r0, r1, c0, c1 = max(0, ri - 6), min(h, ri + 7), max(0, ci - 6), min(w, ci + 7)
    sub = ndi.gaussian_filter(img[r0:r1, c0:c1], 1.2)
    k = np.unravel_index(np.argmax(sub), sub.shape)
    pr, pc = r0 + k[0], c0 + k[1]
    r0, r1, c0, c1 = max(0, pr - half), min(h, pr + half + 1), max(0, pc - half), min(w, pc + half + 1)
    win = img[r0:r1, c0:c1]
    bkg = np.percentile(win, 20)
    wgt = np.clip(win - bkg, 0, None)
    if wgt.sum() <= 0:
        return float(pc), float(pr)
    rr, cc = np.mgrid[r0:r1, c0:c1]
    return float((wgt * cc).sum() / wgt.sum()), float((wgt * rr).sum() / wgt.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--tiles-root", default=os.path.join("..", "web", "tiles"))
    a = ap.parse_args()
    d = os.path.join(a.tiles_root, a.region)
    sky_p = os.path.join(d, "sky.json")
    if not os.path.exists(sky_p):
        print(f"{sky_p} not found: run solar_system.py first.")
        return 1
    sky = json.load(open(sky_p))
    man = json.load(open(os.path.join(d, "manifest.json")))
    wcs = Tan(json.load(open(os.path.join(d, "wcs.json"))))
    target = sky.get("target") or {}
    if not target:
        print("sky.json has no target positions; nothing to verify.")
        return 1
    pixscale = sky["field"]["pixscale_arcsec"]

    imgs = {f["id"]: np.array(Image.open(os.path.join(d, f["path"])).convert("L"), dtype=float) for f in man["frames"]}
    out_frames, offs = {}, []
    for f in sorted(man["frames"], key=lambda f: f["mjd"]):
        if f["id"] not in target:
            continue
        img = imgs[f["id"]]
        h, w = img.shape
        c, r = wcs.to_pix(*target[f["id"]])
        inside = 8 <= c < w - 8 and 8 <= r < h - 8
        rec = {"band": f["band"], "pred": [round(float(c), 2), round(float(r), 2)], "in_tile": bool(inside)}
        if inside:
            ci, ri = int(round(c)), int(round(r))
            win = img[max(0, ri - 40):ri + 41, max(0, ci - 40):ci + 41]
            med = float(np.median(win))
            mad = float(np.median(np.abs(win - med))) * 1.4826 or 1.0
            cx, cy = centroid(img, c, r)
            off = float(np.hypot(cx - c, cy - r))
            peak = float(img[max(0, ri - 3):ri + 4, max(0, ci - 3):ci + 4].max())
            # does the source leave? value at this pixel in the other frames of the same band
            others = [imgs[g["id"]][max(0, ri - 3):ri + 4, max(0, ci - 3):ci + 4].max()
                      for g in man["frames"] if g["band"] == f["band"] and g["mjd"] != f["mjd"]
                      and abs(g["mjd"] - f["mjd"]) > 0.5]   # frames minutes apart: the object has barely moved
            gone = bool(others) and float(np.median(others)) < 0.5 * peak
            rec.update({"centroid": [round(cx, 2), round(cy, 2)], "offset_px": round(off, 2),
                        "peak": peak, "median": med, "snr": round((peak - med) / mad, 1),
                        "detected": bool(peak > med + 5 * mad and off <= 3.0),
                        "absent_elsewhere": gone if others else None})
            offs.append(off)
        out_frames[f["id"]] = rec

    det = [v for v in out_frames.values() if v.get("detected")]
    checked = [v for v in out_frames.values() if v["in_tile"]]
    summary = {
        "target": sky.get("target_name"), "frames_checked": len(checked), "frames_detected": len(det),
        "median_offset_px": round(float(np.median(offs)), 2) if offs else None,
        "rms_offset_px": round(float(np.sqrt(np.mean(np.square(offs)))), 2) if offs else None,
        "max_offset_px": round(float(max(offs)), 2) if offs else None,
        "pixscale_arcsec": pixscale,
        "rms_offset_arcsec": round(float(np.sqrt(np.mean(np.square(offs)))) * pixscale, 1) if offs else None,
        "movers_confirmed": sum(1 for v in checked if v.get("absent_elsewhere")),
    }
    json.dump({"region": a.region, "summary": summary, "frames": out_frames}, open(os.path.join(d, "validation.json"), "w"), indent=1)
    from regions_util import add_extra
    add_extra(a.tiles_root, a.region, "validation")

    print(f"{summary['target']}: found in {summary['frames_detected']}/{summary['frames_checked']} frames")
    print(f"  offset from ephemeris: median {summary['median_offset_px']} px, rms {summary['rms_offset_px']} px "
          f"(= {summary['rms_offset_arcsec']} arcsec), max {summary['max_offset_px']} px")
    print(f"  source absent from the same pixel in the other frames: {summary['movers_confirmed']}/{summary['frames_checked']}")
    for fid, v in out_frames.items():
        if v["in_tile"]:
            print(f"  {fid} {v['band']}: snr {v['snr']:>6}  offset {v['offset_px']:.2f} px  "
                  f"{'detected' if v['detected'] else 'NOT DETECTED'}  {'moved away' if v['absent_elsewhere'] else ''}")
        else:
            print(f"  {fid} {v['band']}: outside the tile")
    return 0 if summary["frames_detected"] == summary["frames_checked"] else 2


if __name__ == "__main__":
    sys.exit(main())
