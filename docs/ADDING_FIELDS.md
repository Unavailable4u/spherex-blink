# Adding fields (the single biggest upgrade)

The app ships 20 real fields (the `pallas-6mo` patch already spans three survey passes). The challenge is about the whole sky and about images **six months apart**, so more fields,
and more survey passes (QR3, from September 2026), are the best use of an hour. The viewer already handles both; you only need data.
Everything below needs internet access to IRSA, JPL Horizons and CDS, and `pip install -r data-prep/requirements.txt`.

## 1. More survey passes (six-month baseline). `pallas-6mo` is already built; this is the recipe

SPHEREx sees each patch of sky about every six months, and the second all-sky pass finished in spring 2026, so the sky
around the Pallas field was almost certainly observed again around April to May 2026. Build it as a fixed patch:

```bash
cd data-prep
python build_field.py --region pallas-6mo --ra 303.443371 --dec 2.665365 --size 1.749 \
       --collection spherex_qr2 --title "Pallas patch, six months apart" \
       --blurb "The same patch of sky in two survey passes six months apart. Stars stay put; a distant body would shift by parallax."
```

(`--mode best` is used automatically: one best image per survey pass and band.) What you get in the app, with no code changes:

* a **Pass 1 / Pass 2** switcher under the time bar, second-pass frames in cyan on the timeline,
* *Best pair* choosing a cross-pass pair, with the note "different survey passes, about N months apart",
* the **Planet X lab** and **Measure a mover** using the real six-month baseline: a body at 500 AU shifts about 126 pixels instead of about 4,
  so a distance estimate becomes meaningful. The maths (`web/js/parallax.js`) is exact for any baseline up to Dec 2026 (the range of `tiles/orrery.json`;
  re-run `make_orrery.py` for later dates).

If the second pass is not in `spherex_qr2`, list the available collections with astroquery's `Irsa.list_collections(servicetype="SIA")` and pass the newer name.
The Sept 2026 release may live in a different collection.

## 2. More moving targets

```bash
python build_field.py --region vesta --target 4 --target-name "(4) Vesta" \
       --start 2025-08-01 --end 2025-08-20 --title "Vesta field" \
       --blurb "The second most massive asteroid, caught drifting between SPHEREx visits."
```

`find_target.py` prints what SPHEREx actually imaged and fails politely if nothing did: SPHEREx points about 90 degrees from the Sun, so an asteroid is
only covered near quadrature. Try other bright asteroids (Ceres, Juno, Iris, Hygiea, Eunomia, Psyche ...) or other dates. Keep the window to a few days or
two weeks so the field stays small. `build_field.py` ends with `verify_target.py`, which checks the object really is in the pixels; if it says fewer frames
than expected, look at `web/tiles/<region>/previews/` before you ship the field.

## 3. What the builder does

`find_target -> download_cutouts -> fits_to_png -> solar_system -> verify_target -> fetch_reference`, then writes `title`, `blurb`, `kind` and the list of
optional layers (`extras`) into `web/tiles/regions.json`. Each step is cached, so re-running after a failure is cheap. `--dry-run` prints the commands.
The field then appears in the **Field** menu and works at `?region=<id>`. Commit `web/tiles/<region>/` and `regions.json`.

## 4. Before you ship a field

* Open its `previews/contact_<band>.png` and `blink_<band>.gif`.
* Run `python verify_target.py --region <id>` for target fields; run `node tests/run.js` from the repo root (it checks every region's WCS against astropy).
* Check the size of `web/tiles/<region>/` (GitHub Pages handles hundreds of MB, but keep each field to tens).
