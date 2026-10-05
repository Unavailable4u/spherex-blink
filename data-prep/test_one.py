import time
import requests
from astroquery.ipac.irsa import Irsa
from astropy.coordinates import SkyCoord
import astropy.units as u

coord = SkyCoord(ra=210.80227, dec=54.34895, unit="deg")
res = Irsa.query_sia(pos=(coord, 0.05 * u.deg), collection="spherex_qr2")

base = str(res["access_url"][0])
url = f"{base}?center={coord.ra.deg},{coord.dec.deg}d&size=0.05deg"
print("URL:", url)

headers = {"User-Agent": "spherex-blink-hackathon/0.1"}
for attempt in range(1, 4):
    t0 = time.time()
    try:
        r = requests.get(url, headers=headers, timeout=(30, 300), stream=True)
        print("status:", r.status_code, r.headers.get("Content-Type"))
        data = b"".join(r.iter_content(65536))
        print(f"attempt {attempt}: {len(data)//1024} KB in {time.time()-t0:.1f}s")
        if r.status_code == 200:
            open("test.fits", "wb").write(data)
        break
    except Exception as ex:
        print(f"attempt {attempt} failed after {time.time()-t0:.1f}s: {type(ex).__name__}")
        time.sleep(5)