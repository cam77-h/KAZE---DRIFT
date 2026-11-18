# KAZE DRIFT — Update 2: Real Cars, Garage, Economy, Game Modes

This update builds on the existing game and `KAZE_DRIFT_SPEC.md`. Where the two disagree, **this document wins**. Everything else in the spec still applies (fictional car names, no real brands, phased work, the quality bar, the legal rules).

**Work on your own and do not ask me questions.** When something is unclear, choose what a good game designer would, write it in `DECISIONS.md` with one line of reasoning, and keep going. The game must stay playable after every step, and you should commit after every step.

Do the work in this order:
1. Bring in the real 3D models (Section 1)
2. Make the cars look good (Section 2)
3. Mode select + Open Road + Drift Track (Sections 3–5)
4. Scoring, money, XP and skill points (Sections 6–7)
5. Garage with live part installs (Section 8)
6. High scores and records (Section 9)
7. Verify everything (Section 11)

---

## 1. Bring in the real 3D models

### 1.1 Where the files are

I uploaded a folder called `kaze-car-models/` to the root of the repo. Move it to `public/assets/models/` (so Vite serves it), **keeping the subfolders exactly as they are**:

```
public/assets/models/
  player-cars/   7 cars the player can drive
  traffic/       6 cars for traffic and parked cars
  kenney/        Kenney Car Kit: 40+ vehicles, wheels, cones, debris
    Textures/colormap.png   ← required: every Kenney .glb loads this texture by relative path
    LICENSE-kenney.txt
  CREDITS.md
```

Do not rename `kenney/Textures/` or its models will load untextured.

### 1.2 What each model is and how to use it

All of these are measured: "size" is the raw bounding box in the file's own units, before scaling.

**Player cars** (show in the dealer and garage):

| File | In-game name (fictional) | Archetype | Raw size (x · y · z) | Tris | Wheel nodes | Notes |
|---|---|---|---|---|---|---|
| `takumi_ae86_ivofficial.glb` | **Takumi AE** | 80s hatchback (AE86) | 8.10 · 5.80 · 18.61 | 12k | `Wheel1`–`Wheel4` (figure out which is which by position) | **Starter car.** Huge scale: normalize. Panda paint baked into one texture: keep the texture and tint it, don't replace it. |
| `kaze_rx7fc_ivofficial.glb` | **Kaze R7 '87** | 80s rotary coupe (RX-7 FC) | 1.79 · 1.27 · 4.32 | 20k | `FL_WHEEL`, `FR_WHEEL`, `RL_WHEEL`, `RR_WHEEL` | Has a `Logos` node: **hide it** (real brand badges). Pop-up headlight node `Headlights` can animate up at night. |
| `raiden_r34_davidsirera.glb` | **Raiden 34** | 90s GT sedan-coupe (R34) | 2.41 · 1.83 · 6.17 | 15k | **None named.** Nodes are `Circle`, `Circle.001`–`.003`, `Plane` | Wheels are probably the `Circle*` nodes. Confirm by position (4 near the corners, low). If wheels are merged into the body, split them by connected geometry near each corner, or hide them and attach Kenney `wheel-racing.glb` instead. |
| `sakura_180sx_grzybek.glb` | **Sakura 18** | S-chassis hatch (180SX) | 5.04 · 3.29 · 11.46 | 5k | **None named.** Generic `Cylinder*`, `Cube*`, `Plane*` | Wheels are likely the `Cylinder*` nodes: confirm by position, otherwise swap in Kenney wheels. It may render without a roof panel: if so, add a simple roof mesh in body color (or sell it as "Sakura 18 Targa"). |
| `sports_car_1_quaternius.glb` | **Hoshi GT** | 90s sports coupe | 2.67 · 1.86 · 5.66 | 6k | `FrontWheel_L`, `FrontWheel_R`, `BackWheels` (both rears in one node) | CC0. The rear axle is one node: spin it as one, fine. |
| `sports_car_3_quaternius.glb` | **Sento RS** | compact sport coupe | 1.87 · 1.20 · 3.93 | 3k | `…FrontLeftWheel…`, `…FrontRightWheel…`, `…BackWheels…` | CC0 |
| `sports_car_2_quaternius.glb` | **Kumo Sedan** | 4-door sport sedan | 1.80 · 1.16 · 3.97 | 3k | same pattern as above | CC0. Cheap "beater" car in the dealer, also usable as traffic. |

Keep the existing procedural **Sakura S15** as a buyable car too (it's ours, no license needed). The other spec cars (350Z-, Supra-, Chaser-, Evo-, NSX-style) stay procedural until real models are added later. Keep the `cars.json` structure ready for that.

**Traffic and parked cars:**

| File | Use | Raw size | Wheel nodes |
|---|---|---|---|
| `traffic_taxi_quaternius.glb` | Japanese taxi (repaint it the classic dark green or black) | 1.81 · 1.31 · 4.22 | front L/R + `BackWheels` |
| `traffic_hatchback_kaylousberg.glb` | small hatchback | 0.42 · 0.37 · 0.81 | 4 named wheels |
| `traffic_red_car_jtoastie.glb` | compact car | 1.07 · 0.58 · 1.87 | named wheels |
| `traffic_sports_hatch_reppenthe303.glb` | modern hatch (33k tris, so use sparingly or only as a parked car) | 3.58 · 2.55 · 7.65 | `Rim1*` + `Rubber*` nodes |
| `traffic_80s_car_nickladd.glb` | 80s wedge supercar: rare "show car" parked at meets | 0.79 · 0.49 · 1.53 | none named |
| `traffic_mini_car_romainrevert.glb` | toy-like buggy: use only as a fun easter egg or leave unused | 0.31 · 0.23 · 0.50 | none named |
| `kenney/*.glb` | `sedan`, `sedan-sports`, `hatchback-sports`, `suv`, `suv-luxury`, `van`, `delivery`, `delivery-flat`, `truck`, `truck-flat`, `taxi`, `police`, `ambulance`, `firetruck`, `garbage-truck` → the bulk of traffic. Karts and tractors: unused. | ~1.3 · 1.1 · 2.6 (sedan-sports) | `wheel-front-left`, `wheel-front-right`, `wheel-back-left`, `wheel-back-right` |
| `kenney/cone.glb`, `cone-flat.glb`, `box.glb`, `debris-*.glb` | cones on drift courses, knockable props, and **flying debris when you crash** (bumper, door, spoiler, tire, bolts) | | |
| `kenney/wheel-*.glb` | fallback wheels for models whose wheels can't be separated | | |

### 1.3 The model loader (do this carefully)

Write one `CarModelLoader` that every car goes through:
- **Normalize scale:** scale each model so its length matches the real-world target length in `cars.json` (Takumi AE 4.2 m, Kaze R7 4.3 m, Raiden 34 4.6 m, Sakura 18 4.5 m, Hoshi GT 4.4 m, Sento RS 4.1 m, Kumo Sedan 4.5 m, traffic sedans 4.4–4.7 m, vans/trucks 4.7–6.5 m).
- **Normalize orientation:** all models are long along Z, but check which end is the front for each model. Take a screenshot, look at it, and store `forward: "+z"` or `"-z"` per model in `cars.json`. Rotate so every car faces the game's forward axis.
- **Ground it:** put the bottom of the tires exactly on y = 0 and center the car between its axles.
- **Wheels:** find the 4 wheels (by node name from the tables above, then by position as a fallback). Re-parent each into a pivot group at its own center, so it can spin around its axle and the fronts can steer. Read the real wheelbase and track width from the wheel positions and **feed them into the physics** for that car, so visuals and physics match. If wheels can't be separated, hide them and mount the matching Kenney wheel.
- **Paint:** find the body-paint material (the largest material by surface area, or by name). Swap it for our car-paint material (Section 2) so color customization works. For textured models (Takumi AE), multiply the texture by the chosen color, or use a mask so only body panels change color.
- **Brands:** hide any node or material named like `logo`, `badge`, `emblem` or `plate` that shows real branding, and replace plates with our own fictional plate texture.
- **Lights:** find or add headlight and taillight meshes, make them emissive, and add real spotlights for the player's headlights at night. Brake lights brighten when braking.
- **Performance:** cache each loaded model and clone it for traffic. Use instancing or LOD for distant traffic. Show the procedural car if a file fails to load, and never crash.
- Write a small debug page `/model-viewer.html` that shows every model on a turntable with its wheel pivots and bounding box drawn, so models can be checked quickly.

### 1.4 Credits (required by the licenses)

Copy `public/assets/models/CREDITS.md` into the repo root `CREDITS.md` and show it in-game under **Settings → Credits**. The CC-BY models must be credited with author, title, license and link.

---

## 2. Make the cars look good

Apply this to every car, imported or procedural:
1. **Reflections:** an environment map generated from the sky with PMREM, regenerated when time of day changes. Paint, glass and chrome must reflect the world.
2. **Car paint:** MeshPhysicalMaterial with clearcoat 1.0, clearcoatRoughness ~0.05, metalness ~0.4, roughness ~0.35. Finishes: gloss, metallic (flake via a subtle noise normal map), pearl, matte, chrome.
3. **Glass:** dark tinted, reflective, slightly see-through.
4. **Grounding:** a soft contact shadow under each car (a blurred shadow decal or a small shadow-only light), plus SSAO at Medium quality and above.
5. **Stance:** default ride height low enough that tires tuck into the arches. Visual camber follows the tune.
6. **Lighting and post-processing:** ACES Filmic tone mapping, bloom for lights, SMAA, and a gentle color grade.
7. Before/after screenshots of each car in the garage and on track, which you look at yourself before moving on.

---

## 3. Game flow and mode select

New menu flow:

**Title → Main Menu → Play → Mode Select → Car Select → Location/Event → Drive → Results → (Garage or play again)**

Main Menu items: **Play**, **Garage**, **Dealer**, **Records**, **Settings**, **How to Drift**. Show the player's money, level and skill points in the corner of every menu screen.

**Mode Select** shows big cards with art (rendered from the game itself) and a one-line description:
- **Open Road (オープンロード):** free drifting on a long open road with traffic. Earn money as you go. No time limit.
- **Drift Track (ドリフトコース):** judged drift events and time attacks on closed tracks. Medals, high scores and bigger payouts.
- **Practice:** the existing skidpad, with no money and no pressure.

---

## 4. Open Road mode

A long, fun road to drift on, with things happening along it.

- **The road:** a large looping road network (~8–12 km total), built from splines with real elevation, in sections that flow into each other:
  1. **Touge section:** a mountain pass with hairpins, guardrails and cedar forest (reuse and expand the touge work).
  2. **Coastal highway:** long sweeping corners along the sea, with a tunnel.
  3. **Town section:** narrow streets, intersections, vending machines and power lines.
  4. **Expressway stretch:** wide multi-lane road with denser traffic.
  
  The player can drive the whole loop endlessly. A mini-map shows the loop and markers.
- **Traffic:** AI traffic in both directions using the traffic models (mostly Kenney sedans, vans and trucks, with the occasional taxi or bus). Density varies by section (light on the touge, heavy on the expressway). Traffic stays in its lane, brakes and honks. Hitting traffic breaks your chain.
- **Activities along the road**, marked with gates or signs in the world:
  - **Drift Zones:** a marked section with a 1–3 star score target. Stars pay bonus money the first time.
  - **Speed Traps:** a camera sign that records your speed. Beat the target for stars.
  - **Near-Miss Alley:** traffic-heavy stretches where near misses score double.
  - **Danger signs** (where elevation allows): jump distance.
- **Earning while driving:** banked chain points turn into money continuously (see Section 7). A small HUD counter shows money earned this session.
- **Session end:** the player pauses → "End Run", or crashes too many times in a row (optional setting). The results screen shows distance, best chain, near misses, zone stars, money, XP and skill points earned.

---

## 5. Drift Track mode

Closed courses with judged events.

- **Tracks:**
  1. **Minami Drift Park** (exists): expand it with a second layout (reverse direction).
  2. **Tsukinami Raceway:** a short technical circuit for time attack.
  3. **Port Gymkhana:** containers and cones at a harbor, for tight technical drifting.
  
  Add at least 3 layouts total at launch. Each track has a preview card with a map, length, elevation and best scores.
- **Event types per track:**
  - **Drift Attack:** one lap (or a set section) and score as much as possible. Clipping points and clipping zones are marked. Medal targets: Bronze / Silver / Gold / Platinum.
  - **Time Attack:** fastest lap. 3 laps with a ghost of your best lap, sector splits and a green/red delta.
  - **Tandem Chase:** follow the AI lead car, from the original spec.
- **Judging:** the existing skill chain plus line, angle and proximity judging, with clipping points as glowing markers. Wall taps, going off track or spinning break the chain.
- **Results:** a score breakdown (angle, speed, line, proximity, combo), the medal earned, money and XP, a new-record banner, and "Retry" (one key) and "Garage" buttons.

---

## 6. Scoring (applies to both modes)

Keep and polish the skill chain:
- Points come from drift angle × speed × duration, plus bonus skills: Clipping Point, Near Miss, Daredevil (near-miss streak), Wreckage (knocked cones and debris), E-Brake Turn, Airtime, Speed.
- The **multiplier** rises with chain length (×1 up to ×10, with color tiers).
- Points **bank** automatically after 2.5 s with no new skill, with a countdown ring.
- **Messing up loses the unbanked chain:** a wall or traffic hit, or spinning out. Make it dramatic: a "CHAIN BROKEN" flash, a brief desaturation and a glass-crack sound. Banked points are safe.
- Score popups pop and fly to the total, in our own style.

---

## 7. Economy and progression

Three things to earn:
- **Money (¥ yen, displayed like ¥12,500):** buys cars, parts and paint.
- **XP → Driver Level:** level-ups unlock cars, parts tiers and tracks.
- **Skill Points (SP):** spent on perks.

**Starting state:** the player owns the **Takumi AE** and has **¥15,000**. Save everything in the versioned localStorage save.

**Earning (starting values: put them all in one `economy.json` so they're easy to tune):**
- Open Road: ¥ = banked chain points × 0.04. Near miss +¥50. Drift Zone stars ¥1,000 / ¥2,500 / ¥5,000 (first time only per star). Speed Trap stars ¥500 / ¥1,500 / ¥3,000 (first time).
- Drift Track: ¥ = event score × 0.03, plus a medal bonus the **first time** each medal is earned: Bronze ¥2,000, Silver ¥4,000, Gold ¥7,500, Platinum ¥12,000. Time Attack pays per medal by lap time.
- XP: 1 XP per 100 banked points, plus a medal or zone-star bonus.
- Driver level n needs `round(1000 × n^1.4)` XP. Each level-up gives **1 SP** and **¥2,500**.
- Every 5 levels: a bigger reward (a free part or a sticker set) with a celebration screen.

**Pacing targets** (playtest with a scripted driver and adjust `economy.json` to hit these):
- First performance part bought within **5 minutes** of play.
- Second car within **30–45 minutes**.
- Raiden 34 within **4–6 hours**.

**Prices (starting values):**
- Cars: Kumo Sedan ¥20,000 · Sakura 18 ¥35,000 · Hoshi GT ¥45,000 · Sento RS ¥55,000 · Kaze R7 '87 ¥60,000 (Level 5) · Sakura S15 ¥80,000 (Level 8) · Raiden 34 ¥150,000 (Level 15).
- Part tiers: Street ¥3,000–8,000 · Sport ¥10,000–25,000 (Level 3) · Race ¥30,000–60,000 (Level 8) · Pro ¥80,000–150,000 (Level 15). Visual parts are cheaper than performance parts.
- Selling a car returns 60% of what you paid (car + parts).

**Skill tree (spend SP):** about 15 perks in 3 branches:
- **Style:** bank timer +0.5 s (×2), multiplier cap +1 (×2), near-miss bonus +25%.
- **Money:** +5% earnings (×3), parts discount 10%, first-medal bonus +25%.
- **Mechanic:** free paint jobs, a free tune reset, a test-drive bonus.

Show it as a nice-looking tree in the Garage menu.

---

## 8. Garage: mod the car and watch it happen

The garage is a 3D tuning shop: your car on a slowly rotating turntable, with tool walls, a car lift, fluorescent lights (one flickers), posters with original brand art, a tire stack, and a sleeping cat. The camera smoothly moves to the part of the car being modded.

**Layout:** a categories rail on the left, the part list in the middle, the 3D car in the center/right, and a stats panel showing **before → after** bars (Power, Grip, Handling, Braking, Drift, Rating/class). Hovering a part previews it on the car and in the stats. Buying it installs it.

**"See everything being put in":** every install plays a short animation (~1.5 s, skippable with a click):
- The camera flies to the area: wheels, front bumper, rear wing, engine bay (hood opens), exhaust or underside.
- The old part pops off and the new part slides/bolts on, with sparks or a wrench "clank" and a sound.
- Ride height and camber changes animate the suspension down or up while you drag the slider.
- Paint sweeps across the body like a spray pass.

**Visual parts** (built procedurally and attached using each car's bounding box and wheel positions, so they fit every model):
- **Wings:** none, ducktail lip, low GT wing, high GT wing, swan-neck. Each has visible stands and endplates.
- **Front lip/splitter**, **side skirts**, **rear diffuser**, **canards**.
- **Wheels:** at least 8 designs (use Kenney wheels plus procedural 6-spoke, mesh, deep-dish and 5-spoke). Choose size, width, color, plus a **stance** slider (camber, offset, ride height).
- **Widebody fender flares**, sized to each wheel.
- **Exhaust tip** styles: single, dual, "bosozoku" upswept, center exit.
- **Hood:** stock, vented, carbon.
- **Paint:** color + finish; separate colors for wheels and calipers; a few livery presets (racing stripes, two-tone panda, number boards).
- **Extras:** underglow color, tinted windows, a tow hook, a JDM beginner-leaf sticker.

**Performance parts** (each changes the physics for real and shows a visible change where possible):
- Engine (intake, exhaust, ECU), turbo (small/medium/large, with lag and power curve; the BOV sound is audible; an intercooler visible behind the bumper), drivetrain (clutch, gearbox, differential: open / 1.5-way / 2-way / welded), suspension (coilovers), **angle kit** (steering lock 35° → 55° → 70°), tires (street / sport / semi-slick / drift), brakes, hydraulic handbrake, weight reduction.
- Each part shows its effect in plain words ("+40 hp, more turbo lag", "easier to hold big angle").

**Tuning tab** (unlocks per part): tire pressure, camber, toe, ride height, springs, anti-roll bars, differential lock, brake balance, final drive. Each slider has a tooltip and shows an understeer ↔ oversteer bar. Save presets per car.

**Test drive** button: drops you on the skidpad with the current setup, and one key returns you to the garage.

---

## 9. High scores and records

- **Records screen:** per track/event and per Open Road zone, the top 10 local scores (score, car, date). Show the player's personal best and the medal targets.
- **Ghosts:** save the best Time Attack lap per track and car class, and race against it.
- **Career stats:** total distance, longest drift, biggest chain, money earned, near misses, cones hit, favorite car, time played.
- **New record** moments get a banner and a sound on the results screen.
- Keep the design ready for an online leaderboard later (data shaped like `{track, event, score, car, date, playerName}`), but local only for now.

---

## 10. Polish checklist

- No real brand names, logos or badges visible anywhere (check every imported model).
- Every menu screen has a back button, works with keyboard, mouse, gamepad and touch, and keeps the game's art style (no default fonts, no generic gradient cards).
- Loading screen while models load, with a progress bar styled like a tachometer.
- The game runs at 60 fps on the Medium preset with heavy traffic (instancing, LOD, culling). Add a performance overlay toggle (F3).
- The save migrates from the current version without wiping progress.

---

## 11. Verify before calling it done

After each step, and at the end:
1. `npm run build` and the tests pass.
2. A Playwright script that: loads the game → Play → Open Road → drives with scripted inputs for 20 s → ends the run → checks that money increased → goes to the Garage → buys a wing and wheels → checks that the money went down and the parts are visible on the car → goes to Drift Track → runs an event → checks that a record was saved. Save screenshots to `screenshots/update-2/` and **look at them yourself**. Fix anything that looks wrong, ugly, floating, sunken, mis-scaled, backwards or untextured.
3. Open `/model-viewer.html` and check every model: scale, facing the right way, wheels spinning on their own axles, no visible real logos.
4. Update `README.md`, `CHANGELOG.md` and `CREDITS.md`, then commit.
5. If you run out of room in one session, stop at a clean step and write `NEXT_STEPS.md` saying exactly where to continue.

Start with Section 1 now.
