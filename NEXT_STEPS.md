# Next steps

To continue in a new session, say: **"Read KAZE_DRIFT_UPDATE_5.md, DECISIONS.md and NEXT_STEPS.md and continue."**

## Where the build stands

Work is on branch **`update-5`** (pushed, branched from `main` after Update 4 §1–3 merged). `KAZE_DRIFT_UPDATE_5.md` overrides every earlier doc.

| Step | Update 5 section | Status |
|---|---|---|
| 1 | §1–3 Physics core: chassis, suspension, tires | **Done.** `src/physics/simTire.ts`, sim path in `Vehicle`; `tests/sim.test.ts` |
| 2 | §4 Drivetrain, clutch, differential | **Done.** `tests/drivetrain5.test.ts`; clutch headroom fix; Raiden retuned |
| 3 | §5 Steering and input | **Done.** `src/input/steering.ts`, countersteer assist, wheels; `tests/steering.test.ts` |
| 4 | §6 Drift techniques | **In progress** (see below) |
| 5 | §7 Setup menu and presets | Not started |
| 6 | §8 Scoring and judging | Not started |
| 7 | §9 Cameras | Not started |
| 8 | §10 Akagiri Touge | Not started (Update 4 never built it, so build it in full) |
| 9 | §11 Feel and polish | Not started |
| 10 | §12 Tests and verification, `PHYSICS.md` | Not started |

Also still open from Update 4: §4 visible part installs and the engine bay, and §6 multiplayer. `KAZE_DRIFT_UPDATE_4.mr` and the Update 4 plan are in git history (`git show b9a1496:NEXT_STEPS.md`). Update 5 §10 covers the touge.

**The sim model is not the default yet.** `settings.gameplay.physicsModel` defaults to `'classic'` (Settings → Gameplay → Classic physics). Switch the default to `'sim'` once every Update 5 test passes, as the doc requires.

Checks:
- `npm test`: 115 tests pass, on both physics models.
- `npm run build` passes.

## How the sim model is built

- **`Vehicle(spec, assists, 'sim')`:**
  - runs 3 sub-steps per 120 Hz tick (360 Hz) with a NaN guard
  - calls `simTire.ts` for forces, relaxation, temperature, pressure and wear
  - computes dynamic camber (alignment, gain, roll, caster), static toe and adjustable Ackermann
  - runs the clutch-type LSD (power/coast lock, 100% = locked), clutch heat and the countersteer assist (`assists.countersteer`)
- **Data:**
  - Tire sim parameters: `tires.json` → each compound's `sim` block.
  - Alignment and pressures: `spec.alignment` (defaults in `defaultAlignment()`).
  - Steering ratio: `spec.steerRatio`.
- **Input:** `Input` reports raw values and the device. `Game.steerInput` runs the profile pipeline and sets the assist strength.
- **Test helpers:**
  - `tests/sim/drift5.ts`: `driftSpec()` (S15 drift set-up), `driftCar()`, `HoldBot` (throttle plus a stick limited to ±0.25), `longestHold()`.
  - `tests/sim/techniques.ts`: the scripted technique entries.

## Step 4: drift techniques (§6). Continue here

`npx tsx tests/tools/techniques.ts sakura_s15` (or `takumi_ae`) prints each entry's time to reach 25° (from its trigger) and how long it was held.

| Technique | S15 drift set-up | Takumi AE |
|---|---|---|
| Power-over | ✅ 1.1 s, 4.6 s hold | ❌ not enough power on the drift set-up |
| Handbrake (clutch in) | ✅ 0.9 s, 5.0 s | ✅ 1.3 s, 4.7 s |
| Clutch kick | ✅ 0.7 s, 5.1 s | ✅ 0.8 s, 5.0 s |
| Braking drift | ❌ 2.4 s to 25° (needs < 2) | ❌ |
| Feint | ✅ 1.8 s, 3.9 s | ❌ |
| Lift-off | ❌ 2.4 s to 25°, 2.6 s hold | ❌ |
| Transition, holding, exit, manji | not scripted yet | — |

What to do:
1. **Build the Section 7 presets first** (Drift Base, Beginner Drift…). They replace `driftSpec()`, and the AE needs its Beginner Drift preset: more rear grip, higher-falloff tires and a stronger assist. Its weak entries are a set-up problem as much as a physics one.
2. **Braking and lift-off entries need more rear unloading.** Candidates, each checked against `tests/sim.test.ts`:
   - lower rear rebound damping, so the rear rises faster when weight goes forward
   - brake bias toward the rear on the drift preset (the doc's "neutral" bias per car)
   - a softer front bump
3. **Script the remaining four** in `tests/sim/techniques.ts`:
   - **Transition:** from a held left drift, steer past centre, brief lift, re-apply; it must reach 25° the other way within 2 s.
   - **Holding:** more throttle = more angle (two hold runs at different throttle).
   - **Exit:** open the steering and ease the throttle; the angle drops below 10° within 2 s without exceeding 15° the other way.
   - **Manji:** alternating 20°+ slides on a straight.
4. **Add every technique to `tests/techniques.test.ts`** (the `PASSING` map) for the S15 Drift Base and the AE Beginner Drift presets.
5. **Drift School mode** on the skidpad: one lesson per technique, with a text prompt, a ghost demo car replaying the same scripted entry, and a pass/fail check from `run()`.

## Steps 5–10

Follow `KAZE_DRIFT_UPDATE_5.md` §7–§12 in order. Notes:
- **§7:** Update 4's tuning screen (`src/ui/upgradeShop.ts`, `TUNES` in `src/garage/parts.ts`) becomes the Setup tab. Map its sliders onto `spec.alignment`, the springs, dampers and anti-roll bars (0–100), brakes, gearing, diff and steering. Add the presets and a "Test on skidpad" button, and check each slider group's direction with a unit test.
- **§8:** merge into `src/scoring/skillChain.ts`. Add the doc's angle, speed and multiplier rules, anti-snaking (≥ 0.8 s and ≥ 20° to count) and front/rear bumper clip detection.
- **§9:** `src/render/camera.ts` has chase, far, hood and bumper. Add Drift Cam, Cockpit, Helicopter and TV cams, wheelbase scaling, right-stick orbit and wall-collision pull-in.
- **§10:** generate the touge like `tests/tools/gen_openroad.py`. Gutters use the new `gutter` surface plus a lateral constraint.
- **§11–12:** telemetry overlay (F4) using `freeSteerAngle`, the tire states (`wheels[i].st`) and diff lock; replays; `PHYSICS.md`.
