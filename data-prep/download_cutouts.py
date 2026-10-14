#!/usr/bin/env python3
"""Download SPHEREx FITS cutouts for one region (needs internet + IRSA).

Two modes
---------
1) Moving-target mode (default when raw/<region>/candidates.json exists):
       python find_target.py --target Pallas --start 2025-09-01 --end 2025-10-15
       python download_cutouts.py --region pallas
   Downloads one cutout for EVERY image that contains the asteroid, all centred on
   the same fixed sky position, so the asteroid drifts across the field over time.

2) Fixed-position mode (the original behaviour): one best image per epoch x band.
       python download_cutouts.py --region m101 --ra 210.80227 --dec 54.34895 --size 0.1

Where the data comes from (--source)
------------------------------------
  s3    (default) IRSA's public AWS copy, s3://nasa-irsa-spherex/qr2/level2/ - no account,
        no credentials. S3 has no cutout service, so each FULL exposure is downloaded
        and cropped locally (crop_fits). Used because IRSA's cutout server keeps
        answering HTTP 503.
  irsa  the original cutout service (small downloads, but the server is flaky).
  auto  try s3, fall back to irsa for any frame where s3 fails.

  python download_cutouts.py --region pallas --check     # HEAD-test every S3 key, download nothing

Files land in raw/<region>/ (git-ignored). A region.json with the field centre and
size is written next to them so fits_to_png.py knows what to build.
"""
import argparse
import json
import os
import re
import sys
import time
import warnings

import numpy as np
import requests

UA = {"User-Agent": "spherex-blink-hackathon/0.2"}


def fetch(url, path, tries=3):
    """Download url -> path with retries. Returns size in KB or raises."""
    last = None
    for attempt in range(1, tries + 1):
        try:
            r = requests.get(url, headers=UA, timeout=(30, 300))
            r.raise_for_status()
            with open(path + ".part", "wb") as f:
                f.write(r.content)
            os.replace(path + ".part", path)
            return len(r.content) // 1024
        except Exception as ex:  # noqa: BLE001 - report and retry
            last = ex
            time.sleep(5 * attempt)
    raise last


def cutout_url(access_url, ra, dec, size_deg, margin):
    """Ask for a cutout `margin` times bigger than the field we will build.

    Every SPHEREx exposure has its own roll angle. A cutout exactly the size of the
    field would leave empty corners once it is rotated onto the shared grid, so we
    over-request (sqrt(2) ~ 1.41 covers any rotation) and crop in fits_to_png.py.
    """
    return f"{access_url}?center={ra},{dec}d&size={round(size_deg * margin, 4)}deg"


S3_BUCKET = "nasa-irsa-spherex"
S3_HOST = f"https://{S3_BUCKET}.s3.amazonaws.com"
# access_url looks like  https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/<week>/<ver>/<det>/level2_....fits
# and the S3 key is everything from "qr2/" onwards.
_KEY_RE = re.compile(r"(qr\d+/level2/[^?#]+\.fits)", re.I)


def s3_key(access_url):
    """Map an IRSA access_url onto its key in the public S3 bucket (None if it doesn't match)."""
    m = _KEY_RE.search(str(access_url))
    return m.group(1) if m else None


def s3_head(key):
    """(status_code, size_bytes_or_None) for a key, using anonymous HTTPS."""
    r = requests.head(f"{S3_HOST}/{key}", headers=UA, timeout=(15, 30), allow_redirects=True)
    size = r.headers.get("Content-Length")
    return r.status_code, int(size) if size else None


def fetch_stream(url, path, tries=3):
    """Download a (large) url -> path in 1 MB chunks with retries. Returns size in MB."""
    last = None
    for attempt in range(1, tries + 1):
        try:
            with requests.get(url, headers=UA, timeout=(30, 300), stream=True) as r:
                r.raise_for_status()
                total = 0
                with open(path + ".part", "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                        total += len(chunk)
            os.replace(path + ".part", path)
            return total / 1e6
        except Exception as ex:  # noqa: BLE001
            last = ex
            if isinstance(ex, requests.HTTPError) and ex.response is not None \
                    and ex.response.status_code in (403, 404):
                raise  # a wrong key will not fix itself on retry
            time.sleep(5 * attempt)
    raise last


def crop_fits(src, dst, ra, dec, size_deg):
    """Crop a full SPHEREx L2 exposure to a square box around (ra, dec).

    Keeps what fits_to_png.load_frame needs: the primary header, the IMAGE extension
    (cropped, WCS shifted) and the WCS-WAVE lookup table(s). Both the spatial WCS and the
    wavelength WCS (alternate 'W') are defined relative to CRPIX, so shifting CRPIX by the
    crop offset keeps them exactly right - SIP distortion terms are relative to CRPIX too.
    Returns (width, height) of the crop in pixels.
    """
    from astropy.io import fits
    from astropy.wcs import WCS, FITSFixedWarning
    from astropy.wcs.utils import proj_plane_pixel_scales

    warnings.filterwarnings("ignore", category=FITSFixedWarning)
    with fits.open(src, memmap=True) as hdul:
        names = [h.name.upper() for h in hdul]
        img = hdul["IMAGE"] if "IMAGE" in names else next(
            h for h in hdul if h.is_image and h.data is not None and h.data.ndim == 2)
        ny, nx = img.shape
        wcs = WCS(img.header)
        scale = float(np.mean(proj_plane_pixel_scales(wcs)))        # deg / pixel
        cx, cy = (float(v) for v in wcs.all_world2pix(ra, dec, 0))   # 0-based pixel of the field centre
        half = int(np.ceil(size_deg / scale / 2))
        x0, x1 = max(0, int(round(cx)) - half), min(nx, int(round(cx)) + half + 1)
        y0, y1 = max(0, int(round(cy)) - half), min(ny, int(round(cy)) + half + 1)
        if x1 - x0 < 8 or y1 - y0 < 8:
            raise ValueError(f"field centre is outside this exposure (pixel {cx:.0f},{cy:.0f} of {nx}x{ny})")

        hdr = img.header.copy()
        for key in ("1", "2"):
            off = x0 if key == "1" else y0
            for suffix in ("", "W"):
                name = f"CRPIX{key}{suffix}"
                if name in hdr:
                    hdr[name] = float(hdr[name]) - off
        hdr["HISTORY"] = f"Cropped from {nx}x{ny} to x{x0}:{x1} y{y0}:{y1} by download_cutouts.py"
        sub = np.array(img.section[y0:y1, x0:x1], dtype=np.float32)
        out = fits.HDUList([hdul[0].copy(), fits.ImageHDU(data=sub, header=hdr, name="IMAGE")])
        for h in hdul:
            if isinstance(h, (fits.BinTableHDU, fits.TableHDU)):
                out.append(h.copy())
        out.writeto(dst + ".part", overwrite=True)
    os.replace(dst + ".part", dst)
    return x1 - x0, y1 - y0


def get_cutout(access_url, path, ra, dec, size, margin, args):
    """Produce the cutout FITS at `path` using args.source. Returns a short status string."""
    src = args.source
    if src in ("s3", "auto"):
        key = s3_key(access_url)
        try:
            if key is None:
                raise ValueError(f"can't derive an S3 key from {access_url}")
            cache = os.path.join(args.out_root, "_s3cache", key.replace("/", "__"))
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            if not os.path.exists(cache):
                mb = fetch_stream(f"{S3_HOST}/{key}", cache)
            else:
                mb = os.path.getsize(cache) / 1e6
            w, h = crop_fits(cache, path, ra, dec, size * margin)
            if not args.keep_full:
                os.remove(cache)
            return f"S3 {mb:.0f} MB -> cropped {w}x{h} px"
        except Exception as ex:  # noqa: BLE001
            if src == "s3":
                raise
            print(f"   s3 failed ({type(ex).__name__}: {ex}); trying IRSA cutout service")
    kb = fetch(cutout_url(access_url, ra, dec, size, margin), path)
    return f"IRSA cutout {kb} KB"


def check_s3(images):
    """--check: HEAD every S3 key so the access_url -> key mapping is verified before downloading."""
    bad = 0
    for c in images:
        key = s3_key(c["access_url"])
        if key is None:
            print(f"NO KEY   {c['access_url']}")
            bad += 1
            continue
        try:
            code, size = s3_head(key)
        except Exception as ex:  # noqa: BLE001
            code, size = type(ex).__name__, None
        ok = code == 200
        bad += not ok
        print(f"{'OK ' if ok else 'BAD'} {code}  {'' if size is None else f'{size/1e6:6.1f} MB'}  {key}")
    print(f"\n{len(images) - bad}/{len(images)} keys reachable")
    return bad


def write_region(out_root, region, ra, dec, size, mode, files, margin):
    folder = os.path.join(out_root, region)
    with open(os.path.join(folder, "region.json"), "w") as f:
        json.dump({"region": region, "ra": ra, "dec": dec, "size_deg": size,
                   "cutout_size_deg": round(size * margin, 4),
                   "mode": mode, "files": files}, f, indent=2)


def run_candidates(args):
    cpath = os.path.join(args.out_root, args.region, "candidates.json")
    with open(cpath) as f:
        data = json.load(f)
    field = data["field"]
    ra = args.ra if args.ra is not None else field["ra"]
    dec = args.dec if args.dec is not None else field["dec"]
    size = args.size if args.size is not None else field["size_deg"]
    images = data["images"]
    if args.bands:
        want = {b.strip().upper() for b in args.bands.split(",")}
        images = [c for c in images if f"D{c['detector']}" in want]
    if args.max_frames and len(images) > args.max_frames:
        idx = np.unique(np.linspace(0, len(images) - 1, args.max_frames).round().astype(int))
        images = [images[i] for i in idx]
    folder = os.path.join(args.out_root, args.region)
    print(f"{len(images)} images, field RA {ra} Dec {dec}, size {size} deg "
          f"(downloading {round(size * args.margin, 3)} deg cutouts)")
    if args.check:
        return check_s3(images)
    files, failed = [], 0
    for c in images:
        band = c["band"].replace("SPHEREx-", "")
        stamp = c["utc"].replace(":", "").replace("-", "")[:13]   # 20250914T0312
        name = f"{band}_{stamp}.fits"
        path = os.path.join(folder, name)
        if os.path.exists(path):
            print(f"{name}: already have it")
        else:
            try:
                how = get_cutout(c["access_url"], path, ra, dec, size, args.margin, args)
                print(f"{name}: {how}  (object at {c['obj_ra']:.4f}, {c['obj_dec']:.4f})")
            except Exception as ex:  # noqa: BLE001
                failed += 1
                print(f"{name}: FAILED {type(ex).__name__}: {ex}")
                continue
        files.append({"file": name, "mjd": c["mjd"], "band": band,
                      "obj_ra": c["obj_ra"], "obj_dec": c["obj_dec"]})
    write_region(args.out_root, args.region, ra, dec, size, "candidates", files, args.margin)
    return failed


def run_best_per_epoch(args):
    import astropy.units as u
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    from astroquery.ipac.irsa import Irsa

    if args.ra is None or args.dec is None:
        raise SystemExit("Fixed-position mode needs --ra and --dec (degrees).")
    size = args.size if args.size is not None else 0.1
    coord = SkyCoord(ra=args.ra, dec=args.dec, unit="deg")
    res = Irsa.query_sia(pos=(coord, 0.05 * u.deg), collection=args.collection)

    # Sort by time and label epochs (new epoch after a gap > 30 days)
    t = Time(np.array(res["t_min"], dtype=float), format="mjd")
    order = np.argsort(t.mjd)
    res, t = res[order], t[order]
    epoch = np.zeros(len(t), dtype=int)
    epoch[1:] = np.cumsum(np.diff(t.mjd) > 30)
    epoch += 1

    centers = SkyCoord(np.array(res["s_ra"]) * u.deg, np.array(res["s_dec"]) * u.deg)
    sep = centers.separation(coord).deg
    bands = sorted(set(str(b) for b in res["energy_bandpassname"]))
    folder = os.path.join(args.out_root, args.region)
    files, failed = [], 0
    for e in sorted(set(epoch)):
        for b in bands:
            idx = [i for i in range(len(res))
                   if epoch[i] == e and str(res["energy_bandpassname"][i]) == b]
            if not idx:
                print(f"epoch {e} {b}: no images")
                continue
            best = min(idx, key=lambda i: sep[i])
            sub = os.path.join(folder, f"epoch{e}")
            os.makedirs(sub, exist_ok=True)
            name = f"epoch{e}/{b}.fits"
            path = os.path.join(sub, f"{b}.fits")
            if os.path.exists(path):
                print(f"epoch {e} {b}: already have it")
            else:
                try:
                    how = get_cutout(str(res["access_url"][best]), path, args.ra, args.dec,
                                     size, args.margin, args)
                    print(f"epoch {e} {b}: {how} ({t[best].iso[:10]})")
                except Exception as ex:  # noqa: BLE001
                    failed += 1
                    print(f"epoch {e} {b}: FAILED {type(ex).__name__}: {ex}")
                    continue
            files.append({"file": name, "mjd": float(t[best].mjd), "band": b.replace("SPHEREx-", "")})
    write_region(args.out_root, args.region, args.ra, args.dec, size, "best-per-epoch", files, args.margin)
    return failed


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", required=True, help="folder name under raw/")
    p.add_argument("--ra", type=float, help="field centre RA, deg")
    p.add_argument("--dec", type=float, help="field centre Dec, deg")
    p.add_argument("--size", type=float, help="field size, deg (default: from candidates, else 0.1)")
    p.add_argument("--mode", choices=["auto", "candidates", "best"], default="auto")
    p.add_argument("--bands", help="candidates mode: only these detectors, e.g. D2,D4")
    p.add_argument("--max-frames", type=int,
                   help="candidates mode: cap the number of downloads (evenly spread in time)")
    p.add_argument("--margin", type=float, default=1.45,
                   help="download cutouts this many times larger than --size so rotated "
                        "frames still cover the whole field (default 1.45)")
    p.add_argument("--source", choices=["s3", "irsa", "auto"], default="s3",
                   help="s3 = IRSA's public AWS bucket + local crop (default); irsa = cutout "
                        "service; auto = s3 then irsa")
    p.add_argument("--check", action="store_true",
                   help="candidates mode: only HEAD-test the S3 keys, download nothing")
    p.add_argument("--keep-full", action="store_true",
                   help="keep the full exposures in raw/_s3cache/ (tens of MB each) so a re-crop "
                        "with another --size/--margin needs no re-download")
    p.add_argument("--collection", default="spherex_qr2")
    p.add_argument("--out-root", default="raw")
    args = p.parse_args(argv)

    cpath = os.path.join(args.out_root, args.region, "candidates.json")
    mode = args.mode
    if mode == "auto":
        mode = "candidates" if os.path.exists(cpath) else "best"
    os.makedirs(os.path.join(args.out_root, args.region), exist_ok=True)
    print(f"Mode: {mode}")
    failed = run_candidates(args) if mode == "candidates" else run_best_per_epoch(args)
    if args.check:
        return 1 if failed else 0
    if failed:
        print(f"\n{failed} downloads failed - rerun the same command; finished files are skipped.")
        return 1
    print(f"\nDone. Next:  python fits_to_png.py --region {args.region}")
    return 0


if __name__ == "__main__":
    sys.exit(main())