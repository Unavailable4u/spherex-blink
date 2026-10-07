# SPHEREx Blink Comparator

A browser-based blink comparator for SPHEREx sky images, built for the NASA Space Apps
"Planet X and SPHEREx" challenge. Flip between observations of the same patch of sky and
anything that moves jumps out - the same technique Clyde Tombaugh used to find Pluto.

## Status

| Part | State |
|---|---|
| Data pipeline (`data-prep/`) | Done and tested on synthetic data. **Not yet run on real IRSA data.** |
| Web viewer (`web/`) | Placeholder page only: canvas, blink, bands, click-to-inspect and flagging still to build |
| Deploy, demo video, pitch | Not started |

## Run the website locally

The page loads tiles and JSON with `fetch()`, which browsers block on `file://` URLs, so it
must be served over http. From the repo root:

```bash
cd web
python -m http.server 8000      # on Windows you can also use:  py -m http.server 8000
```

Then open <http://localhost:8000>. (Alternative: install the **Live Server** extension in
VS Code, right-click `web/index.html`, choose *Open with Live Server*.)

Right now this shows the title and a dark canvas with the words "Canvas works" in the
top-left corner. That is expected: the real viewer is the next milestone.

## Data pipeline

```bash
cd data-prep
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Try it without internet access to IRSA (fake data)

```bash
python make_synthetic.py                 # raw/synthetic/*.fits  (fake cutouts, with truth.json)
python fits_to_png.py --region synthetic # ../web/tiles/synthetic/
```

This is also what the front-end developers should build against until real tiles exist.

### Real data

1. **Find a real moving object** that SPHEREx actually imaged (needs internet):

   ```bash
   python find_target.py --target Pallas --start 2025-09-01 --end 2025-10-15
   ```

   SPHEREx points about 90 degrees from the Sun, so an asteroid is only covered near
   quadrature. If a target returns nothing, try another asteroid or other dates. It prints
   the frames found, brightness, sky motion and a recommended field centre and size, and
   saves `raw/<region>/candidates.json`. Keep the date window short (a few days to a couple
   of weeks) so the field stays small. Newer data (QR3, from Sept 2026) may live in a
   different collection: pass `--collection <name>` (list them with
   `Irsa.list_collections(servicetype="SIA")` from astroquery).

2. **Download cutouts** (fixed centre, one cutout per image containing the object):

   ```bash
   python download_cutouts.py --region pallas
   ```

   Cutouts are requested 1.45x larger than the final field, because each exposure has its
   own roll angle and a same-size cutout would leave empty corners after rotation.
   Re-running skips files already downloaded. The old one-image-per-epoch behaviour is still
   there: `python download_cutouts.py --region m101 --ra 210.80227 --dec 54.34895 --mode best`.

3. **Build tiles**:

   ```bash
   python fits_to_png.py --region pallas
   ```

   Output goes to `web/tiles/<region>/`:

   | File | What |
   |---|---|
   | `<band>/<frame_id>.png` | 8-bit greyscale tile, north up, east left, every tile identical in size and sky grid |
   | `wcs.json` | The single sky grid shared by all tiles (pixel to RA/Dec, plus check points for testing JS) |
   | `manifest.json` | Every frame: date, band (detector D1-D6), wavelength, stretch parameters, background |
   | `previews/` | `contact_<band>.png` and `blink_<band>.gif` - open these first to eyeball the result |

   `web/tiles/regions.json` lists all built regions for the app.

### Things to know

* **A "band" is a detector (D1-D6), not one wavelength.** Wavelength changes across each
  detector, so the manifest stores a small plane fit per frame (`wavelength_plane`) to give
  the wavelength at any clicked pixel. Wavelength extraction follows the documented
  alternate-WCS layout but has not been run on a real file yet; if it fails the frame is
  still built and `wavelength_um` is `null`.
* **Brightness is stretched per band with one shared range**, so blinking between frames
  does not flicker. To convert a clicked pixel back to approximate flux, see
  `intensity_note` in `manifest.json`.
* Commit the generated `web/tiles/` so the deployed site has them (tiles are small PNGs;
  check the folder size after your first real run). Raw FITS stay out of git (`raw/` and
  `*.fits` are ignored).

## Layout

```
data-prep/
  find_target.py       step 1: find asteroid + SPHEREx images that contain it
  download_cutouts.py  fetch FITS cutouts from IRSA
  fits_to_png.py       step 2: reproject, stretch, write tiles + wcs.json + manifest.json
  make_synthetic.py    fake data for offline development and testing
  explore*.py, inspect_fits.py, test_one.py   earlier exploration scripts
web/
  index.html  css/  js/        the viewer
  tiles/                       generated; served with the site
```

## Acknowledgement

**TODO before submission:** paste the official SPHEREx data-use acknowledgement statement
here, and cite the DOI of the release you used. The exact wording is on IRSA's
[SPHEREx Quick Release overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html)
page (it lists the DOIs for QR2 and QR3 as well).
