#!/usr/bin/env python3
"""Real photos for the Solar system view and the sky map  ->  ../web/assets/

    python fetch_planets.py                    # all planets + Sun + Milky Way panorama (needs internet)
    python fetch_planets.py --only saturn,mars # just some
    python fetch_planets.py --no-milkyway

Sources are NASA / ESA / ESO images hosted on Wikimedia Commons (free to use with credit; credits are
written to web/assets/credits.json and shown in the app). Each planet photo is cropped to the body and
turned into a transparent 256x256 PNG, so rings and limbs sit cleanly on the dark background.

Don't like one, or a download fails? Save any photo as raw/planets/<name>.jpg (or .png) and re-run:
local files are used first. Names: sun mercury venus earth mars jupiter saturn uranus neptune milkyway
"""
import argparse, io, json, os, sys, time
from urllib.parse import quote

import numpy as np
import requests
from PIL import Image, ImageFilter

UA = {"User-Agent": "SPHEREx-blink-spaceapps/1.0 (student project; image fetch script)"}
COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/{}?width={}"

# name -> (candidate Commons file names tried in order, credit)
SOURCES = {
    "sun": (["The_Sun_by_the_Atmospheric_Imaging_Assembly_of_NASA's_Solar_Dynamics_Observatory_-_20100819.jpg", "Sun_920607.jpg"], "NASA/SDO (AIA)"),
    "mercury": (["Mercury_in_color_-_Prockter07-edit1.jpg", "Mercury_in_true_color.jpg"], "NASA/JHUAPL/Carnegie Institution (MESSENGER)"),
    "venus": (["Venus-real_color.jpg", "Venus_from_Mariner_10.jpg"], "NASA/JPL (Mariner 10)"),
    "earth": (["The_Earth_seen_from_Apollo_17.jpg", "The_Blue_Marble_(remastered).jpg"], "NASA (Apollo 17 crew)"),
    "mars": (["OSIRIS_Mars_true_color.jpg", "Mars_Hubble.jpg"], "ESA & MPS for the OSIRIS Team (Rosetta); CC BY-SA IGO 3.0"),
    "jupiter": (["Jupiter_and_its_shrunken_Great_Red_Spot.jpg", "Jupiter_by_Cassini-Huygens.jpg"], "NASA, ESA, A. Simon (GSFC)"),
    "saturn": (["Saturn_during_Equinox.jpg", "Saturn_from_Cassini_Orbiter_(2004-10-06).jpg"], "NASA/JPL/Space Science Institute (Cassini)"),
    "uranus": (["Uranus2.jpg", "Uranus_as_seen_by_NASA's_Voyager_2_(remastered).png"], "NASA/JPL-Caltech (Voyager 2)"),
    "neptune": (["Neptune_Full.jpg", "Neptune_-_Voyager_2_(29347980845)_flatten_crop.jpg"], "NASA/JPL (Voyager 2)"),
}
MILKYWAY = (["ESO_-_Milky_Way.jpg"], "ESO/S. Brunier, CC BY 4.0")


def fetch(names, width):
    """Download the first candidate that works. Returns (PIL image, file name) or (None, None)."""
    for name in names:
        url = COMMONS.format(quote(name, safe="()'_-.,"), width)
        for attempt in range(4):
            try:
                r = requests.get(url, headers=UA, timeout=(20, 120))
                if r.status_code == 429:
                    time.sleep(8 * (attempt + 1)); continue
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
                    Image.MAX_IMAGE_PIXELS = None
                    return Image.open(io.BytesIO(r.content)).convert("RGB"), name
                break
            except requests.RequestException:
                time.sleep(3)
    return None, None


def local(name, root):
    for ext in ("jpg", "jpeg", "png"):
        p = os.path.join(root, f"{name}.{ext}")
        if os.path.exists(p):
            Image.MAX_IMAGE_PIXELS = None
            return Image.open(p).convert("RGB"), p
    return None, None


def make_sprite(img, size=256):
    """Crop to the bright body (rings included), pad, resize, and turn black space into transparency."""
    a = np.asarray(img, dtype=np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    ys, xs = np.where(lum > 22)
    if len(xs) < 50:
        ys, xs = np.mgrid[0:lum.shape[0], 0:lum.shape[1]]; ys, xs = ys.ravel(), xs.ravel()
    x0, x1, y0, y1 = np.percentile(xs, 0.2), np.percentile(xs, 99.8), np.percentile(ys, 0.2), np.percentile(ys, 99.8)
    side = max(x1 - x0, y1 - y0) * 1.06
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2))
    canvas = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), (0, 0, 0))
    canvas.paste(img, (-box[0], -box[1]))
    sp = canvas.resize((size, size), Image.LANCZOS)
    l2 = np.asarray(sp, dtype=np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mask = Image.fromarray(((l2 > 14) * 255).astype(np.uint8))
    mask = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(1.1))  # close holes, soften edge
    out = sp.convert("RGBA"); out.putalpha(mask)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="", help="comma list, e.g. saturn,mars")
    p.add_argument("--no-milkyway", action="store_true")
    p.add_argument("--raw", default=os.path.join("raw", "planets"))
    p.add_argument("--out", default=os.path.join("..", "web", "assets"))
    a = p.parse_args()
    only = [s for s in a.only.split(",") if s]
    os.makedirs(os.path.join(a.out, "planets"), exist_ok=True)
    cpath = os.path.join(a.out, "credits.json")
    credits = json.load(open(cpath)) if os.path.exists(cpath) else {"planets": {}}
    failed = []

    for name, (cands, credit) in SOURCES.items():
        if only and name not in only:
            continue
        img, src = local(name, a.raw)
        if img is None:
            img, src = fetch(cands, 1400)
        if img is None:
            print(f"  FAILED  {name}: no download worked - save a photo as raw/planets/{name}.jpg and re-run"); failed.append(name); continue
        make_sprite(img).save(os.path.join(a.out, "planets", f"{name}.png"), optimize=True)
        credits["planets"][name] = {"credit": credit, "source": str(src)}
        print(f"  ok      {name:8s} <- {src}")

    if not a.no_milkyway and (not only or "milkyway" in only):
        img, src = local("milkyway", a.raw)
        if img is None:
            img, src = fetch(MILKYWAY[0], 4096)
        if img is None:
            print("  FAILED  milkyway: save a galactic-coordinate panorama as raw/planets/milkyway.jpg and re-run"); failed.append("milkyway")
        else:
            w = 4096; img = img.resize((w, w // 2), Image.LANCZOS) if img.width != w else img
            img.save(os.path.join(a.out, "milkyway.jpg"), quality=86, optimize=True)
            credits["milkyway"] = {"credit": MILKYWAY[1], "source": str(src)}
            print(f"  ok      milkyway <- {src}  (centre of the image must be the galactic centre)")

    json.dump(credits, open(cpath, "w"), indent=1)
    print("\nDone." + (f" Missing: {', '.join(failed)}" if failed else " Open the website and look at Planet X -> Solar system."))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
