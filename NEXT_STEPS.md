# Next steps

To continue in a new session, say: **"Read KAZE_DRIFT_SPEC.md, KAZE_DRIFT_UPDATE_2.md and NEXT_STEPS.md and continue."**

## Where the build stands

Work is on branch **`update-2`** (pushed). `KAZE_DRIFT_UPDATE_2.md` overrides the original spec where they disagree. Its steps, in order:

| Step | Update 2 sections | Status |
|---|---|---|
| 1 | §1 Real 3D models | **Done.** `CarModelLoader`, 7 imported cars + traffic, `/model-viewer.html`, Settings → Credits |
| 2 | §2 Make the cars look good | **Done.** Paint finishes, contact shadows, stance and camber, SSAO at Medium; before/after shots in `screenshots/update-2/cars/` |
| 3 | §3–5 Mode select, Open Road, Drift Track | **Done.** Menu flow, 8.9 km Open Road with traffic and activities, 4 drift venues × 3 events, results |
| 4 | §6–7 Scoring, money, XP, skill points | **Done.** Skill chain, `economy.json` tuned by the pacing test, Dealer, skill tree, milestones |
| 5 | §8 Garage with live part installs | **Next: not started** |
| 6 | §9 High scores and records | Partly done: records are saved (top-10 tables, ghosts, medals, career stats); the Records screen isn't built |
| 7 | §11 Verify everything (+ §10 polish) | Partly done: `tests/smoke/update2.cjs` covers menus → Open Road → results; the garage, purchase and record checks are still to add |

Tests: 50 vitest tests pass (`npm test`), `npm run build` passes, and `node tests/smoke/update2.cjs` passes against `npx vite --port 5199`.

## Step 5: the Garage (§8). Do this next.

Build it in this order, committing after each part:

1. **Parts data** (`src/data/parts.json`): every performance part as data. Each part has a slot, a tier (street/sport/race/pro, with the level gates from `economy.json` `partTierLevel`), a price, a plain-words description, and an `effects` object applied to a cloned `CarPhysicsSpec`:
   - torque multiplier, turbo spool and lag, boost share
   - gear ratios, final drive, clutch torque, diff type and locks
   - springs, dampers and anti-roll bars, steer lock (angle kit 35° → 55° → 70°)
   - tire compound, brake torque, handbrake torque, mass
   - downforce, from aero

   Write `applyParts(spec, owned.parts, owned.tune)` in `src/vehicles/parts.ts`. Call it in `Game.ensureCar()` after `carPhysics()` and before `fitPhysicsToModel`. `Vehicle.rebuild()` already re-derives everything from the spec.
2. **Visual parts**, built procedurally from `CarVisual.dims` (length, width, height, axle z, wheel radius) so they fit every model:
   - wings (none, ducktail, low GT, high GT, swan-neck, with stands and endplates)
   - lip / splitter, side skirts, diffuser, canards
   - fender flares sized to the wheel
   - exhaust tips (single, dual, bosozoku, centre)
   - hood (vented, carbon), tow hook, beginner-leaf sticker, underglow, tinted glass

   Put them in `src/vehicles/visualParts.ts`. They attach to `visual.root`.
3. **Wheels:** at least 8 designs. Use the Kenney `wheel-*.glb` models plus procedural 6-spoke, mesh, deep-dish and 5-spoke (`buildWheel` in `src/vehicles/wheelModel.ts` already does 6-spoke and mesh). Swap the visual wheel inside each `WheelSlot.spin`, with size, width, colour and stance. Stance uses `CarView.setStance(drop, camberF, camberR)`, which already exists.
4. **The 3D garage scene** (`src/world/garage.ts`): a room with tool walls, a car lift, fluorescent tubes (one flickering), posters using `bannerTexture` with the fictional brands, a tire stack and a sleeping cat. The car sits on a slowly turning turntable, and the camera flies to the part's area (wheels, front, rear, engine bay with the hood open, exhaust, underside).
5. **Garage UI:** a categories rail, the part list, and before → after stat bars:
   - Power, Grip, Handling, Braking, Drift, Rating/class: compute the rating (100–999) and class D…X from power-to-weight, grip, braking and aero.
   - Hovering a part previews it.
   - Buying runs a ~1.5 s install animation (skippable): the old part pops off, the new one slides on, sparks, a clank sound (`CarAudio.sfx` style).
   - Paint sweeps across like a spray pass.
6. **Tuning tab** (unlocks per part): tire pressure, camber, toe, ride height, springs, ARBs, diff lock, brake balance, final drive. Each slider gets a tooltip and an understeer ↔ oversteer bar, plus per-car presets.
7. **Paint** (`PaintFinish` in `src/vehicles/paint.ts`): body, wheel and caliper colours, plus livery presets (stripes, panda two-tone, number boards).
8. **Test drive:** drops you on the skidpad (`startSession({mode:'practice', location:'skidpad', event:'free'})`), and one key returns you to the garage. The `testDrive` perk pays ¥500.
9. **Skill tree tab:** move it inside the Garage (the main-menu GARAGE button currently opens it directly: `Game.openShop('skills')`). The milestone "free part" from §7 lands here.

## Step 6: Records (§9)

The data already exists:
- `save.records.tables` (top 10 per `track|event`, shaped `{track, event, score, car, date, playerName}`)
- `save.records.ghosts` (best Time Attack lap per `event|car`, base64 Float32 at 30 Hz)
- `save.records.medals`, `zoneStars`, `trapStars`
- `save.stats` (distance, longest drift, biggest chain, money earned, near misses, cones hit, time played, time per car)

Still to do:
- Build the Records screen: a tab per venue / event / Open Road zone with the top 10, personal best and medal targets (`src/data/events.json`, zone stars in the track JSON), plus career stats including favourite car (the most `stats.carTime`). The main menu's RECORDS button currently shows a toast (`Game` → `openRecords`).
- Ghosts are keyed per car. The update asks for "per track and car class", so switch the key once classes exist (step 5).
- New-record moments: the results banner and fanfare already work.

## Step 7: verify (§11) and polish (§10)

- Extend `tests/smoke/update2.cjs`:
  - Garage: buy a wing and wheels, check money went down and the parts are visible (count meshes under `visual.root` named `part-*`)
  - Drift Track: run an event and check a record was saved (`window.__kaze.game.save.records.tables`)
  - Look at every screenshot.
- Re-check `/model-viewer.html` for every model.
- §10:
  - F3 performance overlay toggle: `Hud` telemetry exists; add fps, draw calls (`renderer.info`) and the traffic count.
  - Tachometer-styled loading bar for model preloading (`preload()` in `modelLoader.ts` reports progress).
  - Instancing or LOD for distant traffic (it's currently pooled and culled beyond 700 m).
  - Back buttons and gamepad focus on every new screen.
- Update `README.md` and `CHANGELOG.md` for the garage and records, then commit and open a pull request.

## Known gaps carried forward

- **Tandem Chase** runs only the chase run. The "swap roles, you lead" second run is still to do: record the player's lead line, then have the AI follow it.
- **The RX-7's pop-up headlights** don't animate yet. The node is `Headlights` in `kaze_rx7fc_ivofficial.glb`; rotate it about its rear edge at night.
- **Traffic:** no night lights, no turn signals and no lane changes yet; it never overtakes.
- **Open Road danger sign:** the summit crest is gentle, so jumps there are small. Add a real kicker (a short height bump in the road profile, `tests/tools/gen_openroad.py`) if it feels flat.
- **Real-GPU performance** is unmeasured. Everything was checked in software rendering at about 1–3 fps.
- **The Phase 1 smoke script** (`npm run smoke:phase1`) still expects the old title menu. The Update 2 script (`npm run smoke`) supersedes it.

## Useful tools

- `node tests/tools/glbinfo.mjs <file.glb>`: node tree, bounds and materials of a model
- `node tests/tools/viewershots.cjs <outdir> http://localhost:5199 name:m=<id>&yaw=..`: model-viewer screenshots
- `npx tsx tests/sim/layout.ts <track.json> out.svg`: layout preview and stats
- `python3 tests/tools/gen_openroad.py` / `gen_tracks.py`: regenerate the Open Road and the new drift venues
- `node tests/tools/modeart.cjs`: re-render the mode-select art
- `window.__kaze` in the browser: `session(cfg)`, `end()`, `teleport(s, speed)`, `setInput({...})`, `money()`, `result()`, `traffic()`
