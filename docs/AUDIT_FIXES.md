# Audit follow-up: what changed, what is left for you

## The 13 audit items

| # | Audit finding | Result |
|---|---|---|
| 1 | Not deployed | **Ready, needs one click from you.** `.github/workflows/pages.yml` deploys `web/` (11 MB, previews excluded) after unit tests. Enable *Settings → Pages → Source: GitHub Actions*, push to `main`. Tested serving from a sub-path with zero failing requests. |
| 2 | Acknowledgement TODO | **Credit line and DOI (10.26131/IRSA652) are in the app footer, About dialog and README**, from one file `web/assets/acknowledgement.txt`. It holds a faithful paraphrase: **paste IRSA's exact required sentence into that file before submitting.** |
| 3 | Only one field | **Everything except the data is done.** `build_field.py` builds a field in one command, and the app is genuinely multi-epoch (pass switcher, cross-pass best pair, exact parallax for any baseline). Needs internet to IRSA: see `docs/ADDING_FIELDS.md` (first step: a second pass for the Pallas patch, six months apart). |
| 4 | Pallas overlay might not land on a mover | **False alarm, now proven.** `verify_target.py`: found in 13/13 frames, rms offset 0.57 px (3.5″), gone from that pixel in the other frames 13/13. Shown in the Context tab. The streak the audit saw is something else. |
| 5 | Frames in a band at different wavelengths | **Fixed.** Every frame shows its wavelength; a warning appears above 8% difference; *Best pair* favours similar wavelength. The D4 frame with no header wavelength gets an estimate from its fitted plane, shown with ≈. |
| 6 | Patchy coverage, orphan D6 | **Fixed.** Blink uses the shared footprint only (toggle), no-data is a hatch instead of black wedges, and the overlap % is shown. Orphan `D6` tile removed. D5 still has only two frames: that is the data. |
| 7 | 8-bit tiles | Unchanged and labelled; saturated cores are now shown as lower limits (≥). |
| 8 | Flagging not crowdsourced | **Honest and ready.** The panel says *shared with everyone* or *saved in this browser only*; CSV/JSON export; delete own local flags; cross-match with the known object; Firestore rules + guide in `docs/FLAGS_SETUP.md`. Sharing needs your Firebase keys in `web/js/config.js`. |
| 9 | `synthetic` selectable | **Fixed.** Grouped as *Simulated (practice)*, badged, banner in the viewer, marked on saved images. |
| 10 | Space-bar double toggle | **Fixed and tested** in a real browser: one toggle per press, also right after clicking the button, auto-repeat ignored, works with a button focused. |
| 11 | Shaky distance verdict | **Rewritten.** Exact parallax from Earth's orbit, error bars from measured scatter, a distance *range*, a "too far for this baseline" limit, and wording that says *candidate*, never *found*. Validated against the independent reflex integral (agree to 0.2%). |
| 12 | Stale README | Rewritten. |
| 13 | No demo video / pitch | `docs/PITCH.md`: pitch structure, 2:30 demo script, judge Q&A. The in-app **Tour** is the demo backbone. Recording the video is yours. |

## Other gaps found and fixed

* **Half-pixel misplacement:** every SVG overlay (known object, flags, crosshair, rulers) was drawn half a pixel off the image; visible when zoomed in.
* **Planet X track drawn by default** on the main sky, easy to mistake for a detection. Now shown only on the Planet X tab.
* **Clicking the sky while on the Planet X tab threw you back to Inspect**, so "Mark A/B" was awkward. Fixed.
* **Race conditions:** switching field or band quickly could paint stale frames. Loads are now token-guarded.
* **Cosmic rays** were indistinguishable from movers. The mover check now measures brightness against what a star should be in the other frame, and says so when something looks like a cosmic-ray hit.
* **Measurement precision:** clicks snap to the source centroid; error bars use the scatter measured on Pallas.
* **Mobile / tablet:** header overflow at 390 px and a broken medium-width layout are fixed (single column below 1200 px); pinch zoom and double-click zoom added.
* **Console noise:** optional files are no longer probed on fields that lack them (no 404s).
* **Extras:** shareable URL (field, band, frame pair), Save image (PNG with caption and credits), blink rate, amber/cyan overlay, pass switcher, guided tour, unit tests (WCS vs astropy, parallax), browser tests (31 checks).

## Not done (needs access I do not have from here)

IRSA / JPL / CDS were not reachable from the build sandbox, so no new SPHEREx data was downloaded and `build_field.py` has been dry-run and flag-checked but not run live. The app has not been tested on iOS Safari or Firefox (it was tested in headless Chromium at 390, 820, 1024, 1100, 1280, 1440 and 1920 px wide).
