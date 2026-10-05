import os
import numpy as np
import requests
from astroquery.ipac.irsa import Irsa
from astropy.coordinates import SkyCoord
from astropy.time import Time
import astropy.units as u

REGION = "demo"
COORD = SkyCoord(ra=210.80227, dec=54.34895, unit="deg")
CUTOUT_SIZE = "0.1deg"      # about 60 SPHEREx pixels (6.15 arcsec each)
OUT_ROOT = os.path.join("raw", REGION)

res = Irsa.query_sia(pos=(COORD, 0.05 * u.deg), collection="spherex_qr2")

# Sort by time and label epochs (new epoch after a gap > 30 days)
t = Time(np.array(res["t_min"], dtype=float), format="mjd")
order = np.argsort(t.mjd)
res = res[order]
t = t[order]
epoch = np.zeros(len(t), dtype=int)
epoch[1:] = np.cumsum(np.diff(t.mjd) > 30)
epoch += 1

# Angular distance from each image center to the target
centers = SkyCoord(np.array(res["s_ra"]) * u.deg, np.array(res["s_dec"]) * u.deg)
sep = centers.separation(COORD).deg

bands = sorted(set(str(b) for b in res["energy_bandpassname"]))

for e in sorted(set(epoch)):
    for b in bands:
        idx = [i for i in range(len(res))
               if epoch[i] == e and str(res["energy_bandpassname"][i]) == b]
        if not idx:
            print(f"epoch {e} {b}: no images")
            continue
        best = min(idx, key=lambda i: sep[i])
        url = (f"{res['access_url'][best]}"
               f"?center={COORD.ra.deg},{COORD.dec.deg}d&size={CUTOUT_SIZE}")
        folder = os.path.join(OUT_ROOT, f"epoch{e}")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{b}.fits")
        if os.path.exists(path):
            print(f"epoch {e} {b}: already have it")
            continue
        try:
            r = requests.get(url, timeout=180)
            r.raise_for_status()
            with open(path, "wb") as f:
                f.write(r.content)
            print(f"epoch {e} {b}: saved {len(r.content)//1024} KB ({t[best].iso[:10]})")
        except Exception as ex:
            print(f"epoch {e} {b}: FAILED {ex}")