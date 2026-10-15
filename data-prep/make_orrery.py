#!/usr/bin/env python3
"""Planet positions for the Solar System panel -> ../web/tiles/orrery.json   (offline, astropy builtin ephemeris)

    python make_orrery.py
Daily heliocentric positions (ecliptic x,y,z in AU) for Sep 2025 - Dec 2026, plus one full orbit per planet.
"""
import argparse, json, os, warnings
import numpy as np
from astropy.time import Time
from astropy.coordinates import get_body_barycentric, solar_system_ephemeris

warnings.filterwarnings("ignore")
NAMES = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]
PERIOD_DAYS = dict(mercury=88, venus=225, earth=365.25, mars=687, jupiter=4333, saturn=10759, uranus=30687, neptune=60190)
E = np.radians(23.4392911)
ROT = np.array([[1, 0, 0], [0, np.cos(E), np.sin(E)], [0, -np.sin(E), np.cos(E)]])   # ICRS -> ecliptic


def helio(name, t):
    p = get_body_barycentric(name, t).xyz.to("au").value - get_body_barycentric("sun", t).xyz.to("au").value
    return ROT @ p                                                                    # shape (3, N)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2025-09-01"); ap.add_argument("--end", default="2026-12-31")
    ap.add_argument("--out", default=os.path.join("..", "web", "tiles", "orrery.json"))
    a = ap.parse_args()
    t0, t1 = Time(a.start), Time(a.end)
    mjd = np.arange(int(t0.mjd), int(t1.mjd) + 1)
    t = Time(mjd, format="mjd")
    out = {"mjd0": int(mjd[0]), "days": len(mjd), "bodies": {}}
    with solar_system_ephemeris.set("builtin"):
        for n in NAMES:
            pos = helio(n, t).T
            to = Time(t0.mjd + np.linspace(0, PERIOD_DAYS[n], 181), format="mjd")
            orb = helio(n, to)[:2].T
            out["bodies"][n] = {"pos": np.round(pos, 4).tolist(), "orbit": np.round(orb, 3).tolist()}
    json.dump(out, open(a.out, "w"), separators=(",", ":"))
    print("wrote", a.out, os.path.getsize(a.out) // 1024, "KB;", len(mjd), "days")
    e = np.array(out["bodies"]["earth"]["pos"]); print("Earth radius range (AU):", e[:, :2].__pow__(2).sum(1).__pow__(.5).min().round(3), "-", e[:, :2].__pow__(2).sum(1).__pow__(.5).max().round(3))

if __name__ == "__main__":
    main()
