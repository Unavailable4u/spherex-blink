#!/usr/bin/env python3
"""Step 2 - turn SPHEREx FITS cutouts into web-ready PNG tiles + JSON.

    python fits_to_png.py --region pallas

Reads every .fits under raw/<region>/ and writes, under ../web/tiles/<region>/:

    <band>/<frame_id>.png     8-bit greyscale, north up, east left, all the same size
    wcs.json                  the ONE sky grid shared by every tile (see below)
    manifest.json             frames, dates, bands, wavelengths, stretch parameters
    previews/                 contact sheets + blink GIFs for eyeballing the result

Why each step exists
--------------------
* Reproject: every cutout comes from a different SPHEREx exposure with its own
  pointing and rotation. Blinking only works if a star sits on the same pixel in
  every frame, so all frames are resampled onto one common north-up TAN grid.
* Background subtraction: the zodiacal-light level differs between exposures.
  Each frame's median is removed so brightness does not flicker when blinking.
* Shared stretch per band: one (lo, hi) range for all frames of a band, so the
  same flux always maps to the same grey level. The values are stored in the
  manifest so the front end can turn a clicked pixel back into approximate flux.
* One wcs.json per region: because all tiles share a grid, the browser needs a
  single tiny file to convert pixel <-> RA/Dec. No FITS maths in JavaScript.

PNG pixel -> sky (what wcs.json encodes)
----------------------------------------
PNG (col,row) are 0-based with row 0 at the top. The tile was flipped vertically
from FITS order, so  x_fits = col + 1  and  y_fits = height - row  (1-based FITS).
Then standard TAN projection with crval/crpix/cdelt (cdelt[0] is negative).
"""
import argparse
import glob
import json
import math
import os
import re
import sys
import warnings

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS, FITSFixedWarning
from astropy.wcs.utils import proj_plane_pixel_scales
from PIL import Image, ImageDraw
from reproject import reproject_interp

warnings.filterwarnings("ignore", category=FITSFixedWarning)

MAX_TILE_PX = 1024


# --------------------------------------------------------------------------- loading
def _detector(header, path):
    d = header.get("DETECTOR")
    if d is not None:
        try:
            return int(d)
        except (TypeError, ValueError):
            pass
    m = re.search(r"D(\d)", os.path.basename(path)) or re.search(r"D(\d)", os.path.dirname(path))
    return int(m.group(1)) if m else 0


def _mjd(header_list):
    for h in header_list:
        b, e = h.get("MJD-BEG"), h.get("MJD-END")
        if b is not None and e is not None:
            return (float(b) + float(e)) / 2
        if h.get("MJD-AVG") is not None:
            return float(h["MJD-AVG"])
        if h.get("MJD-OBS") is not None:
            return float(h["MJD-OBS"])
    return None


def load_frame(path):
    """Read one SPHEREx cutout. Returns a dict, or None if it has no usable image."""
    with fits.open(path, memmap=False) as hdul:   # memmap off: arrays must outlive the file
        names = [h.name.upper() for h in hdul]
        if "IMAGE" in names:
            hdu = hdul["IMAGE"]
        else:  # fall back to the first 2-D image extension
            cands = [h for h in hdul if h.data is not None and h.data.ndim == 2]
            if not cands:
                return None
            hdu = cands[0]
        data = np.array(hdu.data, dtype=np.float32)
        header = hdu.header.copy()
        mjd = _mjd([header, hdul[0].header])
        spatial = WCS(header)
        spectral = None
        try:  # SPHEREx stores wavelength as alternate WCS 'W' backed by a lookup table
            spectral = WCS(header=header, fobj=hdul, key="W")
            spectral.sip = None
            spectral.pixel_to_world(data.shape[1] / 2, data.shape[0] / 2)  # smoke test
        except Exception:  # noqa: BLE001 - wavelength is a nice-to-have
            spectral = None
        # Keep the spectral WCS usable after the file closes.
        if spectral is not None:
            try:
                spectral = spectral.deepcopy()
            except Exception:  # noqa: BLE001
                spectral = None
    det = _detector(header, path)
    return {"path": path, "data": data, "wcs": spatial, "spectral": spectral,
            "mjd": mjd, "detector": det, "band": f"D{det}" if det else "D0",
            "unit": str(header.get("BUNIT", "MJy/sr"))}


def assign_epochs(mjds, gap_days=30.0):
    order = np.argsort(mjds)
    epochs = np.zeros(len(mjds), dtype=int)
    last, e = None, 1
    for i in order:
        if last is not None and mjds[i] - last > gap_days:
            e += 1
        epochs[i] = e
        last = mjds[i]
    return epochs


# --------------------------------------------------------------------------- geometry
def make_target_wcs(ra, dec, n, scale_deg):
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    w.wcs.cdelt = [-scale_deg, scale_deg]
    w.wcs.cunit = ["deg", "deg"]
    return w


def png_to_fits_pixel0(col, row, n):
    """PNG (col,row) -> 0-based FITS pixel (x,y) of the target grid."""
    return col, (n - 1) - row


def sample_wavelength(frame, target_wcs, n, col, row):
    """Wavelength (um) and bandwidth at a PNG pixel, via the frame's own spectral WCS."""
    spec = frame["spectral"]
    if spec is None:
        return np.nan, np.nan
    try:
        x0, y0 = png_to_fits_pixel0(col, row, n)
        sky = target_wcs.pixel_to_world(x0, y0)
        px, py = frame["wcs"].world_to_pixel(sky)
        res = spec.pixel_to_world(float(px), float(py))
        return float(res[0].to(u.micron).value), float(res[1].to(u.micron).value)
    except Exception:  # noqa: BLE001
        return np.nan, np.nan


def fit_wavelength_plane(sampler, n, grid=9):
    """Fit lambda ~ c0 + cx*col + cy*row over a coarse lattice of the tile.

    SPHEREx uses a linear variable filter, so wavelength is close to a plane across
    the detector. A plane is tiny to store and trivial to evaluate in the browser.
    """
    cols = np.linspace(0, n - 1, grid)
    rows = np.linspace(0, n - 1, grid)
    cc, rr = np.meshgrid(cols, rows)
    lam = np.array([[sampler(c, r)[0] for c in cols] for r in rows])
    ok = np.isfinite(lam)
    if ok.sum() < 6:
        return None
    A = np.column_stack([np.ones(ok.sum()), cc[ok], rr[ok]])
    coef, *_ = np.linalg.lstsq(A, lam[ok], rcond=None)
    resid = lam[ok] - A @ coef
    return {"c0": float(coef[0]), "per_col": float(coef[1]), "per_row": float(coef[2]),
            "rms_um": float(np.sqrt(np.mean(resid ** 2))), "units": "um"}


# --------------------------------------------------------------------------- imaging
def stretch_params(arrays, lo_pct, hi_pct):
    pool = np.concatenate([a[np.isfinite(a)].ravel() for a in arrays])
    if pool.size == 0:
        return 0.0, 1.0
    lo, hi = np.percentile(pool, [lo_pct, hi_pct])
    if not hi > lo:
        hi = lo + 1.0
    return float(lo), float(hi)


def apply_stretch(arr, lo, hi, a):
    t = np.clip((arr - lo) / (hi - lo), 0.0, 1.0)
    t = np.nan_to_num(t, nan=0.0)
    y = np.arcsinh(t / a) / np.arcsinh(1.0 / a)
    return np.round(y * 255).astype(np.uint8)


def contact_sheet(tiles, labels, path, cols=4, pad=4):
    n = len(tiles)
    h, w = tiles[0].shape
    cols = min(cols, n)
    rows = math.ceil(n / cols)
    lab_h = 14
    sheet = Image.new("L", (cols * (w + pad) + pad, rows * (h + lab_h + pad) + pad), 20)
    d = ImageDraw.Draw(sheet)
    for i, (t, lab) in enumerate(zip(tiles, labels)):
        x = pad + (i % cols) * (w + pad)
        y = pad + (i // cols) * (h + lab_h + pad)
        sheet.paste(Image.fromarray(t, "L"), (x, y + lab_h))
        d.text((x + 2, y + 1), lab, fill=230)
    sheet.save(path)


def blink_gif(tiles, path, fps=3, min_side=256):
    scale = max(1, math.ceil(min_side / tiles[0].shape[0]))
    frames = []
    for t in tiles:
        im = Image.fromarray(t, "L")
        if scale > 1:
            im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        frames.append(im)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=int(1000 / fps), loop=0)


# --------------------------------------------------------------------------- main
def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", required=True)
    p.add_argument("--raw-root", default="raw")
    p.add_argument("--out-root", default=os.path.join("..", "web", "tiles"))
    p.add_argument("--ra", type=float, help="field centre RA, deg (default: region.json)")
    p.add_argument("--dec", type=float, help="field centre Dec, deg (default: region.json)")
    p.add_argument("--size", type=float, help="field size, deg (default: region.json)")
    p.add_argument("--oversample", type=int, default=4,
                   help="output pixels per SPHEREx pixel; >1 only smooths the display (default 4)")
    p.add_argument("--order", choices=["nearest-neighbor", "bilinear", "bicubic"],
                   default="bilinear", help="reprojection interpolation")
    p.add_argument("--lo-pct", type=float, default=1.0)
    p.add_argument("--hi-pct", type=float, default=99.8)
    p.add_argument("--asinh-a", type=float, default=0.05,
                   help="asinh softening; smaller = stronger boost of faint pixels")
    p.add_argument("--epoch-gap", type=float, default=30.0, help="days that start a new epoch")
    p.add_argument("--no-previews", action="store_true")
    args = p.parse_args(argv)

    raw_dir = os.path.join(args.raw_root, args.region)
    meta = {}
    mpath = os.path.join(raw_dir, "region.json")
    if os.path.exists(mpath):
        with open(mpath) as f:
            meta = json.load(f)
    ra = args.ra if args.ra is not None else meta.get("ra")
    dec = args.dec if args.dec is not None else meta.get("dec")
    size = args.size if args.size is not None else meta.get("size_deg")
    if ra is None or dec is None or size is None:
        raise SystemExit("No region.json found - pass --ra, --dec and --size.")

    paths = sorted(glob.glob(os.path.join(raw_dir, "**", "*.fits"), recursive=True))
    if not paths:
        raise SystemExit(f"No FITS files under {raw_dir}")
    print(f"Reading {len(paths)} FITS files ...")
    frames = []
    for path in paths:
        try:
            fr = load_frame(path)
        except Exception as ex:  # noqa: BLE001
            print(f"  skip {path}: {type(ex).__name__}: {ex}")
            continue
        if fr is None:
            print(f"  skip {path}: no 2-D image extension")
            continue
        if fr["mjd"] is None:
            print(f"  skip {path}: no observation time in header")
            continue
        frames.append(fr)
    if not frames:
        raise SystemExit("Nothing usable.")

    # Output grid: native SPHEREx pixel scale / oversample, shrunk if the tile would be huge.
    native = float(np.median([np.mean(proj_plane_pixel_scales(f["wcs"])) for f in frames]))
    over = max(1, args.oversample)
    n = int(math.ceil(size / (native / over)))
    while n > MAX_TILE_PX and over > 1:
        over -= 1
        n = int(math.ceil(size / (native / over)))
    n = min(n, MAX_TILE_PX)
    scale = size / n
    target = make_target_wcs(ra, dec, n, scale)
    print(f"Grid {n}x{n} px, {scale * 3600:.2f} arcsec/px (native {native * 3600:.2f}), "
          f"centre RA {ra:.5f} Dec {dec:.5f}")

    mjds = np.array([f["mjd"] for f in frames])
    epochs = assign_epochs(mjds, args.epoch_gap)

    # Reproject + background-subtract every frame.
    for f, e in zip(frames, epochs):
        f["epoch"] = int(e)
        arr, foot = reproject_interp((f["data"], f["wcs"]), target, shape_out=(n, n),
                                     order=args.order)
        arr = np.asarray(arr, dtype=np.float32)
        arr[foot < 0.5] = np.nan
        bkg = float(np.nanmedian(arr)) if np.isfinite(arr).any() else 0.0
        f["bkg"] = bkg
        f["img"] = np.flipud(arr - bkg)           # row 0 = north
        f["coverage"] = float(np.isfinite(arr).mean())

    out_dir = os.path.join(args.out_root, args.region)
    os.makedirs(out_dir, exist_ok=True)
    bands = sorted({f["band"] for f in frames})
    manifest_frames, band_info, used_ids = [], {}, set()
    preview_dir = os.path.join(out_dir, "previews")
    if not args.no_previews:
        os.makedirs(preview_dir, exist_ok=True)

    for band in bands:
        bf = sorted([f for f in frames if f["band"] == band], key=lambda f: f["mjd"])
        lo, hi = stretch_params([f["img"] for f in bf], args.lo_pct, args.hi_pct)
        os.makedirs(os.path.join(out_dir, band), exist_ok=True)
        tiles, labels, ids = [], [], []
        for f in bf:
            iso = Time(f["mjd"], format="mjd").isot
            fid = f"{iso[:10]}_{iso[11:13]}{iso[14:16]}"
            k = 1
            while (band, fid) in used_ids:
                k += 1
                fid = f"{iso[:10]}_{iso[11:13]}{iso[14:16]}_{k}"
            used_ids.add((band, fid))
            tile = apply_stretch(f["img"], lo, hi, args.asinh_a)
            Image.fromarray(tile, "L").save(os.path.join(out_dir, band, fid + ".png"), optimize=True)

            sampler = lambda c, r, f=f: sample_wavelength(f, target, n, c, r)  # noqa: E731
            lam_c, bw_c = sampler((n - 1) / 2, (n - 1) / 2)
            plane = fit_wavelength_plane(sampler, n) if f["spectral"] is not None else None
            manifest_frames.append({
                "id": fid, "band": band, "detector": f["detector"], "epoch": f["epoch"],
                "mjd": round(f["mjd"], 5), "utc": iso[:19] + "Z",
                "path": f"{band}/{fid}.png",
                "bkg": round(f["bkg"], 6), "unit": f["unit"],
                "coverage": round(f["coverage"], 3),
                "wavelength_um": None if not np.isfinite(lam_c) else round(lam_c, 4),
                "bandwidth_um": None if not np.isfinite(bw_c) else round(bw_c, 4),
                "wavelength_plane": plane,
                "source": os.path.relpath(f["path"], raw_dir),
            })
            tiles.append(tile)
            ids.append(fid)
            labels.append(iso[:10] + (f" {lam_c:.2f}um" if np.isfinite(lam_c) else ""))
        band_info[band] = {"frames": ids,
                           "stretch": {"lo": lo, "hi": hi, "a": args.asinh_a, "kind": "asinh",
                                       "unit": bf[0]["unit"]}}
        if not args.no_previews:
            contact_sheet(tiles, labels, os.path.join(preview_dir, f"contact_{band}.png"))
            if len(tiles) > 1:
                blink_gif(tiles, os.path.join(preview_dir, f"blink_{band}.gif"))
        print(f"  {band}: {len(bf)} frames, epochs {sorted({f['epoch'] for f in bf})}, "
              f"stretch {lo:.3g}..{hi:.3g}")

    manifest_frames.sort(key=lambda d: (d["band"], d["mjd"]))

    # wcs.json - one grid for the whole region
    lattice = []
    for r in np.linspace(0, n - 1, 5):
        for c in np.linspace(0, n - 1, 5):
            x0, y0 = png_to_fits_pixel0(c, r, n)
            s = target.pixel_to_world(x0, y0)
            lattice.append({"col": float(c), "row": float(r),
                            "ra": float(s.ra.deg), "dec": float(s.dec.deg)})
    wcs_json = {
        "projection": "TAN", "width": n, "height": n,
        "crval": [float(ra), float(dec)],
        "crpix": [(n + 1) / 2, (n + 1) / 2],
        "cdelt": [-scale, scale],
        "pixscale_arcsec": scale * 3600,
        "size_deg": float(size),
        "png_to_fits": "x_fits = col + 1 ; y_fits = height - row   (FITS pixels are 1-based)",
        "check_points": lattice,
    }
    with open(os.path.join(out_dir, "wcs.json"), "w") as f:
        json.dump(wcs_json, f, indent=2)

    manifest = {
        "region": args.region, "center": {"ra": float(ra), "dec": float(dec)},
        "size_deg": float(size), "tile": {"width": n, "height": n},
        "mode": meta.get("mode"),
        "epochs": sorted({d["epoch"] for d in manifest_frames}),
        "bands": band_info, "frames": manifest_frames,
        "intensity_note": ("pixel/255 = y ; flux above frame background = lo + (hi-lo) * "
                           "a*sinh(y*asinh(1/a)) ; add frame 'bkg' for the level that was "
                           "subtracted. Values are only approximate (8-bit)."),
        "credit": "SPHEREx data via NASA/IPAC IRSA. Official acknowledgement text: see README.",
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    # regions.json - lets the web app list every region available
    reg_path = os.path.join(args.out_root, "regions.json")
    regions = []
    if os.path.exists(reg_path):
        with open(reg_path) as f:
            regions = json.load(f).get("regions", [])
    prev = next((r for r in regions if r["id"] == args.region), {})      # keep hand-written title/blurb/kind
    regions = [r for r in regions if r["id"] != args.region]
    regions.append({**prev, "id": args.region, "frames": len(manifest_frames),
                    "bands": bands, "epochs": manifest["epochs"]})
    with open(reg_path, "w") as f:
        json.dump({"regions": sorted(regions, key=lambda r: r["id"])}, f, indent=2)

    n_nolam = sum(1 for d in manifest_frames if d["wavelength_um"] is None)
    print(f"\nWrote {len(manifest_frames)} tiles to {out_dir}")
    if n_nolam:
        print(f"Note: wavelength could not be read for {n_nolam} frame(s); "
              f"the app will show the detector name only for those.")
    low = [d["id"] for d in manifest_frames if d["coverage"] < 0.9]
    if low:
        print(f"Note: {len(low)} frame(s) cover <90% of the field (near a detector edge).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
