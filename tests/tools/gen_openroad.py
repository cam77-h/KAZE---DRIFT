# Generates src/data/tracks/openroad.json: an ~9 km loop through town, expressway, touge and coast.
# Run: python3 tests/tools/gen_openroad.py
import json, math

pts = []   # [x, y, z, width, bank]
def P(x, y, z, w, b=0): pts.append([round(x, 1), round(y, 1), round(z, 1), w, b])

# ---- 1. Town (start), heading east along z = 0, with a jog at the station
TW = 10
P(-640, 8, 40, TW); P(-520, 8, 30, TW); P(-400, 8, 10, TW); P(-300, 8, 0, TW); P(-200, 8, 0, TW)
P(-110, 8, -8, TW); P(-60, 8, -50, TW); P(-20, 8, -92, TW); P(40, 8, -100, TW); P(140, 8, -100, TW); P(230, 9, -80, TW)
# ---- 2. Expressway: wide, long curves, climbing onto an embankment, heading north-east then north
EW = 17
P(330, 12, -60, EW); P(480, 18, -80, EW, -2); P(640, 24, -150, EW, -3); P(780, 28, -260, EW, -3); P(880, 30, -420, EW, -2)
P(930, 32, -600, EW); P(940, 34, -780, EW, 2); P(900, 36, -950, EW, 3); P(820, 40, -1080, EW, 3)
# ---- 3. Touge: climb the mountain westward with switchbacks, summit ~150 m, then down to the coast
GW = 8.5
def hairpin(cx, cz, r, y, a0, a1, w=GW, n=4):
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        P(cx + math.cos(a) * r, y, cz + math.sin(a) * r, w + 1.5, 0)
P(720, 46, -1150, GW); P(620, 54, -1200, GW); P(520, 62, -1210, GW)
P(420, 70, -1190, GW, 2); P(340, 78, -1150, GW)
hairpin(300, -1185, 22, 84, 0.35 * math.pi, 1.45 * math.pi)    # hairpin 1 (left)
P(330, 92, -1240, GW); P(420, 102, -1270, GW); P(520, 110, -1290, GW)
hairpin(560, -1325, 22, 116, 0.6 * math.pi, -0.45 * math.pi)    # hairpin 2 (right)
P(500, 124, -1370, GW); P(400, 134, -1385, GW); P(300, 142, -1395, GW)
P(200, 148, -1400, GW); P(100, 150, -1395, GW)                   # summit
P(0, 146, -1380, GW, -2); P(-100, 138, -1360, GW, -3); P(-190, 128, -1320, GW)
hairpin(-225, -1285, 22, 120, -0.35 * math.pi, -1.45 * math.pi + 2 * math.pi - 2 * math.pi)  # hairpin 3
P(-200, 112, -1235, GW); P(-110, 104, -1215, GW); P(-30, 96, -1190, GW)
hairpin(5, -1155, 22, 90, -0.6 * math.pi, 0.45 * math.pi)        # hairpin 4
P(-60, 82, -1115, GW); P(-170, 72, -1100, GW); P(-290, 62, -1090, GW); P(-410, 52, -1080, GW, 2)
P(-530, 42, -1060, GW, 3); P(-640, 34, -1020, GW); P(-740, 28, -960, GW)
# ---- 4. Coastal highway: south along the sea, sweeping corners, tunnel through the headland
CW = 11
P(-820, 22, -880, CW); P(-880, 18, -770, CW, 2); P(-910, 15, -650, CW, 3); P(-905, 13, -520, CW)
P(-930, 12, -400, CW, -2); P(-950, 12, -300, CW); P(-940, 12, -200, CW); P(-905, 11, -110, CW, 2)
P(-850, 10, -40, CW, 3); P(-780, 9, 20, CW); P(-720, 8, 45, CW)

# scale the layout up and centre it on the map (hairpins open up a little too)
S, DZ = 1.35, 680
def T(x, z): return round(x * S, 1), round((z + DZ) * S, 1)
for q in pts:
    q[0], q[2] = T(q[0], q[2])
L = 8928.0  # loop length reported by the layout tool (metres)
F = lambda m: round(m / L, 4)
walls = [
  {"side": "left", "from": F(1000), "to": F(3400), "offset": 1.2, "type": "concrete", "height": 1.1},
  {"side": "right", "from": F(1000), "to": F(3400), "offset": 1.2, "type": "concrete", "height": 1.1},
  {"side": "left", "from": F(3500), "to": F(6900), "offset": 1.4, "type": "guardrail", "height": 0.8},
  {"side": "right", "from": F(3500), "to": F(6900), "offset": 1.4, "type": "guardrail", "height": 0.8},
  {"side": "right", "from": F(6950), "to": F(8800), "offset": 1.6, "type": "guardrail", "height": 0.8},
]
road = {"id": "loop", "closed": True, "width": 10, "points": pts, "shoulder": "gravel", "kerbs": "none", "lines": "center", "walls": walls}
sections = [
  {"id": "town", "name": "Kawabe Town", "jp": "川辺町", "from": 0, "to": 950, "lanes": 1, "speed": 40, "density": 0.9, "theme": "town"},
  {"id": "expressway", "name": "Wangan Line", "jp": "湾岸線", "from": 950, "to": 3450, "lanes": 2, "speed": 90, "density": 1.6, "theme": "expressway"},
  {"id": "touge", "name": "Akagiri Pass", "jp": "赤霧峠", "from": 3450, "to": 6900, "lanes": 1, "speed": 45, "density": 0.18, "theme": "touge"},
  {"id": "coast", "name": "Shiokaze Coast", "jp": "潮風海岸", "from": 6900, "to": 8928, "lanes": 1, "speed": 60, "density": 0.45, "theme": "coast"},
]
activities = [
  {"type": "driftzone", "id": "dz_station", "name": "Station Square", "from": 480, "to": 760, "stars": [2500, 6000, 12000]},
  {"type": "driftzone", "id": "dz_switchback", "name": "Switchback Climb", "from": 3700, "to": 4300, "stars": [4000, 10000, 20000]},
  {"type": "driftzone", "id": "dz_descent", "name": "Summit Descent", "from": 5450, "to": 6050, "stars": [5000, 12000, 24000]},
  {"type": "driftzone", "id": "dz_seawall", "name": "Seawall Sweepers", "from": 7100, "to": 7600, "stars": [3500, 9000, 18000]},
  {"type": "speedtrap", "id": "st_wangan", "name": "Wangan Camera", "at": 2650, "stars": [160, 200, 235]},
  {"type": "speedtrap", "id": "st_coast", "name": "Lighthouse Camera", "at": 8380, "stars": [120, 150, 180]},
  {"type": "nearmiss", "id": "nm_wangan", "name": "Wangan Rush", "from": 1350, "to": 2900},
  {"type": "nearmiss", "id": "nm_town", "name": "Shotengai Alley", "from": 90, "to": 450},
  {"type": "danger", "id": "dg_summit", "name": "Summit Crest", "at": 4980, "stars": [8, 18, 30]},
]
tunnel = {"from": 7880, "to": 8160}
def frac(i): return i
json.dump({"_points": len(pts)}, open('/dev/null', 'w'))
data = {
  "id": "openroad", "size": 3200,
  "spawn": {"x": T(-460, 21)[0], "z": T(-460, 21)[1], "yaw": 1.75},
  "showcase": {"x": T(-300, 30)[0], "z": T(-300, 30)[1], "yaw": 2.2},
  "terrain": {"base": 6, "amp": 6, "scale": 160, "seed": 21, "ground": "grass",
              "hills": [dict(zip(("x", "z"), T(260, -1330)), r=1000, h=135), dict(zip(("x", "z"), T(-1010, -420)), r=330, h=55), dict(zip(("x", "z"), T(1250, -700)), r=650, h=60), dict(zip(("x", "z"), T(400, 450)), r=650, h=30)],
              "sea": {"level": 0, "x0": round(-1010 * S), "width": 200, "depth": 25}},
  "roads": [road],
  "pads": [{"id": "pa", "shape": "rect", "x": T(-300, 40)[0], "z": T(-300, 40)[1], "w": 90, "d": 30, "y": 8, "surface": "asphalt", "blend": 8}],
  "scenery": {"theme": "open-road", "trees": {"count": 4200, "minDist": 14, "radius": 1600}},
  "sections": sections, "activities": activities, "tunnel": tunnel
}
json.dump(data, open('src/data/tracks/openroad.json', 'w'), indent=1)
print(len(pts), 'points')
