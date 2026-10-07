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

Files land in raw/<region>/ (git-ignored). A region.json with the field centre and
size is written next to them so fits_to_png.py knows what to build.
"""
import argparse
import json
import os
import sys
import time

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
                kb = fetch(cutout_url(c["access_url"], ra, dec, size, args.margin), path)
                print(f"{name}: saved {kb} KB  (object at {c['obj_ra']:.4f}, {c['obj_dec']:.4f})")
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
                    kb = fetch(cutout_url(res["access_url"][best], args.ra, args.dec, size, args.margin), path)
                    print(f"epoch {e} {b}: saved {kb} KB ({t[best].iso[:10]})")
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
    if failed:
        print(f"\n{failed} downloads failed - rerun the same command; finished files are skipped.")
        return 1
    print(f"\nDone. Next:  python fits_to_png.py --region {args.region}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
