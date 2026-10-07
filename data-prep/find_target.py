#!/usr/bin/env python3
"""Step 1 - find a real moving object that SPHEREx actually imaged.

Why this exists
---------------
A blink comparator only has something to show if an object really moves
between frames. This script takes a known asteroid, asks JPL Horizons where it
was on each day, and asks IRSA which SPHEREx images covered that spot on that
day. The result is a list of images that really contain the object, plus a
recommended cutout centre and size for the demo region.

Usage (needs internet: IRSA + JPL Horizons)
-------------------------------------------
    python find_target.py --target Pallas --start 2025-09-01 --end 2025-10-15
    python find_target.py --target 4 --start 2025-07-01 --end 2025-08-15 --region vesta

SPHEREx points roughly 90 degrees away from the Sun, so an asteroid is only
covered when it sits near quadrature. If a target returns nothing, try another
asteroid or another date range - this is expected, not a bug.

Output: raw/<region>/candidates.json  (read by download_cutouts.py)
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time

DEFAULT_COLLECTION = "spherex_qr2"


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "target"


def _col(table, name, default=np.nan):
    """Column as a float array with masked values turned into NaN."""
    if name not in table.colnames:
        return np.full(len(table), default, dtype=float)
    return np.asarray(np.ma.filled(np.ma.asarray(table[name], dtype=float), np.nan))


def horizons_positions(target, mjds, id_type="smallbody", chunk=40):
    """Apparent RA/Dec (deg), V mag, sky rate (arcsec/hr), elongation (deg).

    Geocentric ('500'): SPHEREx is in low Earth orbit, so the parallax error is a
    few arcsec for main-belt asteroids - about one SPHEREx pixel at worst.
    """
    from astroquery.jplhorizons import Horizons

    mjds = np.asarray(mjds, dtype=float)
    jds = Time(mjds, format="mjd", scale="utc").jd
    out = {k: [] for k in ("ra", "dec", "vmag", "rate", "elong")}
    for i in range(0, len(jds), chunk):
        part = [float(j) for j in jds[i:i + chunk]]
        eph = Horizons(id=str(target), id_type=id_type, location="500",
                       epochs=part).ephemerides()
        out["ra"].append(_col(eph, "RA"))
        out["dec"].append(_col(eph, "DEC"))
        out["vmag"].append(_col(eph, "V"))
        out["rate"].append(np.hypot(_col(eph, "RA_rate"), _col(eph, "DEC_rate")))
        out["elong"].append(_col(eph, "elong"))
    return {k: np.concatenate(v) for k, v in out.items()}


def query_images(coord, radius_deg, mjd_lo, mjd_hi, collection):
    from astroquery.ipac.irsa import Irsa

    return Irsa.query_sia(
        pos=(coord, radius_deg * u.deg),
        collection=collection,
        time=(Time(mjd_lo, format="mjd"), Time(mjd_hi, format="mjd")),
    )


def detector_from_name(name):
    m = re.search(r"D(\d)", str(name))
    return int(m.group(1)) if m else None


def find_candidates(target, start_mjd, end_mjd, step_days, radius_deg,
                    collection, id_type, log=print):
    """Return a list of dicts, one per SPHEREx image that covers the target."""
    n_steps = int(math.ceil((end_mjd - start_mjd) / step_days))
    if n_steps < 1:
        raise SystemExit("Date range is empty; widen --start/--end.")
    centers = start_mjd + step_days * (np.arange(n_steps) + 0.5)   # windows tile [start, end]
    log(f"Asking Horizons for {len(centers)} sample positions of '{target}' ...")
    coarse = horizons_positions(target, centers, id_type)

    images = {}
    for k, mjd in enumerate(centers):
        coord = SkyCoord(coarse["ra"][k] * u.deg, coarse["dec"][k] * u.deg)
        try:
            res = query_images(coord, radius_deg, mjd - step_days / 2,
                               mjd + step_days / 2, collection)
        except Exception as ex:  # network hiccup - keep scanning
            log(f"  [{k + 1}/{len(centers)}] MJD {mjd:.1f}: query failed ({type(ex).__name__}: {ex})")
            continue
        n_new = 0
        for row in res:
            url = str(row["access_url"])
            if url in images:
                continue
            t_min = float(row["t_min"])
            t_max = float(row["t_max"]) if "t_max" in res.colnames else t_min
            images[url] = {
                "access_url": url,
                "band": str(row["energy_bandpassname"]),
                "t_min": t_min,
                "t_max": t_max,
                "image_ra": float(row["s_ra"]),
                "image_dec": float(row["s_dec"]),
            }
            n_new += 1
        log(f"  [{k + 1}/{len(centers)}] MJD {mjd:.1f}: {len(res)} images, {n_new} new")

    if not images:
        return []

    # Exact object position at each image's own mid-time.
    imgs = sorted(images.values(), key=lambda d: d["t_min"])
    mid = np.array([(d["t_min"] + d["t_max"]) / 2 for d in imgs])
    log(f"Refining object position at {len(imgs)} image times ...")
    fine = horizons_positions(target, mid, id_type)
    for d, ra, dec, v, rate, el, m in zip(imgs, fine["ra"], fine["dec"], fine["vmag"],
                                          fine["rate"], fine["elong"], mid):
        d.update(mjd=float(m), utc=Time(m, format="mjd").isot[:19],
                 obj_ra=float(ra), obj_dec=float(dec),
                 vmag=None if np.isnan(v) else float(v),
                 rate_arcsec_hr=float(rate), elong=float(el),
                 detector=detector_from_name(d["band"]))
        sep = SkyCoord(ra * u.deg, dec * u.deg).separation(
            SkyCoord(d["image_ra"] * u.deg, d["image_dec"] * u.deg)).deg
        d["sep_from_image_center_deg"] = float(sep)
    return imgs


def recommend_region(cands, margin_deg=0.04, min_size_deg=0.1):
    """Centre/size of a fixed field that keeps the object inside for every frame."""
    ra = np.array([c["obj_ra"] for c in cands])
    dec = np.array([c["obj_dec"] for c in cands])
    ra0 = float(np.degrees(np.arctan2(np.mean(np.sin(np.radians(ra))),
                                      np.mean(np.cos(np.radians(ra))))) % 360)
    dec0 = float(np.mean(dec))
    pts = SkyCoord(ra * u.deg, dec * u.deg)
    far = float(pts.separation(SkyCoord(ra0 * u.deg, dec0 * u.deg)).deg.max())
    size = max(min_size_deg, 2 * (far + margin_deg))
    return {"ra": round(ra0, 6), "dec": round(dec0, 6), "size_deg": round(size, 3),
            "max_offset_deg": round(far, 4)}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--target", required=True,
                   help="Horizons name or number, e.g. Pallas, 4, '433 Eros'")
    p.add_argument("--start", required=True, help="YYYY-MM-DD (UTC)")
    p.add_argument("--end", required=True, help="YYYY-MM-DD (UTC)")
    p.add_argument("--region", help="folder name under raw/ (default: from target)")
    p.add_argument("--step-days", type=float, default=2.0,
                   help="spacing of IRSA queries; smaller = slower but safer (default 2)")
    p.add_argument("--radius", type=float, default=0.05,
                   help="IRSA search radius around the object, deg (default 0.05)")
    p.add_argument("--max-vmag", type=float, default=16.0,
                   help="drop frames where the object is fainter than this (default 16)")
    p.add_argument("--max-center-sep", type=float, default=1.6,
                   help="drop frames where the object is farther than this from the "
                        "image centre, deg - avoids detector edges (default 1.6)")
    p.add_argument("--collection", default=DEFAULT_COLLECTION)
    p.add_argument("--id-type", default="smallbody",
                   help="Horizons id_type (smallbody, majorbody, ...)")
    p.add_argument("--out-root", default="raw")
    args = p.parse_args(argv)

    start = Time(args.start + "T00:00:00", scale="utc").mjd
    end = Time(args.end + "T00:00:00", scale="utc").mjd
    if end <= start:
        raise SystemExit("--end must be after --start")
    region = args.region or slugify(args.target)

    cands = find_candidates(args.target, start, end, args.step_days, args.radius,
                            args.collection, args.id_type)
    total = len(cands)
    cands = [c for c in cands if c["sep_from_image_center_deg"] <= args.max_center_sep]
    cands = [c for c in cands if c["vmag"] is None or c["vmag"] <= args.max_vmag]

    print()
    if not cands:
        print(f"No usable SPHEREx images of '{args.target}' between {args.start} and "
              f"{args.end} ({total} raw hits before filtering).")
        print("Try another asteroid, a wider date range, or a smaller --step-days.")
        return 1

    by_day = {}
    for c in cands:
        by_day.setdefault(c["utc"][:10], []).append(c)
    print(f"{len(cands)} images contain '{args.target}'  ({total} before filtering)")
    print(f"{'date':<12}{'frames':>7}  bands")
    for day in sorted(by_day):
        bands = sorted({c["band"].replace("SPHEREx-", "") for c in by_day[day]})
        print(f"{day:<12}{len(by_day[day]):>7}  {' '.join(bands)}")

    v = [c["vmag"] for c in cands if c["vmag"] is not None]
    rate = float(np.median([c["rate_arcsec_hr"] for c in cands]))
    print(f"\nV mag: {min(v):.1f}-{max(v):.1f}" if v else "\nV mag: unknown")
    print(f"Sky motion: ~{rate:.0f} arcsec/hr  (~{rate * 24 / 3600:.2f} deg/day)")
    print(f"Solar elongation: {min(c['elong'] for c in cands):.0f}-"
          f"{max(c['elong'] for c in cands):.0f} deg")

    reg = recommend_region(cands)
    print(f"\nRecommended field: RA {reg['ra']}  Dec {reg['dec']}  size {reg['size_deg']} deg "
          f"(object wanders {reg['max_offset_deg']} deg from centre)")
    if reg["size_deg"] > 0.6:
        print("  Warning: the object moves a lot; use --start/--end to pick a shorter "
              "window (a few days) so the cutout stays small.")

    out_dir = os.path.join(args.out_root, region)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "candidates.json")
    with open(path, "w") as f:
        json.dump({"region": region, "target": args.target, "collection": args.collection,
                   "field": reg, "images": cands}, f, indent=2)
    print(f"\nSaved {path}")
    print(f"Next:  python download_cutouts.py --region {region}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
