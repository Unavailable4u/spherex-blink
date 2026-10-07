#!/usr/bin/env python3
"""Make fake SPHEREx-style cutouts so the pipeline and the web app can be built
and tested without internet access to IRSA.

    python make_synthetic.py                 # writes raw/synthetic/*.fits + region.json
    python fits_to_png.py --region synthetic # builds ../web/tiles/synthetic/

What is faked (and why it is a good test):
  * the same 60 stars seen by every frame, but each frame has its own pointing
    offset and rotation -> after reprojection stars must land on the same pixel
  * one "asteroid" moving in a straight line (0.012 deg/day) -> must drift across
    the tile in time order and be absent from far-away epochs' positions
  * two epochs 90 days apart, two detectors (D2, D4), a different zodi level
    and gradient per frame, noise, SIP-free TAN WCS, HDU names like the real files
The truth is written to raw/synthetic/truth.json so tests can check positions.
"""
import argparse
import json
import os

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

CENTER = (150.10, 2.20)       # RA, Dec of the field (deg)
SIZE_DEG = 0.12
PIX = 6.15 / 3600             # SPHEREx pixel, deg
SIGMA = 0.9                   # PSF sigma in native pixels
MOVER_RATE = (0.010, 0.006)   # deg/day in (RA*cos(dec), Dec)
MOVER_T0 = 61000.0            # MJD at which the mover is at CENTER


def sky_to_pix_simple(wcs, ra, dec):
    x, y = wcs.all_world2pix(ra, dec, 0)
    return np.asarray(x), np.asarray(y)


def render(shape, xs, ys, flux):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    img = np.zeros(shape, dtype=np.float32)
    for x, y, f in zip(xs, ys, flux):
        if -5 < x < shape[1] + 5 and -5 < y < shape[0] + 5:
            img += f * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * SIGMA ** 2))
    return img


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--out-root", default="raw")
    p.add_argument("--region", default="synthetic")
    p.add_argument("--seed", type=int, default=7)
    args = p.parse_args(argv)
    rng = np.random.default_rng(args.seed)

    n = int(round(SIZE_DEG * 1.45 / PIX))   # cutouts are bigger than the field, like the real download
    folder = os.path.join(args.out_root, args.region)
    os.makedirs(folder, exist_ok=True)

    # The sky: fixed stars (deg offsets from CENTER) and their fluxes.
    star_dx = rng.uniform(-0.085, 0.085, 60)
    star_dy = rng.uniform(-0.085, 0.085, 60)
    star_ra = CENTER[0] + star_dx / np.cos(np.radians(CENTER[1]))
    star_dec = CENTER[1] + star_dy
    star_flux = rng.lognormal(mean=3.0, sigma=0.9, size=60).astype(np.float32)

    times = []
    for epoch_start in (61000.0, 61090.0):
        for day in range(4):
            for det in (2, 4):
                times.append((epoch_start + day + 0.1 * det, det))

    truth = {"center": CENTER, "size_deg": SIZE_DEG, "stars": [], "mover": [], "frames": []}
    for k, (mjd, det) in enumerate(times):
        # Each exposure has its own pointing jitter and roll angle.
        off = rng.uniform(-0.012, 0.012, 2)
        roll = np.radians(rng.uniform(-25, 25))
        c, s = np.cos(roll), np.sin(roll)
        w = WCS(naxis=2)
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        w.wcs.crval = [CENTER[0] + off[0], CENTER[1] + off[1]]
        w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
        w.wcs.cdelt = [-PIX, PIX]
        w.wcs.pc = [[c, -s], [s, c]]
        w.wcs.cunit = ["deg", "deg"]

        # Mover position at this time.
        dt = mjd - MOVER_T0
        m_dec = CENTER[1] + MOVER_RATE[1] * dt
        m_ra = CENTER[0] + MOVER_RATE[0] * dt / np.cos(np.radians(CENTER[1]))
        ras = np.append(star_ra, m_ra)
        decs = np.append(star_dec, m_dec)
        flux = np.append(star_flux, 25.0)
        # Stars in different detectors/frames get slightly different brightness (LVF colour).
        flux = flux * (1 + 0.08 * (det - 3)) * rng.uniform(0.97, 1.03, flux.size)
        xs, ys = sky_to_pix_simple(w, ras, decs)
        img = render((n, n), xs, ys, flux)

        yy, xx = np.mgrid[0:n, 0:n]
        zodi = 40 + 25 * rng.random() + (0.05 * rng.normal()) * xx + (0.05 * rng.normal()) * yy
        img = img + zodi.astype(np.float32) + rng.normal(0, 1.2, img.shape).astype(np.float32)

        hdr = w.to_header()
        hdr["BUNIT"] = "MJy/sr"
        hdr["DETECTOR"] = det
        hdr["MJD-BEG"] = mjd - 0.0006
        hdr["MJD-END"] = mjd + 0.0006
        hdul = fits.HDUList([
            fits.PrimaryHDU(),
            fits.ImageHDU(img, header=hdr, name="IMAGE"),
            fits.ImageHDU(np.zeros((n, n), dtype=np.int32), name="FLAGS"),
            fits.ImageHDU(np.ones((n, n), dtype=np.float32), name="VARIANCE"),
            fits.ImageHDU(zodi.astype(np.float32), name="ZODI"),
        ])
        epoch = 1 if mjd < 61050 else 2
        name = f"epoch{epoch}/SPHEREx-D{det}_{k:02d}.fits"
        os.makedirs(os.path.join(folder, f"epoch{epoch}"), exist_ok=True)
        hdul.writeto(os.path.join(folder, name), overwrite=True)
        truth["frames"].append({"file": name, "mjd": mjd, "detector": det, "roll_deg": float(np.degrees(roll)),
                                "mover_ra": float(m_ra), "mover_dec": float(m_dec)})

    truth["stars"] = [{"ra": float(a), "dec": float(b), "flux": float(f)}
                      for a, b, f in zip(star_ra, star_dec, star_flux)]
    with open(os.path.join(folder, "truth.json"), "w") as f:
        json.dump(truth, f, indent=2)
    with open(os.path.join(folder, "region.json"), "w") as f:
        json.dump({"region": args.region, "ra": CENTER[0], "dec": CENTER[1],
                   "size_deg": SIZE_DEG, "cutout_size_deg": round(SIZE_DEG * 1.45, 4),
                   "mode": "synthetic", "files": []}, f, indent=2)
    print(f"Wrote {len(times)} synthetic FITS cutouts to {folder}")


if __name__ == "__main__":
    main()
