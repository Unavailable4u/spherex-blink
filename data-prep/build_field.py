#!/usr/bin/env python3
"""Build a complete field for the web app in one command (needs internet: IRSA, JPL Horizons, CDS).

Two kinds of field:

  A) a moving target (the guaranteed "aha": something that really moves between frames)
       python build_field.py --region vesta --target 4 --target-name "(4) Vesta" \\
              --start 2025-08-01 --end 2025-08-20 \\
              --title "Vesta field" --blurb "The second most massive asteroid, caught drifting between SPHEREx visits."

  B) a fixed patch of sky seen in several survey passes (the six-month baseline the challenge asks for)
       python build_field.py --region m101 --ra 210.80227 --dec 54.34895 --size 1.5 \\
              --collection spherex_qr3 --title "M101 field"

It simply runs the existing steps in order and stops at the first failure:

    find_target.py -> download_cutouts.py -> fits_to_png.py -> solar_system.py -> verify_target.py
    -> fetch_reference.py (optional)

and then writes title / blurb / kind into web/tiles/regions.json so the field shows up in the Field menu
with a proper name. Re-running is safe (downloads are cached). Use --dry-run to print the commands.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "..", "web", "tiles")


def run(cmd, dry, ok=(0,)):
    print("\n$ " + " ".join(cmd))
    if dry:
        return
    r = subprocess.run(cmd, cwd=HERE)
    if r.returncode not in ok:
        sys.exit(f"\nStep failed (exit {r.returncode}): {' '.join(cmd[:3])} ... Fix it and re-run; finished steps are cached.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", required=True, help="short id, e.g. vesta (used for folders and ?region=vesta)")
    ap.add_argument("--target", help="asteroid name or number for JPL Horizons (kind A)")
    ap.add_argument("--target-name", help='label shown in the app, e.g. "(4) Vesta"')
    ap.add_argument("--start", help="YYYY-MM-DD (kind A)")
    ap.add_argument("--end", help="YYYY-MM-DD (kind A)")
    ap.add_argument("--ra", type=float, help="field centre RA, deg (kind B)")
    ap.add_argument("--dec", type=float, help="field centre Dec, deg (kind B)")
    ap.add_argument("--size", type=float, help="field size, deg (kind B; kind A takes it from find_target)")
    ap.add_argument("--collection", default="spherex_qr2", help="IRSA SIA collection (QR3 data lives in a newer one)")
    ap.add_argument("--source", default="s3", choices=["s3", "irsa", "auto"], help="download source passed to download_cutouts.py")
    ap.add_argument("--max-frames", type=int, help="cap the number of frames downloaded (moving-target fields)")
    ap.add_argument("--title", help="name in the Field menu")
    ap.add_argument("--blurb", help="one sentence shown under the menu")
    ap.add_argument("--skip-reference", action="store_true", help="do not fetch DSS2/2MASS/WISE")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    kind_a = bool(a.target)
    if kind_a and not (a.start and a.end):
        ap.error("--target needs --start and --end")
    if not kind_a and None in (a.ra, a.dec):
        ap.error("give either --target (+ --start/--end) or --ra and --dec")
    py = sys.executable
    R = a.region

    if kind_a:
        run([py, "find_target.py", "--target", a.target, "--start", a.start, "--end", a.end,
             "--region", R, "--collection", a.collection], a.dry_run)
        dl = [py, "download_cutouts.py", "--region", R, "--mode", "candidates", "--collection", a.collection, "--source", a.source]
    else:
        dl = [py, "download_cutouts.py", "--region", R, "--ra", str(a.ra), "--dec", str(a.dec),
              "--mode", "best", "--collection", a.collection, "--source", a.source]
        if a.size:
            dl += ["--size", str(a.size)]
    if a.max_frames and kind_a:                       # --max-frames only exists in candidates mode
        dl += ["--max-frames", str(a.max_frames)]
    run(dl, a.dry_run)
    run([py, "fits_to_png.py", "--region", R], a.dry_run)
    sky = [py, "solar_system.py", "--region", R]
    if a.target_name:
        sky += ["--target-name", a.target_name]
    run(sky, a.dry_run)
    if kind_a:
        run([py, "verify_target.py", "--region", R], a.dry_run, ok=(0, 2))   # 2 = some frames not detected: warn, still ship
    if not a.skip_reference:
        run([py, "fetch_reference.py", "--region", R], a.dry_run)

    if not a.dry_run:
        path = os.path.join(TILES, "regions.json")
        data = json.load(open(path))
        for r in data["regions"]:
            if r["id"] == R:
                r.update({k: v for k, v in {"title": a.title, "blurb": a.blurb, "kind": "real",
                                            "target": a.target_name if kind_a else None}.items() if v})
        json.dump(data, open(path, "w"), indent=2)
        print(f"\nDone. Open the site with ?region={R}, check the blink, then commit web/tiles/{R}/ and regions.json.")


if __name__ == "__main__":
    main()