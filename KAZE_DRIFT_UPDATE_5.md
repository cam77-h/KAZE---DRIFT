# KAZE DRIFT — Update 5: Sim-Grade Drift Physics (Assetto Corsa–Style), Touge, Cameras & Feel

This builds on the existing game, `KAZE_DRIFT_SPEC.md` and every earlier update file (`KAZE_DRIFT_UPDATE_2.md`, `_3`, `_4`). Where they disagree, **this document wins**. All earlier rules still apply: fictional car and part brands only, no real logos, the quality bar, commit after every step, and the game stays playable after every step.

**Goal:** make Kaze Drift *drive* like Assetto Corsa with a drift setup. The car's behavior comes from real vehicle dynamics (tires, weight transfer, wheel spin, differential, suspension), not scripted tricks, while staying fun and controllable on keyboard, gamepad and touch.

**Work on your own and do not ask me questions.** When something is unclear, choose what a sim-racing physics programmer would, write it in `DECISIONS.md` with one line of reasoning, and keep going.

**Legal note:** Assetto Corsa is the reference for *how the driving behaves*. Do not copy any of its code, data files, car files, names or assets. Implement everything from standard vehicle-dynamics principles, using our own code and our own numbers.

Build in this order. Each section has a **"Done when"** checklist, and you don't move on until it passes:
1. Physics core: 3D chassis, suspension, wheels, tires (Sections 1–3)
2. Drivetrain, engine, clutch and differential (Section 4)
3. Steering and input handling for keyboard/gamepad/touch/wheel (Section 5)
4. Drift techniques, all working from physics (Section 6)
5. Setup menu like a real drift sim (Section 7)
6. Drift scoring and judging (Section 8)
7. Cameras (Section 9)
8. Akagiri Touge (Section 10)
9. Feel and polish: audio, rumble, effects, telemetry (Section 11)
10. Tests and verification (Section 12)

Keep the old physics behind a setting ("Classic physics") until the new model passes every test, then make the new model the default.

---

## 1. Simulation architecture

- **Fixed physics rate: 360 Hz** (3 sub-steps per 120 Hz tick), decoupled from rendering, with an accumulator and interpolated rendering. Cap catch-up at 0.1 s per frame so slow devices don't spiral. On the Low preset, allow 240 Hz.
- **Integrator:** semi-implicit (symplectic) Euler for the chassis and wheels. Clamp and validate every value each step. If anything becomes NaN or infinite, reset the car to the last safe state and log it (never freeze or explode).
- **Units:** SI everywhere (m, kg, N, N·m, rad, s). Convert only for display (km/h, hp, psi or bar, °).
- **Everything lives in one physics module** with no rendering imports, so it can run headless in vitest at faster than real time.
- **All car parameters come from data** (`cars.json` + parts + setup), never hard-coded per car.

---

## 2. Chassis and suspension (real weight transfer)

- **Chassis:** a 3D rigid body (6 degrees of freedom) with mass, center of gravity (height + front/rear position from weight distribution) and an inertia tensor estimated from the car's dimensions (box approximation, tuned per car). Weight transfer is *emergent* from suspension forces, not faked.
- **Four independent suspension corners**, each with:
  - a **raycast** (or short shapecast) from the hardpoint down to the road to find contact point, normal and surface type;
  - a **spring** (N/m, from setup) with a progressive **bump stop** near full compression, and travel limits;
  - a **damper** with separate **bump** and **rebound** rates (slow and fast ranges are optional);
  - an **anti-roll bar** per axle that transfers force between left and right according to their compression difference;
  - **dynamic camber and toe change through travel:** compression adds negative camber and slight toe change, extension adds positive. Base values come from the alignment setup, plus a per-car "camber gain per meter of travel".
- **Ride height** sets static compression and center-of-gravity height. Front higher than rear shifts load rearward (more rear grip). Rear higher shifts it forward (more front grip, looser rear).
- **Body visuals** use the *real* chassis pitch and roll from the simulation (no fake lean animation). Squat under throttle, dive under braking and roll in corners must be visible.
- **Aerodynamics:** drag (Cd × frontal area), front/rear downforce (from aero parts), and lift at high speed for cars without aero.

**Done when:** a car dropped from 0.3 m settles in under 1.5 s without bouncing forever, body roll on the skidpad matches the expected direction and size (2–5°), brake dive and throttle squat are visible, and no step produces NaN.

---

## 3. Tires: the heart of the drift feel

Implement a tire model with the same *concepts* Assetto Corsa's tire files expose. These are the controls that make drifting in a sim feel the way it does.

### 3.1 Per-wheel slip
- Each wheel has its own **rotational speed** ω, integrated from: drive torque + brake torque + handbrake torque − (longitudinal tire force × loaded radius) − rolling resistance, divided by wheel inertia (wheel + tire + driveline share).
- **Slip ratio** (longitudinal) = (ω·r − v_long) ÷ max(|v_long|, small value).
- **Slip angle** (lateral) = atan2(v_lat, |v_long|) at the contact patch, using that wheel's own velocity (including yaw-rate contribution and steer angle).
- Use proper low-speed handling (blend toward a damped "sticky" model under ~2 m/s) so cars don't jitter or creep while parked.

### 3.2 Force curve (per compound, all values in data)
- **Peak slip angle** ("friction limit angle"): where lateral grip peaks. Street ~7°, sport ~6.5°, semi-slick ~6°, **drift compound ~8–9°** (wider, gentler peak).
- **Falloff level:** the fraction of peak grip left when sliding well past the peak. Street 0.85, sport 0.88, semi-slick 0.90, **drift tire 0.92**. Higher falloff = slides are easier to hold, which is what makes long drifts controllable.
- **Falloff speed:** how quickly grip drops from peak to falloff level as slip increases (soft for drift tires, sharper for slicks).
- **Grip coefficients** at a reference load: **μ_lat** (lateral) and **μ_long** (longitudinal), per compound.
- **Load sensitivity:** the friction coefficient *falls* as load increases: μ(Fz) = μ_ref × (Fz_ref ÷ Fz)^(1 − exponent), with exponent ~0.75–0.85. This is critical: it makes weight transfer change the balance, so the car pivots realistically, and stiffer anti-roll bars reduce grip on that axle.
- **Combined slip:** longitudinal and lateral forces share one **friction ellipse**. Wheelspin or locking reduces lateral grip and vice versa. This is what lets throttle break the rear loose and the handbrake (locked rear) kill rear side grip.
- **Camber effect:** grip is best at a small optimal camber relative to the road. Negative camber helps the loaded outside tire at high steering angles, which is why drift setups run big front negative camber. Add a camber-thrust term.
- **Tire pressure:** each compound has an **ideal hot pressure**. Away from it, the contact patch shrinks (less grip) and the tire flexes (low pressure = softer and slower response). Pressure rises with temperature.
- **Relaxation length:** lateral force builds over a short distance (~0.3–0.6 m of rolling, shorter at high load), not instantly. Implement it as a first-order lag on slip angle based on distance rolled. This gives tires "weight" and stops jitter. It's one of the biggest feel improvements, so do not skip it.
- **Self-aligning torque (pneumatic trail):** rises with slip angle up to the peak, then falls past it. It's used for steering feel and the gamepad countersteer assist (Section 5).

### 3.3 Temperature and wear
- A simple **two-node thermal model** per tire (surface and core). Heat comes from sliding energy (|slip velocity| × force) and rolling, and is lost to air (more at speed) and to the core. Grip multiplier peaks in an optimal window (street 70–90 °C, drift 80–100 °C) and drops when cold or overheated.
- **Wear** grows with sliding energy and slowly lowers grip. Drift tires wear fast. Show wear on the tire mesh (Update 4 already asks for visible wear).
- **Tyre widget** (like AC's Tyres app): four tire icons colored **blue (cold) → lime green (optimal) → orange/red (hot)**, with pressure, temperature and wear. Show it in the setup screen and as an optional HUD widget.

### 3.4 Surfaces
Each surface sets a grip multiplier, rolling resistance and an effects profile: dry asphalt 1.00, worn asphalt 0.95, painted line 0.90 (0.75 wet), concrete 0.97, wet asphalt 0.75, gravel 0.60, grass 0.45, snow 0.35, ice 0.15, kerb 0.90 (with vibration). The touge also gets **gutters** (Section 10).

**Done when:** unit tests confirm the force curve rises to the peak at the right slip angle, falls to the falloff level, load sensitivity lowers μ as Fz grows, combined slip respects the ellipse, and a wheel under full throttle on a stationary car spins up realistically (burnout works).

---

## 4. Drivetrain, engine, clutch and differential

- **Engine:** a torque curve per engine (data), engine inertia, idle control, a rev limiter (hard cut with audible bounce), engine braking (torque falls off-throttle, scaling with rpm), and turbo boost with spool and lag (Update 4). Throttle response depends on flywheel weight (lighter flywheel revs faster).
- **Clutch:** a friction clutch with max torque capacity, analog engagement (a clutch axis for wheels, plus a "clutch kick" button for gamepad and keyboard), and slip with heat. **Clutch kick** = dip and drop the clutch at high rpm so the stored engine energy spins the rear wheels. It must work from physics.
- **Gearbox:** real ratios + final drive, auto or manual shifting, shift time per gearbox part, plus rev-matching on downshift (optional assist). The gear stays locked during a drift with auto-shift on (hold the gear while the rear wheels spin faster than road speed, so the car doesn't upshift mid-drift).
- **Differential** (rear for RWD; front/center for AWD), with:
  - **Open:** torque splits equally, and the inside wheel can spin.
  - **Clutch-type LSD:** **preload** (N·m), **power lock %** (on throttle) and **coast lock %** (off throttle). Torque transfer between the wheels is limited by preload + lock% × input torque.
  - **Welded/spool:** both wheels are locked together.
  - Lower power lock reduces on-throttle snap in transitions, and lower coast lock reduces off-throttle snap. Preload sets how much torque difference it takes to unlock. When power or coast is at 100%, preload no longer matters. A fully locked diff (100/100) is the most consistent for drifting and is our **drift preset default**.
- **AWD:** a center diff with a torque split slider (e.g. 30:70 → 0:100 with the "RWD conversion" part).
- **Brakes:** brake torque per wheel from brake pressure and **brake bias**, plus ABS (optional assist, off by default for drift). Brake bias changes how left-foot braking feels mid-drift: around the neutral point the car holds angle, more rear bias adds angle, more front bias reduces it. Default to a "neutral" bias for each car.
- **Handbrake:** high rear brake torque that locks the rear wheels (a hydraulic handbrake part makes it stronger and instant).

**Done when:** tests show the open diff lets the inside wheel spin while the welded diff keeps both equal, clutch kick at 6,000 rpm breaks the rear loose on the S15 at 60 km/h in 2nd gear, the rev limiter bounces, and engine braking slows the car realistically.

---

## 5. Steering and input (keyboard, gamepad, touch, wheel)

### 5.1 Steering geometry
- Steering rack ratio and **max steering lock per car** (stock 35–40°, angle kits 50/60/70°). Each front wheel's steer angle is computed with adjustable **Ackermann** (0% = parallel, which is preferred for drift; 100% = full Ackermann).
- **Caster** (degrees, setup) adds self-aligning tendency and dynamic camber when steering.
- The steering wheel in the cockpit view and the visible front wheels rotate exactly as the physics does.

### 5.2 Input pipeline (AC-style controller settings, all in Settings → Controls)
Raw input → deadzone → **gamma** (response curve) → **steering speed** (max rate the virtual steering wheel can turn) → **filter** (smoothing) → **speed sensitivity** (reduces max steering at high speed) → steering angle.

Defaults:
- **Gamepad, grip:** deadzone 3%, gamma 2.0, steering speed 60%, filter 50%, speed sensitivity 60%.
- **Gamepad, drift** (the default for drift modes): deadzone 3%, gamma 1.4, steering speed 85%, filter 20%, **speed sensitivity 0% while sliding** (full lock always available for countersteer).
- **Keyboard:** steering speed 70% and return speed 90% (holding a key ramps the input smoothly, releasing returns it), plus the countersteer assist below.
- **Touch:** on-screen buttons or a tilt option, both feeding the same pipeline.
- **Steering wheel:** wheels show up through the browser Gamepad API. Add a "Wheel" input profile that maps the full axis to a configurable rotation (default 900°, with lock matching the car's steering lock), plus separate throttle, brake and clutch axes with calibration and an inversion toggle. (Force feedback isn't available in the browser, so skip it and document why.)

### 5.3 Countersteer assist (essential for gamepad, keyboard and touch)
Real drifters let the steering wheel spin through their hands. Self-aligning torque points the front wheels where the car is travelling. Gamepad drift mods for AC make controller drifting work by simulating this, so do the same:
- Compute the **"free steering" angle:** the steer angle that would point the front wheels along the front axle's velocity vector (zero front slip). Clamp it to the steering lock.
- With the assist on, the final steer angle = **free steering angle + player input × (remaining lock)**. Stick centered means the wheels naturally countersteer and the car holds its slide; pushing the stick adds or removes angle on top of that.
- Blend the assist in only when the rear is sliding (rear slip angle > ~6°) and blend it out smoothly in grip driving.
- **Assist strength** slider: 0–100%, default 70% for gamepad, 85% keyboard, 90% touch, 0% for wheel users.
- This must never steer the car on its own into walls. It only aligns the front wheels with the direction of travel.

### 5.4 Other inputs
Throttle and brake are analog with gamma. There's also a clutch (axis + "kick" button), handbrake, shift up/down, a look-left/right/back glance, camera cycle, and reset to the road (returns the car to the nearest valid road point, facing forward, with a short ghost period).

**Done when:** a scripted gamepad bot using only "throttle + small stick input" with the assist on holds a 35° drift for 10 s on the skidpad. With the assist off, the same input spins out (proving the assist works). Wheel input maps correctly in a test with a fake gamepad.

---

## 6. Drift techniques, all from physics

Every technique below must work because of the physics in Sections 2–5, not special-case code. Write an automated **technique test** for each (a scripted input sequence that must produce a drift > 25° within 2 s and be holdable for 3 s on the S15 drift preset):
1. **Power-over:** steer in at 40–60 km/h, then full throttle in 2nd. Rear wheelspin exceeds lateral grip and the rear steps out.
2. **Handbrake / e-brake entry:** a tap of the handbrake locks the rear, the rear loses side grip, and the car rotates. On release, apply throttle to sustain.
3. **Clutch kick:** at the rev limit, a clutch kick sends a burst of rear wheelspin.
4. **Braking drift (weight transfer entry):** brake hard while turning in. Weight moves forward, the rear unloads and slides.
5. **Feint / Scandinavian flick:** steer away, then sharply into the corner. The rebounding weight swings the rear out.
6. **Lift-off oversteer:** lift the throttle mid-corner at speed. Weight moves forward and the rear gets loose.
7. **Transition (direction change):** from a left drift, unwind and steer past center to the right, briefly lift, then reapply throttle. The car swaps direction (the weight "pendulum").
8. **Holding a drift:** balance throttle (more = more angle, less = straighten) against countersteer. Too much throttle spins, too little straightens.
9. **Exit:** open the steering, ease throttle, and the rear regains grip without snapping the other way (tune with diff coast, rear toe and rear rebound).
10. **Reverse entry / "manji" snaking** on straights also works (manji counts for style but has anti-exploit scoring, Section 8).

Add a **Drift School** mode on the skidpad with one short lesson per technique: text prompt, a ghost demo car, and a pass/fail check using the same detection.

---

## 7. Setup menu (like a real drift sim)

A **Setup** tab per car (unlocked parts gate which sliders appear, per Update 4). Every slider shows its unit, a plain-English tooltip, and an understeer ↔ oversteer hint. Changes apply instantly, with a "Test on skidpad" button.

**Tires:** front and rear cold pressure (psi), with the Tyre widget showing live hot pressure and temperature.

**Alignment:**
- **Front camber:** −0° to −8°. Drift preset −6.5°. More negative = more grip at big steering angles. Never positive.
- **Rear camber:** −3° to +1°. Drift preset slightly positive static (+0.3° to +0.5°) so the rear sits near 0° when it squats under power (maximum contact patch).
- **Front toe:** −1.0° to +0.5°. Drift preset −0.3° (toe-out: sharper turn-in and more leading-wheel angle; positive front toe only adds understeer).
- **Rear toe:** −0.25° to +0.6°. Drift preset +0.15° (toe-in for stability; above +0.30° the rear starts to "understeer" at angle; negative is capped at −0.25° because it makes transitions snappy).
- **Caster:** 3°–10° (drift preset 7.5°).
- **Ackermann:** 0–100% (drift preset 10%).

**Anti-roll bars** (front/rear, 0–100):
- Low front = pointy and precise but twitchy. High front = calmer, some understeer (good for big entries).
- High rear = less rear grip, easier initiation, snappier transitions. Low rear = more side grip and drive, harder to initiate.
- Drift preset: front 55, rear 65.

**Springs** (front/rear, N/mm):
- Softer front = more front grip but can feel vague. Stiffer front = less twitchy.
- Softer rear = more forward bite under throttle. Stiffer rear = easier initiation, less forward grip.
- Drift preset: front 90, rear 55.

**Ride height** (front/rear, mm): show the rake and explain it ("front higher = more rear grip").

**Dampers** (bump/rebound, front/rear, 1–20 clicks):
- Drift preset: **low rear bump** (rear squats fast), front bump ~mid, **higher rear rebound** (the rear "hangs on" and holds the drift), medium-high front rebound (slows the nose rising under throttle).

**Brakes:** pressure %, bias % (show the car's neutral point; tooltip: "around neutral, left-foot braking holds angle; more rear adds angle; more front reduces it").

**Gearing:** final drive and each gear ratio, with a speed-per-gear chart. Tooltip: longer = more speed and angle but slower response; shorter = more bite and snappier throttle, but the car may straighten if the tires hook up. Drift preset: 3rd gear covers the main drift speeds of each venue.

**Differential:** preload (N·m), power %, coast %. Drift preset: 100% / 100% (locked).

**Steering:** lock (limited by the angle kit part), steering ratio.

**Presets** (one click, per car): **Stock**, **Grip**, **Drift Base**, **Drift Aggressive** (more lock, stiffer rear ARB), **Beginner Drift** (more rear grip, higher falloff tires, assist up). Save/load/share custom setups (part of the build code).

**Done when:** every slider changes the simulation (one unit test per slider group proving the expected direction of change, e.g. "raising the rear ARB lowers the rear lateral grip limit on the skidpad"), and the presets load correctly.

---

## 8. Drift scoring and judging (AC-style, upgraded)

Merge this with the existing skill chain (Update 2) into one consistent system.

### 8.1 What counts as a drift
- Drifting = speed > 25 km/h **and** body slip angle (between heading and velocity) > 10° **and** moving forward (angle < 110°). Beyond 110°, or travelling backwards, counts as a **spin**.
- Each continuous slide in one direction is a "drift". **Each direction change while staying sideways adds +1 to the combo count**, like AC's drift mode. Anti-snaking rule: a drift only counts toward the combo if it lasted ≥ 0.8 s and reached ≥ 20°, so cheap straight-line manji can't farm combos.

### 8.2 Points
- Points per second = angle factor × speed factor × line factor × proximity factor × multiplier.
  - **Angle factor:** ramps from 0 at 10° to 1.0 at 35°, peaks at 45–60°, then gently falls past 70° (too much angle bleeds speed).
  - **Speed factor:** ramps up to a cap at ~110 km/h (so slow, smoky drifts score less).
  - **Smoothing:** score gain ramps up over the first ~1 s of each drift, so tiny flicks are worth little.
- **Multiplier:** grows slowly with continuous drifting and combo count, **capped at ×5**. When you stop drifting it decays slowly at first, then faster the longer you're out of a drift.
- **Penalties:** short wall taps cost a little, long scrapes cost much more. Off-track or a spin **ends the combo and loses unbanked points**. Hitting traffic or a car also ends it.
- **Banking:** points bank after 2.5 s without a new drift (keep the existing ring timer), or immediately when you come to a controlled stop.

### 8.3 Competition judging (Drift Track, Touge drift zones, Tandem)
- **Zones** (gated sections) score speed × angle while you're inside them.
- **Clipping points** are scored by distance from the correct bumper: **inner clips** by the *front* bumper, **outer clips** by the *rear* bumper. The game detects which bumper is facing the clip.
- **Drift line trail:** after a run, show the path you drove as a colored ribbon on the track: **magenta = low** performance (low speed/angle) → **green = good**. Show it alongside a ghost replay.
- **Tandem judging:** proximity (distance to the lead car, with a bonus for door-to-door), angle match with the lead car, and line match.

**Done when:** scripted bots prove snaking can't farm combos, a spin ends the combo, clips detect front versus rear bumper, and the line trail renders with correct colors.

---

## 9. Cameras (AC chase cams, done right)

All cameras use spring-damper smoothing (no rigid parenting) and are scaled by each car's wheelbase and height, so every car frames well.

- **Chase Near:** distance 4.2 m measured from the rear axle (scaled by wheelbase), height 1.3 m, pitch 3°.
- **Chase Far:** distance 6.4 m, height 1.6 m, pitch 2°.
- **Drift Cam** (default in drift modes): like Chase Near, but it **yaws toward the velocity direction** (blend ~65% velocity / 35% heading) and shifts sideways toward the outside of the drift, so you can see where you're going *and* the car's angle. It stops following at extreme angles so spins read clearly.
- **Hood**, **Bumper**, and **Cockpit:**
  - Cockpit has a simple interior with a moving steering wheel, shifter and gauges, plus a "lock to horizon" option (reduces roll) and subtle head movement from g-forces.
  - **Glance buttons:** look left, right and back. In cockpit, an auto-glance option looks into the corner during drifts.
- **Helicopter / Touge cam:** high and behind, for touge battles and spectating.
- **Replay/TV cams:** trackside cameras at corners, drone follow and low orbit, with automatic cuts. Used for the after-run replay, photo mode and spectating in multiplayer.

**Camera dynamics:**
- Position follows with a spring (stiffness ~6–8, critical damping) and a slight lag on acceleration ("accelerating inertia"). It pulls back under braking and closes in under acceleration.
- **Dynamic FOV:** base 60°, up to +10° with speed.
- **G-force influence:** a small shift in the direction of lateral g.
- **High-speed shake:** subtle, above 150 km/h.
- Impact shake on collisions.
- **Controller camera:** the right stick orbits the camera. When stopped, it does **not** auto-recenter. When driving, it recenters after 1.5 s.
- Camera collision: never clip into guardrails or walls (raycast and pull in).

**Settings:** distance, height, pitch, FOV, smoothing, shake intensity and "look into drift" strength, with a reset.

**Done when:** screenshots of every camera on 3 different cars (small Takumi AE, long Kumo Sedan, Raiden 34) show good framing, the drift cam keeps the road ahead visible at a 50° angle, and nothing clips through walls on the touge.

---

## 10. Akagiri Touge (build it fully if it isn't finished, and upgrade it)

If Update 4's touge already exists, upgrade it to this spec. If not, build it now.

### 10.1 The road
- **6–8 km** from the **onsen town at the base** to the **summit parking lot**, ~**450 m** of elevation. A two-lane mountain road (6–7 m wide) with a dashed center line.
- **35+ corners,** including:
  - **10+ hairpins** stacked up the mountainside, plus the signature **"Five Hairpins"** section (5 alternating hairpins in a row, perfect for transitions);
  - a fast downhill straight into a tight hairpin (a braking-drift entry);
  - long sweeping esses for tandem;
  - a blind crest;
  - a decreasing-radius corner;
  - a short **tunnel** (with echoing exhaust audio);
  - a bridge over a ravine.
- **Road realism:**
  - A crowned road (slight camber to each edge), with banked or off-camber corners.
  - Surface patches with slightly different grip, a few bumps and dips that load and unload the suspension, and painted lines that are slippery in the wet.
  - **Gutters (mizo):** concrete drainage channels on the inside of some hairpins. A wheel dropped in gets pulled along the corner (a constraint that rewards the "gutter run" technique). It's risky at high speed.
- **Roadside:**
  - Steel guardrails (white, dented in places) with physical collision and sparks.
  - Rock walls with netting, chevron boards, round curve mirrors on blind corners, km posts, Japanese-style warning signs (fictional names), cedar and maple forest, cliff views over the valley.
- **Landmarks:**
  - **Summit lot:** the night meet spot, with vending machines, a toilet block and a view of the city lights.
  - **Red torii gate and small shrine** halfway up.
  - **Onsen town** at the base, with lanterns and wooden buildings.
  - A closed rest stop and a viewpoint.
- **Lighting:** at **night**, most of the road is lit only by your headlights, with a few sodium lamps at the town, tunnel and summit. Headlights are real spotlights with good range.
- **Seasons:**
  - **Spring:** sakura petals.
  - **Summer:** cicadas and deep green.
  - **Autumn:** red/orange **momiji**, the hero look.
  - **Winter:** snow banks and icy patches at night (lower grip).

### 10.2 Ways to play it
- **Downhill and Uphill time attack:** ghost, sectors, medals.
- **Touge Battle 1v1:** run 1 you lead, run 2 you chase. The chaser wins by closing to < 0.5 s or overtaking on the allowed passing straights; the leader wins by pulling > 3 s ahead. AI rivals have personalities.
- **Drift zones** on named sections ("Five Hairpins", "Shrine Bend", "Tunnel Exit", "Bridge Sweeper"), plus a full **Touge Drift Run** scored top to bottom.
- **Tandem Chase** following an AI lead car down the mountain.
- **Free drive / meet:** optional light oncoming traffic, a summit hangout, multiplayer (Update 4).
- Connected to the Open Road loop.

**Done when:** a scripted downhill run completes without falling through or getting stuck, the gutter mechanic works, every landmark is present, night lighting is readable, all four seasons render, and a touge battle can be won and lost.

---

## 11. Feel and polish

- **Audio:**
  - **Tire squeal** driven by slip *energy* per tire (pitch from slip speed, volume from load × slip), with separate sounds for scrubbing (light slip), squealing (peak) and full sliding.
  - Gravel/grass/snow surface sounds, rev limiter bounce, clutch-kick bark, turbo flutter on lift, backfire pops on overrun with visible flames.
  - Wind noise rising with speed, and engine echo in tunnels and against walls.
- **Controller rumble** (where supported): front-tire slip past the peak (understeer), rear slip intensity, kerbs, impacts and rev limiter.
- **Visual effects:**
  - **Tire smoke** volume from rear slip energy and tire temperature, drifting with the wind and lingering in hairpins.
  - Smoke color option per tire.
  - Skid marks with intensity from slip, dust and gravel spray, sparks on guardrail scrapes.
  - Heat haze behind the exhaust.
- **Telemetry overlay** (toggle, F4): the Tyre widget, a slip angle readout per axle, steering angle vs. free steering angle, throttle/brake/clutch bars, g-meter, and diff lock state. This is great for tuning, and it's how we'll debug the feel.
- **Replays:** record the last run at 30 Hz (positions, rotations, wheel states) for replay with the TV cams, the drift line trail and ghost export.
- **Performance:** physics in one module that never allocates in the hot loop (reuse vectors). Profile it, target < 2 ms per frame for the player car plus 7 AI/remote cars on a mid laptop, and use a simplified tire model for distant AI/traffic.

---

## 12. Tests and verification

1. **Physics unit tests (vitest, headless):**
   - Tire curve shape per compound (peak angle, falloff level), load sensitivity, combined-slip ellipse, relaxation length (force lags slip), thermal warm-up.
   - Suspension settles and has no NaN in 60 s of random inputs (fuzz test, 100 seeds).
   - Diff behavior (open/LSD/welded), clutch kick, rev limiter, engine braking.
   - **Acceleration targets** from Update 4 still pass with the new model (adjust torque curves if needed, not the targets).
   - **All 10 technique tests** from Section 6 pass on the S15 Drift Base preset and the Takumi AE Beginner Drift preset.
   - Setup sliders change the behavior in the expected direction (Section 7).
   - Scoring rules (Section 8), including anti-snaking.
   - Frame-rate independence: the same scripted run at 30, 60 and 144 fps render rates ends within 1% of the same position.
2. **Feel benchmarks** (scripted bots, logged to `tests/feel-report.md` with numbers):
   - Skidpad steady drift: 60–80 km/h at 30–45° for 10 s.
   - Five Hairpins: a bot completes the transitions without spinning on the Drift Base preset.
   - Grip lap: a grip preset on Tsukinami Raceway is faster than the drift preset (proves the setups really differ).
3. **Playwright visual run:** skidpad drift (drift cam), touge downhill at night (chase near), five-hairpin tandem, a setup screen with the Tyre widget, and the telemetry overlay. Save screenshots to `screenshots/update-5/` and **look at them all yourself**: smoke, skid marks, body roll, camera framing, readable HUD, nothing clipping.
4. 60 fps on the Medium preset on the touge at night with 4 AI cars.
5. Update `README.md` (new controls, assist and setup explanations), `CHANGELOG.md`, `DECISIONS.md`, and write **`PHYSICS.md`** explaining the model, every parameter and how to tune a car. Commit.
6. If you run out of room, stop at a clean step and write `NEXT_STEPS.md` saying exactly where to continue.

Start with Section 1 now.
