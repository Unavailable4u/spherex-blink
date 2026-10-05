from astroquery.ipac.irsa import Irsa
from astropy.coordinates import SkyCoord
import astropy.units as u

# Test position (swap in your own region later)
coord = SkyCoord(ra=210.80227, dec=54.34895, unit="deg")

results = Irsa.query_sia(
    pos=(coord, 0.05 * u.deg),
    collection="spherex_qr2",
)

print("Rows:", len(results))
print("Columns:", results.colnames)
print(results[:5])