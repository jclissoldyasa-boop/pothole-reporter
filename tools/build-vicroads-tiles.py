#!/usr/bin/env python3
"""Builds dtp/*.json: the roads VicRoads (Department of Transport and Planning) manages, cut into small map tiles.

Source: "DTP Managed Roads" open data (CC BY 4.0), Department of Transport and Planning, Victoria.
  https://discover.data.vic.gov.au/dataset/dtp-managed-roads
Download the GeoJSON, then:  python3 tools/build-vicroads-tiles.py dtp_managed_roads.geojson

Each tile covers 0.05 degrees square (about 5 km) and is named "<x>_<y>.json" for floor(lng*20), floor(lat*20).
A road section goes in every tile it comes within about 60 m of, so the app only ever needs the one tile it's in.
Tile format: {"n":[names], "s":[[[name indexes], ref, lng0, lat0, dlng1, dlat1, ...], ...]}
with coordinates in 1e-5 degrees (about 1 m), each point after the first as a difference from the one before.
Names are normalised the way app.js's norm() does it: lower case, hyphens and dots to spaces.
"""
import json, math, os, re, sys

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dtp")
PAD = 0.0006  # degrees, about 60 m

def norm(s):
    s = s.lower()
    s = re.sub(r"[-–—'.]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def names(p):
    out = []
    for n, t in (("DEC_NAME", "DEC_TYPE"), ("RD_NAME", "RD_TYPE"), ("LOCAL_NAME", "LOCAL_TYPE"),
                 ("ALT_NAME", "ALT_TYPE"), ("ALT2_NAME", "ALT2_TYPE")):
        a, b = (p.get(n) or "").strip(), (p.get(t) or "").strip()
        if not a or b == "RAMP":
            continue
        v = norm(a + " " + b)
        if v and v not in out:
            out.append(v)
    return out

feats = json.load(open(SRC))["features"]
tiles = {}
for f in feats:
    g = f.get("geometry") or {}
    if g.get("type") != "LineString":
        continue
    pts = [(round(x * 1e5), round(y * 1e5)) for x, y in g["coordinates"]]
    if len(pts) < 2:
        continue
    p = f["properties"]
    ref = (p.get("SRNS") or "").strip()
    ref = "" if ref == "N" else ref
    nm = names(p)
    xs = [x / 1e5 for x, _ in pts]; ys = [y / 1e5 for _, y in pts]
    flat = [pts[0][0], pts[0][1]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        flat += [x1 - x0, y1 - y0]
    for tx in range(math.floor((min(xs) - PAD) * 20), math.floor((max(xs) + PAD) * 20) + 1):
        for ty in range(math.floor((min(ys) - PAD) * 20), math.floor((max(ys) + PAD) * 20) + 1):
            t = tiles.setdefault((tx, ty), {"n": [], "s": []})
            idx = []
            for n in nm:
                if n not in t["n"]:
                    t["n"].append(n)
                idx.append(t["n"].index(n))
            t["s"].append([idx, ref] + flat)

os.makedirs(OUT, exist_ok=True)
for fn in os.listdir(OUT):
    if fn.endswith(".json"):
        os.remove(os.path.join(OUT, fn))
total = 0
for (tx, ty), t in tiles.items():
    s = json.dumps(t, separators=(",", ":"))
    total += len(s)
    with open(os.path.join(OUT, "%d_%d.json" % (tx, ty)), "w") as fh:
        fh.write(s)
print(len(feats), "road sections,", len(tiles), "tiles,", round(total / 1e6, 1), "MB")
