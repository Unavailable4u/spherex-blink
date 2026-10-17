#!/usr/bin/env python3
"""Sky context for every frame of a region -> ../web/tiles/<region>/sky.json

    python solar_system.py --region pallas --target-name "(2) Pallas"

Per frame it stores (all offline, astropy's built-in ephemeris, ~arcminute accuracy):
  * Sun + planet RA/Dec, and which planets fall inside the field
  * the known target's RA/Dec (from raw/<region>/region.json, JPL Horizons; if that file is
    missing, the target track already in sky.json is kept)
  * Sun elongation and ecliptic latitude of the field centre
  * "reflex": how a *stationary distant body* appears to drift because the Earth moves,
    in arcsec/hour for a body 1 AU away [east, north]. Divide by the distance in AU.
    The web app uses this for the Planet X simulator and the distance estimator.
"""
import argparse, json, os, warnings
import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord, get_body, get_body_barycentric_posvel, solar_system_ephemeris
from astropy.time import Time

warnings.filterwarnings("ignore")
BODIES = ["sun", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"]
AU_KM = 1.495978707e8
ARCSEC_PER_RAD = 206264.806
EPS = np.radians(23.4392911)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--region", required=True)
    p.add_argument("--target-name", default=None, help='label for the known object, e.g. "(2) Pallas"')
    p.add_argument("--raw-root", default="raw")
    p.add_argument("--tiles-root", default=os.path.join("..", "web", "tiles"))
    a = p.parse_args()
    tdir = os.path.join(a.tiles_root, a.region)
    sky_path = os.path.join(tdir, "sky.json")
    man = json.load(open(os.path.join(tdir, "manifest.json")))
    ra0, dec0 = man["center"]["ra"], man["center"]["dec"]
    centre = SkyCoord(ra0 * u.deg, dec0 * u.deg)
    radius = man["size_deg"] / 2 * 1.42  # half-diagonal of the field

    old = json.load(open(sky_path)) if os.path.exists(sky_path) else {}
    obj = {}
    rp = os.path.join(a.raw_root, a.region, "region.json")
    if os.path.exists(rp):
        obj = {os.path.basename(f["file"]): (f["obj_ra"], f["obj_dec"]) for f in json.load(open(rp))["files"] if "obj_ra" in f}

    # unit vectors toward the field centre: line of sight, east, north
    al, de = np.radians(ra0), np.radians(dec0)
    los = np.array([np.cos(de) * np.cos(al), np.cos(de) * np.sin(al), np.sin(de)])
    east = np.array([-np.sin(al), np.cos(al), 0.0])
    north = np.array([-np.sin(de) * np.cos(al), -np.sin(de) * np.sin(al), np.cos(de)])
    sin_beta = np.sin(de) * np.cos(EPS) - np.cos(de) * np.sin(EPS) * np.sin(al)
    ecl_lat = float(np.degrees(np.arcsin(sin_beta)))

    out = {
        "bodies": BODIES,
        "target_name": a.target_name or old.get("target_name") or a.region.capitalize(),
        "field": {"ra": ra0, "dec": dec0, "size_deg": man["size_deg"],
                  "pixscale_arcsec": man["size_deg"] * 3600 / man["tile"]["width"],
                  "ecl_lat": round(ecl_lat, 3)},
        "frames": {}, "target": {},
    }
    with solar_system_ephemeris.set("builtin"):
        for f in man["frames"]:
            t = Time(f["mjd"], format="mjd", scale="utc")
            pos, infield = {}, []
            for b in BODIES:
                c = get_body(b, t)
                pos[b] = [round(float(c.ra.deg), 4), round(float(c.dec.deg), 4)]
                if b != "sun" and c.separation(centre).deg < radius:
                    infield.append(b)
            elong = float(get_body("sun", t).separation(centre).deg)
            # Earth's barycentric velocity -> apparent drift of a stationary body at 1 AU
            _, vel = get_body_barycentric_posvel("earth", t)
            v = vel.xyz.to(u.km / u.s).value
            per_au = ARCSEC_PER_RAD * 3600.0 / AU_KM          # km/s -> arcsec/hour at 1 AU
            reflex = [round(float(-np.dot(v, east) * per_au), 3), round(float(-np.dot(v, north) * per_au), 3)]
            out["frames"][f["id"]] = {"utc": f["utc"], "mjd": f["mjd"], "pos": pos, "in_field": infield,
                                      "elong": round(elong, 2), "reflex": reflex}
            src = os.path.basename(f["source"])
            if src in obj:
                out["target"][f["id"]] = [round(obj[src][0], 4), round(obj[src][1], 4)]
    if not out["target"] and old.get("target"):
        out["target"] = old["target"]
    json.dump(out, open(sky_path, "w"), separators=(",", ":"))
    from regions_util import add_extra
    add_extra(a.tiles_root, a.region, "sky")
    print(f"wrote {sky_path}: {len(out['frames'])} frames, {len(out['target'])} target positions")
    ins = {k: v["in_field"] for k, v in out["frames"].items() if v["in_field"]}
    print("planets inside the field:", ins or "none")
    r = [np.hypot(*v["reflex"]) for v in out["frames"].values()]
    print(f"reflex drift at 1 AU: {min(r):.0f}-{max(r):.0f} arcsec/h  (500 AU body: {min(r)/500:.3f}-{max(r)/500:.3f} arcsec/h)")


if __name__ == "__main__":
    main()