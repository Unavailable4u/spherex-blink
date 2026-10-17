#!/usr/bin/env python3
"""Build many SPHEREx fields in one go (needs internet: IRSA S3 + SIA, JPL Horizons, CDS).

    cd data-prep
    python build_all.py --dry-run                 # show the plan, touch nothing
    python build_all.py                           # build every field in fields.json
    python build_all.py --only vesta ceres        # just these
    python build_all.py --force --only vesta      # rebuild

For moving targets the date window is searched automatically: the configured range is cut into
`window_days` windows, each is probed with find_target.py, and the first window with at least
`min_frames` images and a field no bigger than `max_size_deg` is built with build_field.py.
Fixed patches (ra/dec/size) go straight to build_field.py. A field that fails is reported and
skipped; finished fields are cached, so re-running only does what is missing.
"""
import argparse, datetime as dt, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "..", "web", "tiles")
RAW = os.path.join(HERE, "raw")


def windows(start, end, days):
    a, b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    step = dt.timedelta(days=days)
    while a < b:
        yield a.isoformat(), min(a + step, b).isoformat()
        a += step


def run(cmd, dry, quiet=False):
    print("$ " + " ".join(cmd))
    if dry:
        return 0
    return subprocess.run(cmd, cwd=HERE, stdout=subprocess.DEVNULL if quiet else None).returncode


def built(region):
    return os.path.exists(os.path.join(TILES, region, "manifest.json"))


def folder_mb(path):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs) / 1e6


def probe(f, cfg, dry):
    """Return (start, end) of the first usable window, or None."""
    rng = f.get("range", cfg["range"])
    for s, e in windows(rng[0], rng[1], f.get("window_days", cfg["window_days"])):
        cmd = [sys.executable, "find_target.py", "--target", f["target"], "--start", s, "--end", e,
               "--region", f["region"], "--collection", f.get("collection", cfg["collection"])]
        if dry:
            run(cmd, True)
            return (s, e)
        print(f"  probing {f['region']} {s} .. {e}")
        if run(cmd, False, quiet=True) != 0:
            continue
        data = json.load(open(os.path.join(RAW, f["region"], "candidates.json")))
        n, size = len(data["images"]), data["field"]["size_deg"]
        print(f"    {n} frames, field {size} deg")
        if n >= f.get("min_frames", cfg["min_frames"]) and size <= f.get("max_size_deg", cfg["max_size_deg"]):
            return (s, e)
    return None


def build(f, cfg, dry):
    cmd = [sys.executable, "build_field.py", "--region", f["region"],
           "--collection", f.get("collection", cfg["collection"]),
           "--source", f.get("source", cfg.get("source", "irsa")),
           "--title", f["title"], "--blurb", f["blurb"]]
    if "target" in f:
        win = probe(f, cfg, dry)
        if not win:
            return "no usable SPHEREx window found"
        cmd += ["--target", f["target"], "--target-name", f["target_name"],
                "--start", win[0], "--end", win[1],
                "--max-frames", str(f.get("max_frames", cfg["max_frames"]))]
    else:
        cmd += ["--ra", str(f["ra"]), "--dec", str(f["dec"]), "--size", str(f["size"])]
    return None if run(cmd, dry) == 0 else "build_field.py failed (see output above)"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "fields.json"))
    ap.add_argument("--only", nargs="+", help="region ids to build")
    ap.add_argument("--force", action="store_true", help="rebuild fields that already exist")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    conf = json.load(open(a.config))
    cfg, fields = conf["defaults"], conf["fields"]
    if a.only:
        unknown = set(a.only) - {f["region"] for f in fields}
        if unknown:
            sys.exit(f"Not in {a.config}: {', '.join(sorted(unknown))}")
        fields = [f for f in fields if f["region"] in a.only]

    report, t0 = [], time.time()
    for f in fields:
        R = f["region"]
        print(f"\n=== {R} ===")
        if built(R) and not a.force:
            print("  already built, skipping (use --force to rebuild)")
            report.append((R, "skipped", ""))
            continue
        err = build(f, cfg, a.dry_run)
        report.append((R, "FAILED" if err else ("planned" if a.dry_run else "ok"), err or ""))

    print(f"\n{'region':<14}{'status':<9}{'size':>8}  note")
    for R, status, note in report:
        mb = f"{folder_mb(os.path.join(TILES, R)):.0f} MB" if status == "ok" else ""
        print(f"{R:<14}{status:<9}{mb:>8}  {note}")
    if not a.dry_run:
        json.dump([dict(region=r, status=s, note=n) for r, s, n in report],
                  open(os.path.join(HERE, "build_report.json"), "w"), indent=2)
        print(f"\n{(time.time() - t0) / 60:.1f} min. Check web/tiles/<region>/previews/, run `node tests/run.js`, "
              "then commit web/tiles/ and push.")
    sys.exit(1 if any(s == "FAILED" for _, s, _ in report) else 0)


if __name__ == "__main__":
    main()