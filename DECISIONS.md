# Design decisions

Choices made where the spec left room, one line of reasoning each. Newest at the bottom of each phase.

## Phase 1

- **TypeScript 5.9 instead of the brand-new 7.x native compiler.** 5.9 is the proven line for Vite + Three typings; upgrading later is a one-line change.
- **Coordinates: Y up, car forward is +Z, car left is +X.** This matches glTF and Three.js conventions, so imported models drop in without re-orienting.
- **Physics stays pure TypeScript (only three's math classes).** It runs headless in vitest and in the Node tuning scripts with no DOM.
- **Tire model: normalised combined slip fed through one magic-formula curve.** It gives a real friction circle (wheelspin and locked wheels steal cornering grip) and only needs four intuitive numbers per compound (μ, peak slip angle, peak slip ratio, falloff).
- **Kept the prototype's per-axle feel values.** Front and rear grip 2.0/2.15 became a 1 : 1.075 axle multiplier, and the 10%/20% falloff became per-axle falloff multipliers on the compound. The absolute μ is now realistic (sport tire 1.22), because real weight transfer now does work the prototype faked.
- **Wheel spin is integrated semi-implicitly (linearised tire force).** An explicit update of a 1 kg·m² wheel against a stiff tire is unstable at 120 Hz; the implicit form is stable at any speed and still lets the wheels spin up for burnouts and clutch kicks.
- **Engine, clutch and wheels are coupled (locked or slipping clutch).** This makes clutch kicks physical: revs build with the clutch in and dump into the rear tires on release.
- **The handbrake is a real brake torque on the rear wheels, not a grip multiplier.** Locked rears lose lateral grip through the friction circle, which is how e-brake entries work in reality.
- **Drift-assist yaw damping is ported as-is from the prototype (strength 0.55 × 2.2).** It is what made the prototype's slides holdable; it is an assist, so Expert turns it off.
- **Default assists: ABS on, TCS off, stability off, drift assist 55%, steering assist on, automatic gearbox.** Friendly for a drift game: traction and stability control would stop new players from drifting at all.
- **The automatic gearbox holds its gear while sliding** and only upshifts after 0.4 s on the limiter, and it never downshifts while the handbrake is held. Otherwise a handbrake entry reads as "stopped" and the box drops to first.
- **An automatic launch clutch is active in both gearboxes.** No stalling and no clutch needed to pull away; the clutch pedal still works for kicks.
- **Track ground is an analytic query (spline projection + terrain noise), not a baked heightfield.** It gives exact kerb/road heights, one source of truth for physics and meshes, and no memory cost.
- **Kerb rumble comes from the height function, not from forces.** The suspension feels it naturally, and it shows in the meshes.
- **Minami Drift Park layout:** a clockwise 1.04 km loop with 22 m of elevation (downhill first half, uphill return), a 16 m hairpin, a concrete-walled left-hander for wall clipping and a guardrail-lined final corner. This follows the spec's "drift bible plus a wall to clip" brief.
- **Body-only scenery collision in Phase 1** (walls, fences, cones). Trees sit at least 12 m from the road edge, so they don't need colliders yet.
- **Tire smoke uses one instanced draw call with a custom billboard shader** and fake self-shadowing, instead of a sprite per puff. This keeps smoke cheap enough to pile up.
- **Bloom threshold is 3.5 in daylight.** The Sky shader outputs HDR values far above 1, and a low threshold blooms the whole sky.
- **The chase camera uses a closed-form critically damped spring.** An explicit spring diverged when frames hitch (dt 0.25 s) and threw the camera half a kilometre away.
- **Japanese plates on the car read 風見 300 さ 15-15.** It is a fictional region, and the format evokes the real thing without copying a real plate.
- **The S15 is right-hand drive with the exhaust on the right.** The interior seen through the glass sells the JDM fantasy.
- **Fonts are bundled via @fontsource (OFL) rather than loaded from Google Fonts.** The build then runs offline and from any static host.
- **The time of day is fixed at a late-afternoon golden hour in Phase 1**, with `?hour=` for previews. The day/night cycle with streetlights is Phase 2/6 work.
- **The deploy workflow uses relative asset paths (`base: './'`).** The same build works at `user.github.io/REPO/` and on any other host without configuration.

## Update 2

### Section 1: real models

- **One `CarModelLoader` for every glTF.** It clones materials per instance (so paint never leaks between cars), normalises length, orientation and ground, re-pivots the wheels, swaps paint and hides branding. Templates are cached and cloned.
- **Toy-proportioned Kenney traffic is scaled per axis** to real sedan/van/truck sizes, with the wheels re-scaled to stay round. A uniform scale to 4.5 m would have made a Kenney sedan 2.6 m wide.
- **Measured geometry is the source of truth.** The loader measures wheelbase, track and wheel radius after normalising, `fitPhysicsToModel` applies them at runtime, and the same numbers are baked into `cars.json` so tests and dealer stats match.
- **Paint on atlas-textured models (Takumi AE, Hoshi GT) recolours only texels near the body's key colour** in a shader. The AE86 key is white, so panda black stays black. The Hoshi GT key, (218, 167, 0), was found by sampling the atlas at the body mesh's UVs.
- **The Sakura 18 is sold as the "Sakura 18 Targa".** The model is built as a T-top; a flat roof plate looked fake from the chase camera, and the spec allows the Targa option.
- **Imported low-poly paint gets a slightly rougher clearcoat (≥ 0.16)** and paint albedo is capped at 62% luminance. Flat-shaded faces otherwise mirror the sun across the whole panel and bloom white.
- **The daytime bloom threshold is raised to 6** (night stays at 0.7). Only real light sources and sun glints bloom by day.
- **Starter car is now the Takumi AE** in a fresh save. The procedural S15 stays as a buyable car.
- **The old dev car page became `/model-viewer.html`.** It ships with the build so models can be checked on the live site too.

### Section 2: making the cars look good

- **Contact shadow is a blurred canvas-texture decal under each car**, not an extra shadow light. One draw call per car, and it fades when the car is airborne.
- **SSAO is on at Medium**, as the update asks. Low stays without it for weak laptops and phones.
- **Stance is applied in `CarView` by dropping only the body** (per-car `visual.stance`, 0–4.5 cm). Wheels stay on the physics contact patch, so tires never sink. Visual camber is a per-axle field the tuning menu will drive.
- **The textured-paint mask uses a hard edge (85–100% of tolerance).** A soft fade blended the paint toward pink on the AE's gradient palette cells. The AE key is a 0.93 grey with a wide tolerance, so the whole white upper body (palette cells 227–255) changes colour and the black lower half stays black.

### Sections 3–5: flow, Open Road, Drift Track

- **The title screen is "press any key" in front of the main menu.** The menu is Play / Garage / Dealer / Records / Settings / How to Drift, with a level / ¥ / SP chip on every menu screen.
- **Mode-card art is rendered from the game itself** (`tests/tools/modeart.cjs`, UI hidden) and shipped as small JPEGs in `public/assets/ui/`.
- **The Open Road is one 8.9 km closed loop with four sections in sequence:** town → expressway → touge → coast with a tunnel → town. It's built by `tests/tools/gen_openroad.py`. One loop keeps lane logic, traffic and activity triggers simple, and the sections still flow into each other as the update asks.
- **Traffic keeps left (Japan) and is kinematic.** It follows the lane at its section speed, follows the car ahead and brakes and honks for the player, but isn't simulated with full physics. The player collides with it as a moving box (`Vehicle.collideBox`). A pool of ~34 models is loaded during the loading screen and recycled within a window around the player, so nothing loads while driving.
- **Near misses use a pass-by test:** the player crosses a traffic car's mid-line within 1.6 m side gap at a relative speed above 6 m/s, without touching.
- **Open Road money is paid at the end of the run (results screen)** but counted live in the HUD. The update's "End Run" goes through the pause menu; "Quit to menu" leaves without rewards.
- **Drift zone score is everything the chain gained between the zone gates** (banked + live). Zones, traps and the danger sign pay each star once, ever.
- **Clipping points are placed automatically from track curvature:** an inner point at each apex, an outer zone on the exit. Every track gets them without hand-authoring.
- **Drift Attack judging scales the drift rate by line × proximity.** Line is the distance from an outside-in-outside ideal line; proximity rises near clipping points. The results breakdown shows average angle, speed, line %, clips hit and best combo.
- **Tandem Chase uses a kinematic lead car** that follows a scripted line (speed from curvature, about 30° of angle in corners). The run is judged on proximity (60%) and angle match (40%) → Win / OMT / Lose. Only the chase run is built; the "swap and lead" second run is listed in NEXT_STEPS.
- **Minami Reverse is generated** from the Minami data (points reversed, wall sides flipped), so the two layouts can't drift apart.
- **Port Gymkhana containers are real walls** (capsule colliders) drawn as stacked 12 m shipping containers, with cones at every corner apex.
- **The Takumi AE's modelled badges** (maker name front and rear, model name on the grille) are removed by deleting the small lettering triangles in three boxes at the car's ends (`strip` in `cars.json`). The other six imported cars were checked front and rear and carry none; the RX-7's `Logos` node stays hidden.

### Sections 6–7: scoring and economy

- **The economy is tuned with a scripted-driver playtest** (`tests/pacing.test.ts`). A drift controller links drifts and transitions for 3 simulated minutes; a "typical player" earns 35% of that rate. To hit the update's pacing targets (first part < 5 min, second car in 30–45 min, Raiden 34 in 4–6 h), the starting values changed:
  - Open Road ¥/point: 0.04 → 0.075
  - Drift Track ¥/point: 0.03 → 0.055
  - XP: 1 per 100 points → 1 per 12 points (the level curve `1000 × n^1.4` is unchanged)
- **The "second car" pacing target means the Sakura 18 Targa**, after one part. The ¥20,000 Kumo Sedan is a beater, affordable almost at once by design.
- **The skill tree has 11 perks with 15 ranks**: Style 5 ranks, Money 5, Mechanic 5. Each rank costs 1 SP, and perks unlock top-down within a branch.
- **Every 5th level is a milestone:** a sticker set unlocks (stored in `save.unlocks.stickers`) with a full-screen celebration. The free part arrives with the Section 8 parts system.
- **The Garage menu opens the skill tree for now**; the 3D garage (Section 8) will put it in a tab.

## Update 4

- **`KAZE_DRIFT_UPDATE_3.md` does not exist and `reference/` holds no upgrade-screen image**, so the screens are designed in the game's own style (dark navy panels, paper-white type, sodium-orange and red accents).

### Section 1: acceleration and the feel of speed

- **Targets come from tuning, not a fudge factor.** Each car keeps realistic drag (CdA 0.58–0.68). Its final drive is set so redline in top gear lands on the target top speed (short gearing). Its torque curve is then scaled by a coarse scan. `tests/tools/tune_accel.ts` does both. Scales: AE 1.10, Kumo 1.20, Sakura 18 1.10, Sento 1.15, Hoshi 1.40, R7 1.40, S15 1.25, Raiden 1.90. The Raiden's AWD 4.3 s needs the most.
- **Times are measured with a staged launch** (`src/physics/performance.ts`): brake and throttle held for 1.5 s, then the brake comes off. The clock starts as it does. The same function feeds the dealer cards, so the numbers on screen are the ones the test checks.
- **Launch control meters the clutch, not the throttle.** Cutting throttle at a standstill made the engine bog and lose boost. Now the engine sits on its launch rpm (on boost for turbo cars), and the clutch passes only the torque the driven tyres can take, with a slip feedback trim. After the clutch locks, a wheelspin limiter runs through 2nd gear. Steering more than 25%, the handbrake, lifting or a slide end it, so drift entries are untouched.
- **Staged launch = two-step:** stopped with brake and throttle held, the clutch stays out, a soft limiter holds the launch rpm, and the turbo builds boost. A green LAUNCH light shows on the HUD.
- **Auto-shift decides on road speed, not wheel speed.** Wheelspin had been triggering upshift/downshift hunting. Other fixes: a 1.2 s downshift lockout after an upshift, a 0.5 s gap between upshifts (a limiter bounce had cascaded 2→4→5), and the box syncs revs to the new gear during the 80 ms shift.
- **TCS is off whenever drift assist is on or the car is sliding.** Drift assist is on by default, so TCS only acts for players who turn drift assist off.
- **`arcadePower` (default 1.15) is a hidden setting** in `settings.gameplay`. It multiplies every engine's torque, and all targets and the acceleration test assume 1.15. To change it, edit the saved settings (localStorage `kaze-drift-save`) or the default in `src/core/settings.ts`. The test would then need re-tuning.
- **NA cars no longer inherit the base turbo.** `cars.json` deep-merges each car over `_base`, which has a turbo, so the AE, Kumo and Hoshi were secretly boosted. `"turbo": null` now removes it (`deepMerge` treats null as delete). All three still hit their targets.
- **Rolling resistance −20%** (street 0.0104) and **drivetrain efficiency 0.85** for every gearbox, as the update asks.
- **Model-fitted wheel radius scales the final drive** (`fitPhysicsToModel`), so a car's overall gearing per km/h, and so its tuned times, stay the same when its 3D model has different-sized wheels.
- **Economy rescaled for the faster cars:** faster drifts score more points per minute, so the pacing test's scripted driver earned about 2.3× more. Open Road ¥/point 0.075 → 0.03, Drift Track 0.055 → 0.022, XP 1 per 12 → 1 per 29 points. The pacing targets hold again.
- **Speed feel:**
  - FOV: base + 12° × (speed / 270 km/h)^1.25, plus a punch on a launch kick.
  - Shake: two-frequency, from 150 km/h, full at 300 km/h, scaled by the camera-shake setting.
  - Motion blur: now on from the Medium preset.
  - Speed lines: a 2D canvas overlay, fading in from 120 km/h.
  - Upshifts: an exhaust thump with two crackles, plus a camera nudge.
  - Turbo: an audible spool whoosh (band-passed air that tracks boost and boost rise), a louder whistle and blow-off.
  - Launch: the camera kick, and more rear squat under hard acceleration.
  - Road noise: tyre roar on tarmac.
- **The 20 s Playwright capture runs on game time** (`tests/smoke/update4_accel.cjs`). Software GL in CI renders far slower than real time, so wall-clock seconds would undercount.
- **The fully upgraded 2.8–3.6 s check** is added to `tests/accel.test.ts` with the Section 3 parts system, which defines "fully upgraded".

### Section 2: showroom car select

- **One showroom for three jobs:** Car Select (after choosing a mode), Dealer, and My Cars (the main menu's GARAGE button). The skill tree moved to its own SKILLS button.
- **The showroom is a separate Three.js scene drawn through the same post stack** (`PostStack.setScene`). The open-road world stays loaded behind it, so going for a drive needs no reload.
- **The room:**
  - A real mirror floor (`Reflector`) under a dark, slightly rough tint, so the reflection reads as polished concrete, not glass.
  - A brushed turntable with a sodium-orange rim light, and light strips on the walls.
  - A warm key spot, cool and warm rim spots, and `RoomEnvironment` reflections.
- **Cars sit on their real suspension:** each one is a `Vehicle` settled for 150 steps on a flat world, then drawn with the normal `CarView`. Stance, ride height and wheel offsets come from the same code as in the drive. At most six built cars are cached, and the neighbours of the current car are preloaded.
- **The dealer's paint preview** has 12 colours and five finishes. Buying uses the previewed colour.
- **Test Drive takes the car to the skidpad** on a borrowed basis (`?car=`). The garage selection is untouched and restored when the session ends.
- **Model years** are fictional and set in `cars.json`.

### Section 3: upgrade shop

- **The catalogue is code, not JSON** (`src/garage/parts.ts`). Each option carries a small `apply(spec)`, so the shop, the rating, the stat bars, the acceleration test and the car on the road all use the same `applyBuild`. Order: conversions first, then engine, platform, drivetrain, tires, aero.
- **Stacked engine parts have diminishing returns:** the engine category's combined torque gain is scaled by 0.8, and by less for engines already above 360 hp/t. Without this, a full build multiplied power by 2.2–2.6× (a 1,800 hp Raiden).
- **"Fully upgraded" for the 2.8–3.6 s check** means:
  - the top performance tier in every slot, with race slicks and the widebody's widest tires
  - no conversions (no swap, no aspiration change), as the spec treats those as separate choices
  The seven RWD cars land at 3.0–3.5 s.
- **AWD exception:** the AWD Raiden reaches 2.1 s, because AWD on slicks is grip-bound at about 1.3 g. Detuning it to 2.8 s would make the AWD layout pointless. The test holds AWD to a 1.9 s floor instead and keeps the ±10% band for RWD cars.
- **Race slicks have μ 1.5,** about 23% over Sport tires, in line with arcade expectations rather than real-world 1.7+.
- **Aero catalogue values are in "kit units",** ×12 = Cl·A in m². A full race kit is about 1 m² of downforce: about +15% load at 200 km/h.
- **The rating is analytic and instant,** so hovering a part ticks the number immediately. Components: power-to-weight, lateral grip with downforce, braking, aero and launch traction. Raw values above 600 are compressed so heavy builds spread across S1–R. The honest 0–100 and top speed beside it come from the physics run.
- **Tuning maps onto the physics we have:**
  - Camber peaks at −1.5° front and −1° rear, giving up to 2% grip.
  - Toe-out at the front sharpens turn-in; toe-in at the rear steadies the rear.
  - Caster adds steering speed.
  - Springs, ride height, damping, ARBs, brake balance and pressure, final drive, diff locks and downforce act directly.
- **Mechanical balance** combines roll-stiffness distribution, the rear/front grip ratio, weight distribution and diff lock, calibrated so a stock S15 reads about 0.57.
- **Parts are owned per car:** each car keeps an inventory, so reinstalling a part it already bought is free. That makes presets and switching builds cheap, as in the reference game. Removing a part (back to Stock) is free and refunds nothing.
- **FWD swaps are not offered:** every car in the roster is front-engine RWD or AWD, and an FR→FF swap is not "sensible" for a drift game. RWD↔AWD is offered on every car.
- **Engine heat:** stock engines lose up to 6% power after minutes of flat-out running. Oil & Cooling upgrades slow this, and the race pack removes it.
- **Build codes** are `KZ1-` plus base64url JSON of car, parts, tune and paint. Import checks every slot and option against the catalogue.
- **Quick Upgrade** is a greedy planner: it repeatedly buys the best rating gain per yen (plus style preferences for Drift and Grip) under the class ceiling and the player's money and level, then shows the plan and total before buying.

## Update 5

- **`KAZE_DRIFT_UPDATE_3.md` still doesn't exist.** Update 4's Sections 4–7 were not built (see `NEXT_STEPS.md`). Update 5 §10 asks for the touge to be built in full if it's missing, so it is built there.
- **The sim model lives inside the same `Vehicle` class,** selected by `physicsModel` ('sim' | 'classic'). The renderer, modes, tests and HUD keep one interface, and Classic stays bit-for-bit the Update 4 model behind Settings → Gameplay → Classic physics. Classic remains the default until the sim model passes every Update 5 test.

### Step 1: physics core (§1–3)

- **360 Hz = 3 sub-steps per 120 Hz tick** inside `Vehicle.step` (2 on the Low preset). The game loop's accumulator, interpolation and 0.1 s catch-up cap were already in place. Shift requests are applied on the first sub-step only.
- **The NaN guard** checks the body, the engine and every wheel and tire state after each sub-step. On a non-finite value it restores the last safe pose (saved every 0.25 s), stops the car and logs a warning. The 100-seed × 60 s fuzz test hasn't triggered it once.
- **Tire curve** (`src/physics/simTire.ts`, our own maths):
  - Normalised slip s = slip ÷ peak slip. The force is s(2 − s) up to the peak (zero slope at the peak).
  - Past the peak, it decays as a Gaussian shoulder to the falloff level.
  - The falloff speed sets how fast it gets there.
  The peak angle and falloff level are exactly the data values, which makes them testable and easy to tune.
- **Compound values:**

  | Compound | Peak angle | Falloff level |
  |---|---|---|
  | Street | 7° | 0.85 |
  | Sport | 6.5° | 0.88 |
  | Semi-slick | 6° | 0.90 |
  | Slick | 5.5° | 0.88 |
  | Drift | 8.5° | 0.92 (softest falloff speed, fastest wear) |

  These come straight from the doc, plus our own slick, rally and snow values.
- **Load sensitivity:** μ = μref (Fref/Fz)^(1−e) with Fref 3,000 N and e 0.80–0.83.
- **Combined slip:** a friction ellipse built on the normalised slip vector, so the force direction follows the slip direction and each axis is scaled by its own μ.
- **Camber:**
  - A grip multiplier peaking at each compound's optimum (−1.2° to −2.5°).
  - Plus camber thrust: 0.15 × Fz per radian of lean, fading once sliding.
  - Camber relative to the road comes from static alignment − 35°/m camber gain in bump + body roll.
- **Pressure:**
  - Hot pressure follows the gas law from core temperature.
  - Grip falls quadratically either side of the ideal hot pressure.
  - Low pressure lengthens the relaxation length (a softer, slower tire).
- **Relaxation length:** 0.35–0.55 m at the reference load, shorter at high load. It's a first-order lag on slip angle over distance rolled. The lagged angle is what the force curve sees.
- **Thermal model:** two nodes.
  - Heat in: sliding power (|slip velocity| × force) plus rolling hysteresis.
  - Heat out: convection rising with speed, plus conduction to the core.
  - Grip is 1.0 inside the compound's window, falling to 0.85 when cold and 0.80 when overheated.
  - Tires start at the bottom of their window ("blankets"), so the acceleration targets don't depend on a warm-up lap.
- **Wear** accrues from sliding energy and costs up to 15% grip.
- **Self-aligning torque:** −Fy × pneumatic trail. The trail shrinks to near zero past the peak, as on a real tire. It's stored for the countersteer assist in §5.
- **Low speed:** below 2 m/s the lateral force blends into a damped "sticky" contact, so parked cars don't creep or jitter.
- **Surfaces now match the doc:** concrete 0.97, painted line 0.90 (0.75 wet), wet asphalt 0.75, gravel 0.60, grass 0.45, snow 0.35, ice 0.15. Two new surfaces: `worn` (0.95) and `gutter` (for the touge).
- **Anti-roll bars are 30% of their old values on every car** (both models). The old bars gave a race-car roll gradient of about 1.8°/g. Street-based drift cars run 2.5–3°/g, and the doc asks for 2–5° of roll on the skidpad. The S15 now rolls about 2.2° at the limit. Every classic test still passes.
- **Real pitch and roll:** in sim mode the car body shows only the simulated pitch and roll; the extra visual lean is off.
- **Aero lift:** sim cars without aero get a little lift at speed (Cl·A up to 0.06 per axle).
- **Launch control needs an assist:** it now only engages with TCS or drift assist on. With everything off, full throttle at a standstill does a burnout, as the doc requires.
