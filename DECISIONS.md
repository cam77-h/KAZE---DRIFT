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
