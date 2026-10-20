# SPHEREx Blink Comparator

An interactive, public-facing web app for the NASA Space Apps 2026 challenge **Planet X and SPHEREx**. It shows real
SPHEREx infrared images of one patch of sky taken on different dates, so anything that moves jumps out: the blink
technique Clyde Tombaugh used to find Pluto. Then it helps you decide *what* moved, and how far away it is.

**Live site:** <https://unavailable4u.github.io/spherex-blink/> (hosted on GitHub Pages, see [Deploy](#deploy)).
Open it, press **Tour**, and the app walks through the whole idea in about a minute.

## The four things the challenge asks for

| Challenge requirement | What the app does | Where |
|---|---|---|
| **Multi-epoch comparison** (blink / time-lapse) | Blink two frames at 1-5 Hz, an amber/cyan **overlay** of both, a time bar with crossfade, a *Best pair* picker that favours frames days apart with similar wavelength and a big shared footprint, and a *pass* switcher for survey passes six months apart | left rail, time bar |
| **Spectral band navigation** | Band plates for the detectors each field carries (D1-D6, 2 to 6 per field) with wavelength range and frame count; each frame is labelled with its wavelength; warns when two frames differ too much in colour to compare brightness | left rail |
| **Interactive data and metadata** | Click a source: it snaps to the centroid, then shows RA/Dec (decimal and sexagesimal), galactic and ecliptic coordinates, pixel, band, wavelength at that pixel, frame time and intensity. A **mover check** tells you whether it stays put in the other frames | Inspect tab |
| **Crowdsourced anomaly flagging** | Flag as asteroid / comet / planet candidate with a note; the flag is cross-matched against the known object, listed, shown as a pin, and exportable as CSV or JSON. Shared through Firestore when configured (see [shared flags](docs/FLAGS_SETUP.md)); the panel always states whether flags are shared or only in this browser | Inspect tab |

On top of that, for the Planet X theme: an all-sky map of where the field is, a top-down Solar System view, DSS2 / 2MASS / WISE
comparison layers, and the **Planet X lab**: pick a distance and see how far a body there would appear to shift (from exact
parallax, not an approximation), measure a mover and get a rate and a distance range with honest error bars, and see how much
more signal a second pass six months later would add.

## What is real, what is simulated, what is limited

* **Real:** 20 fields built from SPHEREx Quick Release 2 (QR2) spectral images, 219 frames in all, each reprojected onto one sky grid per field:
  16 asteroid fields (Pallas, Vesta, Ceres, Juno, Iris, Hygiea, Eunomia, Psyche, Astraea, Hebe, Metis, Parthenope, Victoria, Fortuna, Massalia, Davida),
  the *Pallas patch, six months apart* (three survey passes: Apr 2025, Oct 2025, Apr 2026), the north and south ecliptic poles and a Galactic centre patch.
  The original *Pallas field* (13 frames, 6-14 Oct 2025) is the cleanest demo: the asteroid really moves across it.
* **Checked, not drawn:** `data-prep/verify_target.py` looks for a real source at each target's ephemeris position in every frame.
  Across the 16 asteroid fields it finds the object in **148 of 150** frames. For Pallas it is **13/13**, rms offset **0.57 px (3.5 arcsec)**, and gone from that pixel in the other frames in 13/13.
  The stricter "also gone from that pixel elsewhere" check passes in 107 of 150 frames overall: Juno, Hebe, Hygiea and Massalia move only about 2 to 11 pixels in their windows, so they cannot pass it, and Ceres passes 0/8 despite moving far (not yet explained).
  The numbers are shown in the Context tab; Pallas sets the error bar in the Planet X lab.
* **Simulated:** the *Practice field* has planted movers and two passes 90 days apart. It is badged **simulated** everywhere (menu, banner, saved images).
* **Prototype, not a discovery tool:** 21 fields are shipped (20 real, 1 simulated), a sample of the sky rather than the survey. Only the Pallas patch has a real six-month baseline over three passes; the ecliptic poles and Galactic centre have two passes but few frames (2 to 4); the asteroid fields span a few days to two weeks. The pipeline builds more with one command ([adding fields](docs/ADDING_FIELDS.md)); newer Quick Release 3 data (September 2026) is not used yet. Nothing here claims a detection:
  a flag is a candidate for follow-up and the distance fit says *candidate*.
* **Few colours per field:** each field keeps 2 to 6 of the detectors D1-D6, and each frame samples part of a detector, so you see a handful of SPHEREx's 102 channels.
* **8-bit tiles:** intensity readouts are approximate (saturated cores are marked as lower limits). Frames in one band sit at different wavelengths, so judge movers by position, not brightness.
* **Cosmic rays:** single-event hits look like crisp little blobs. The mover check says "could be a cosmic ray" instead of calling them movers.

## Using it

Space = blink, O = overlay, B = set frame B, X = swap, arrow keys = step through time, scroll / pinch / + - = zoom, double-click = zoom in, click = inspect.
*Copy link* reopens the exact field, band and frame pair. *Save image* writes a PNG with caption and credits. Untick **Known objects** to hunt blind, then flag what you find.

## Run locally

```bash
cd web
python -m http.server 8000      # Windows: py -m http.server 8000
```

Open <http://localhost:8000>. (It must be served over http: browsers block `fetch()` on `file://`.)

## Tests

```bash
node tests/run.js                       # unit tests, no browser: WCS vs astropy, parallax vs independent reflex integral, flag export
cd tests/e2e && npm i && node e2e.js    # 30+ browser checks against a running local server (blink, Space bar, overlay, mover check, flags, Planet X, tour ...)
python data-prep/verify_target.py --region pallas   # is the known object really in the pixels?
```

## Deploy

GitHub Pages, no build step: **Settings → Pages → Source: GitHub Actions**, then push to `main`. `.github/workflows/pages.yml` runs the unit tests,
leaves the `previews/` folders out, and publishes `web/`. (Netlify also works: `netlify.toml` points at `web/`.) All paths are relative, so it runs from a sub-path.

## Shared flags

By default flags live in each visitor's browser and the panel says so. To share them between visitors, create a free Firebase project and fill in `web/js/config.js`;
the security rules in `firebase/firestore.rules` stop anyone editing or deleting data. Step by step: [docs/FLAGS_SETUP.md](docs/FLAGS_SETUP.md).

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

The synthetic field has two survey passes 90 days apart, so it is also the way to try the multi-epoch controls. It is labelled *simulated* in the app.

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
  the wavelength at any clicked pixel. Wavelength is read from the documented
  alternate-WCS layout of each file; if that fails the frame is still built and
  `wavelength_um` is `null`, and the app shows an estimate from the fitted plane, marked with ≈.
* **Brightness is stretched per band with one shared range**, so blinking between frames
  does not flicker. To convert a clicked pixel back to approximate flux, see
  `intensity_note` in `manifest.json`.
* Commit the generated `web/tiles/` so the deployed site has them (tiles are small PNGs;
  check the folder size after your first real run). Raw FITS stay out of git (`raw/` and
  `*.fits` are ignored).

## Layout

```
data-prep/
  build_field.py       one command: find -> download -> tiles -> sky context -> validation -> references
  find_target.py       find an asteroid + the SPHEREx images that contain it
  download_cutouts.py  fetch FITS cutouts from IRSA
  fits_to_png.py       reproject, stretch, write tiles + wcs.json + manifest.json
  solar_system.py      planets, Sun, known target, Earth-reflex drift -> sky.json
  verify_target.py     is the known object really in the pixels? -> validation.json
  fetch_reference.py   DSS2 / 2MASS / WISE / Hubble on the tile grid -> ref/
  fetch_planets.py     NASA/ESA/ESO images for the Solar System view
  make_synthetic.py    fake data for offline development (the Practice field)
web/
  index.html  css/  js/  assets/  tiles/        the viewer (static files only)
  js/renderer.js       tiles, no-data masks, blink, overlay, centroiding, mover-check helpers
  js/parallax.js       exact parallax from Earth's orbit, distance fit
  js/controls.js       app glue          js/flagging.js  shared / local flags
tests/                 unit tests (node) and browser tests (tests/e2e)
docs/                  adding fields, shared flags, pitch and demo script
firebase/              Firestore security rules
```

## Data and acknowledgement

SPHEREx images come from the NASA/IPAC Infrared Science Archive (IRSA), Quick Release 2 (DOI 10.26131/IRSA652), under the acknowledgement IRSA requests for published SPHEREx work. The app shows that text in the footer and in **About**; it is stored in `web/assets/acknowledgement.txt`, and `node tests/run.js` checks it is IRSA's exact wording. Other data: DSS2 (STScI, mirrored at IRSA), 2MASS (UMass and IPAC/Caltech, funded by NASA and NSF) and WISE (UCLA and JPL/Caltech, funded by NASA) via CDS hips2fits; exact wording for 2MASS and WISE is on their IRSA pages ([2MASS](https://irsa.ipac.caltech.edu/Missions/2mass.html), [WISE](https://irsa.ipac.caltech.edu/Missions/wise.html)); ephemerides from JPL Horizons and astropy; planet photos and the Milky Way panorama are credited in the app.

## Design notes

The interface is set in Computer Modern (the TeX typeface, SIL OFL, self-hosted in `web/assets/fonts`). It is laid out like a figure in a paper: RA/Dec rulers, a compass and scale bar on the image, a live caption, numbered sections and booktabs-style tables. Palette: ink-black sky, ivory text, one infrared amber, teal for known bodies, vermilion for flags, cyan for the second frame. Frames with no coverage are drawn as a hatch, not black. All styling is in `web/css/style.css`.
