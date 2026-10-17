"""Tiny helper: record which optional layers a field has in web/tiles/regions.json.

The web app reads "extras" (sky = sky.json, ref = reference images, validation = validation.json) so it does not
probe for files that do not exist and fill the browser console with 404s.
"""
import json, os


def add_extra(tiles_root, region, name):
    path = os.path.join(tiles_root, "regions.json")
    if not os.path.exists(path):
        return
    data = json.load(open(path))
    for r in data.get("regions", []):
        if r["id"] == region:
            ex = set(r.get("extras", []))
            ex.add(name)
            r["extras"] = sorted(ex)
    json.dump(data, open(path, "w"), indent=2)
