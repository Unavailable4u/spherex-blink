from astroquery.ipac.irsa import Irsa
from astropy.coordinates import SkyCoord
from astropy.time import Time
import astropy.units as u
import numpy as np

coord = SkyCoord(ra=210.80227, dec=54.34895, unit="deg")
res = Irsa.query_sia(pos=(coord, 0.05 * u.deg), collection="spherex_qr2")

t = Time(np.array(res["t_min"], dtype=float), format="mjd")
order = np.argsort(t.mjd)
res = res[order]
t = t[order]

print("First obs:", t[0].iso)
print("Last obs: ", t[-1].iso)

print("\nImages per bandpass name:")
names, counts = np.unique(res["energy_bandpassname"], return_counts=True)
for n, c in zip(names, counts):
    print(f"  {n}: {c}")

print("\nWavelength range (microns):",
      float(np.min(res["em_min"])) * 1e6, "to", float(np.max(res["em_max"])) * 1e6)

# Group into "epochs": a new epoch starts after a gap of more than 30 days
gaps = np.diff(t.mjd)
breaks = np.where(gaps > 30)[0]
starts = np.concatenate(([0], breaks + 1))
ends = np.concatenate((breaks + 1, [len(t)]))

print(f"\nEpochs found (gap > 30 days): {len(starts)}")
for i, (s, e) in enumerate(zip(starts, ends), 1):
    print(f"  Epoch {i}: {t[s].iso[:10]} to {t[e-1].iso[:10]}  ({e - s} images)")

print("\nSample access_url:")
print(res["access_url"][0])