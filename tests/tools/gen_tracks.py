# Generates Tsukinami Raceway and Port Gymkhana. Run: python3 tests/tools/gen_tracks.py
import json, math

# ---- Tsukinami Raceway: short technical circuit, ~1.9 km, gentle elevation
ts = [[-250,20,0],[-80,20,0],[60,20,4],[150,20,30],[185,19,80],[170,18,130],[120,17,150],[60,17,140],[20,17,110],
      [-20,17,95],[-70,17,110],[-90,17,150],[-60,18,195],[10,19,215],[90,19,215],[170,20,230],[230,21,270],[230,21,320],
      [180,21,350],[60,21,350],[-80,21,340],[-200,21,320],[-290,21,280],[-330,21,210],[-330,20,120],[-310,20,40]]
tsuk = {
  "id": "tsukinami", "size": 1100,
  "spawn": {"x": -200, "z": 0, "yaw": 1.5708}, "showcase": {"x": -140, "z": -40, "yaw": 2.4},
  "terrain": {"base": 18, "amp": 4, "scale": 150, "seed": 31, "rise": {"x": -40, "z": 170, "r": 330, "height": 50, "falloff": 140}, "ground": "grass"},
  "roads": [{"id": "circuit", "closed": True, "width": 12, "shoulder": "gravel", "kerbs": "corners", "lines": "edge", "points": [[x,y,z,12] for x,y,z in ts],
             "walls": [{"side": "right", "from": 0.96, "to": 0.08, "offset": 5, "type": "concrete", "height": 1.1},
                       {"side": "left", "from": 0.12, "to": 0.3, "offset": 6, "type": "tire"},
                       {"side": "left", "from": 0.55, "to": 0.8, "offset": 6, "type": "tire"}]}],
  "pads": [{"id": "paddock", "shape": "rect", "x": -130, "z": -40, "w": 160, "d": 40, "y": 20, "surface": "asphalt", "blend": 10}],
  "walls": [{"type": "fence", "circle": {"x": -40, "z": 170, "r": 440}, "height": 2.5, "radius": 0.4}],
  "scenery": {"theme": "mountain-park", "stands": [{"x": -120, "z": 18, "rot": 3.1416, "len": 70}], "trees": {"count": 1400, "minDist": 14, "radius": 500}}
}
json.dump(tsuk, open('src/data/tracks/tsukinami.json', 'w'), indent=1)

# ---- Port Gymkhana: flat harbour pad, tight technical loop lined by containers
pg = [[-120,3,-60],[-20,3,-60],[40,3,-52],[70,3,-20],[60,3,15],[20,3,25],[-10,3,10],[-40,3,-5],[-70,3,10],[-80,3,45],
      [-50,3,75],[10,3,80],[60,3,70],[100,3,85],[110,3,120],[80,3,145],[20,3,140],[-50,3,130],[-110,3,135],[-150,3,110],[-160,3,40],[-158,3,-20],[-140,3,-52]]
cont = []
def row(x0, z0, x1, z1):
    cont.append({"type": "concrete", "points": [[x0, 3, z0], [x1, 3, z1]], "height": 2.6, "radius": 1.25, "container": True})
row(-110, -78, 40, -78); row(90, -40, 90, 40); row(-180, -40, -180, 150); row(-140, 160, 120, 165); row(130, 70, 130, 150)
row(-20, 40, 30, 50); row(-110, 70, -110, 100)
port = {
  "id": "port", "size": 900,
  "spawn": {"x": -100, "z": -60, "yaw": 1.5708}, "showcase": {"x": -40, "z": 30, "yaw": 2.0},
  "terrain": {"base": 2.6, "amp": 0.6, "scale": 60, "seed": 5, "ground": "dirt", "sea": {"level": 0, "x0": 260, "width": 40, "depth": 12}},
  "roads": [{"id": "gymkhana", "closed": True, "width": 13, "shoulder": "concrete", "kerbs": "none", "lines": "edge", "surface": "concrete", "points": [[x,y,z,13] for x,y,z in pg]}],
  "pads": [{"id": "yard", "shape": "rect", "x": -20, "z": 45, "w": 360, "d": 280, "y": 3, "surface": "concrete", "blend": 20}],
  "walls": cont + [{"type": "concrete", "points": [[-200, 3, -100], [230, 3, -100], [230, 3, 190], [-200, 3, 190]], "closed": True, "height": 1.1}],
  "scenery": {"theme": "port", "cones": True}
}
json.dump(port, open('src/data/tracks/port.json', 'w'), indent=1)
print('ok')
