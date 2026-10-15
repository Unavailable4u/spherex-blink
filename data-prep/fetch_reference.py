#!/usr/bin/env python3
"""Reference images on the SAME sky grid as a region's SPHEREx tiles -> ../web/tiles/<region>/ref/

    python fetch_reference.py --region m101
    python fetch_reference.py --region m101 --hubble-fits raw/hubble/m101_f555w_drz.fits \
        --hubble-credit "NASA, ESA, STScI"

* DSS2 optical, 2MASS near-IR and WISE mid-IR come from CDS hips2fits (needs internet, no account).
* --hubble-fits reprojects a Hubble drizzled FITS (download from MAST; the big file stays on your disk)
  onto the tile grid and saves ref/hubble.jpg. Use the credit line MAST / ESA-Hubble gives for that image.
The site only ships the small 1024x1024 JPEGs. Writes ref/ref.json, which the web app reads.
"""
import argparse, io, json, os, sys, urllib.parse, urllib.request
import numpy as np

HIPS = "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"
LAYERS = [
    ("dss2", "DSS2 optical", "CDS/P/DSS2/color", "Digitized Sky Survey, STScI/NASA, via CDS hips2fits"),
    ("2mass", "2MASS near-infrared", "CDS/P/2MASS/color", "2MASS, UMass / IPAC-Caltech / NASA / NSF, via CDS hips2fits"),
    ("wise", "WISE mid-infrared", "CDS/P/allWISE/color", "WISE, NASA / JPL-Caltech, via CDS hips2fits"),
]


def fetch_hips(hips, ra, dec, fov, size):
    import requests
    r = requests.get(HIPS, timeout=90, headers={"User-Agent": "spherex-blink/1.0"},
                     params={"hips": hips, "width": size, "height": size, "fov": fov,
                             "projection": "TAN", "coordsys": "icrs", "ra": ra, "dec": dec, "format": "jpg"})
    r.raise_for_status()
    return r.content


def hubble_to_grid(path, wj, out):
    from astropy.io import fits
    from astropy.wcs import WCS
    from reproject import reproject_interp
    from PIL import Image
    hdul = fits.open(path)
    hdu = next(h for h in hdul if h.data is not None and h.data.ndim == 2)     # first 2-D image extension
    tgt = WCS(naxis=2)
    tgt.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    tgt.wcs.crval, tgt.wcs.crpix, tgt.wcs.cdelt = wj["crval"], wj["crpix"], wj["cdelt"]
    arr, foot = reproject_interp(hdu, tgt, shape_out=(wj["height"], wj["width"]))
    ok = np.isfinite(arr) & (foot > 0)
    if not ok.any():
        sys.exit("The Hubble image does not overlap this region's field.")
    lo, hi = np.percentile(arr[ok], [5, 99.7])
    y = np.arcsinh(np.clip((np.nan_to_num(arr, nan=lo) - lo) / (hi - lo), 0, 1) * 10) / np.arcsinh(10)
    img = (np.flipud(y) * 255).astype(np.uint8)                                 # FITS y runs north; PNG row 0 is the top
    Image.fromarray(img).save(out, quality=92)
    print(f"hubble: covers {ok.mean() * 100:.0f}% of the field")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--region", required=True)
    p.add_argument("--tiles-root", default=os.path.join("..", "web", "tiles"))
    p.add_argument("--hubble-fits")
    p.add_argument("--hubble-credit", default="NASA, ESA, STScI")
    p.add_argument("--skip-hips", action="store_true")
    a = p.parse_args()
    tdir = os.path.join(a.tiles_root, a.region)
    wj = json.load(open(os.path.join(tdir, "wcs.json")))
    rdir = os.path.join(tdir, "ref"); os.makedirs(rdir, exist_ok=True)
    rj = os.path.join(rdir, "ref.json")
    have = {l["id"]: l for l in json.load(open(rj))["layers"]} if os.path.exists(rj) else {}
    if not a.skip_hips:
        for lid, label, hips, credit in LAYERS:
            try:
                data = fetch_hips(hips, wj["crval"][0], wj["crval"][1], wj["size_deg"], wj["width"])
                open(os.path.join(rdir, lid + ".jpg"), "wb").write(data)
                have[lid] = {"id": lid, "label": label, "file": lid + ".jpg", "credit": credit}
                print("ok  ", lid, f"{len(data) // 1024} KB")
            except Exception as e:                                               # a layer with no coverage is fine
                print("skip", lid, "-", e)
    if a.hubble_fits:
        hubble_to_grid(a.hubble_fits, wj, os.path.join(rdir, "hubble.jpg"))
        have["hubble"] = {"id": "hubble", "label": "Hubble (HST)", "file": "hubble.jpg", "credit": a.hubble_credit}
    order = ["hubble", "dss2", "2mass", "wise"]
    json.dump({"layers": [have[k] for k in order if k in have]}, open(rj, "w"), indent=1)
    print("wrote", rj)


if __name__ == "__main__":
    main()
