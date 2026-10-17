# Pitch, demo script and judge Q&A

## One sentence

A blink comparator for real SPHEREx images that finds what moves, checks that it is real, and tells you whether it is a nearby asteroid or a candidate for something far beyond Neptune.

## Pitch structure (3 minutes)

1. **Problem (20 s).** SPHEREx maps the whole sky in 102 colours every six months: far too much for people to check by hand, and the sky is full of things that move, from asteroids to, perhaps, an unseen planet.
2. **What we built (40 s).** Real SPHEREx frames in a browser. Blink two dates, or overlay them in amber and cyan. Click a source: it snaps to the centre, reads out its coordinates and colour, and checks whether it stays put in the other frames. Flag it; flags are cross-matched against the known object and exportable.
3. **Why you can trust it (30 s).** We do not just draw the known asteroid: `verify_target.py` finds it in 13 of 13 frames, within 0.57 pixel (3.5 arcsec) of its ephemeris, and it is gone from that pixel in the other frames. That scatter is the error bar the tool uses. The mover check is honest about cosmic rays and about frames at different wavelengths.
4. **Planet X (50 s).** A distant body is nearly still, but Earth moves, so it shifts by parallax. We compute that exactly from Earth's orbit. In this field's week a body at 500 AU moves about 4 pixels; six months later, about 126. So the tool shows what a second pass buys, fits a distance range to a measured mover, and says *candidate*, never *found*. A second survey pass slots straight in (a pass switcher appears; no code change).
5. **Close (20 s).** Public, free, static: one link. Flags can be shared through Firestore; exports go to CSV or JSON for follow-up. Next: more fields and the second pass.

## Demo script (2:30, uses the in-app **Tour** as a backbone)

| Time | Do | Say |
|---|---|---|
| 0:00 | Open the link. Pallas field, D1. | "Real SPHEREx images of one patch of sky on two dates. Almost everything is a star." |
| 0:15 | **Space** (blink). | "Stars stay put. One dot jumps. That is how Pluto was found." |
| 0:35 | **O** (overlay). | "Amber is the earlier frame, cyan the later. A mover splits into a pair." |
| 0:50 | Untick **Known objects**, blink again, click the jumping dot. | "Hunting blind. It snaps to the source and runs a mover check: gone from the other frames, so it moves." |
| 1:10 | Re-tick Known objects. Flag it. | "Cross-matched: that is (2) Pallas, a known asteroid, so not a discovery. Flags export to CSV." |
| 1:30 | Context tab. | "And we checked the overlay against the pixels: 13 of 13 frames." |
| 1:45 | Planet X tab, drag the distance. Mark A, step time, Mark B on Pallas. | "A distant planet would shift a few pixels in this window, about 126 pixels over six months. Pallas moves 28 arcsec an hour, far too fast: nearby." |
| 2:15 | Click D5 or point at the hatched no-coverage region. | "It is honest about limits: coverage gaps, cosmic rays, wavelength changes." |
| 2:30 | End on the link. | |

Always record a backup video of this first (venue wifi fails). Use the **Save image** button for slide figures.

## What a real Planet X detection would look like through this tool

Two survey passes six months apart. A faint source that is **absent from the same pixel** in the other pass, whose displacement is **small and in the direction parallax predicts** (the fit reports the predicted and measured directions), consistent with one distance between roughly 100 and a few thousand AU. It would be flagged as a *planet candidate*, exported, and followed up with deeper imaging, never announced from one tool.

## Judge Q&A

* **Is this real data?** Yes: IRSA SPHEREx Quick Release 2 images, DOI 10.26131/IRSA652. The Practice field is simulated and labelled as such everywhere.
* **Only one field?** One real field is shipped; `build_field.py` builds another with one command, and the second pass for the same patch is the recommended next step ([docs/ADDING_FIELDS.md](ADDING_FIELDS.md)).
* **Why not use all 102 bands?** The cutouts keep four detectors (D1, D2, D4, D5), each a band of wavelengths; each frame samples part of its detector. The wavelength of every frame and clicked pixel is shown.
* **How accurate is the distance?** The error bar comes from measured scatter on a real asteroid (0.57 px rms), assumes a bright source, and assumes the body's own motion is small (true beyond ~100 AU). Faint sources scatter more.
* **How do you tell a mover from a cosmic ray?** A real source has a soft point-spread halo and a few pixels; a cosmic-ray hit is crisp. The tool flags the second kind as "could be a cosmic ray" instead of calling it a mover.
* **Is it crowdsourced?** The mechanism is built (Firestore rules, export, cross-match); it is shared only when connected, and the panel says which mode is active.
* **Why 8-bit tiles?** Small and fast over the web; stretched with one range per band so blinking does not flicker. Intensity is marked approximate.
