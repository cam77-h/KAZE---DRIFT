# Next steps

To continue in a new session, say: **"Read KAZE_DRIFT_SPEC.md and NEXT_STEPS.md and continue."**

## Where the build stands

**Phase 1 (Foundation) is complete** on branch `phase-1-foundation`. Tests pass (31), `npm run build` succeeds, and the Playwright smoke test drives 10 s on both locations with no console errors. Screenshots are in `screenshots/phase-1/`.

What exists (details in `CHANGELOG.md`, the reasoning behind each call in `DECISIONS.md`):

- Fixed 120 Hz loop, state machine, event bus, settings, versioned save with migrations and export/import codes.
- Four-wheel physics: raycast suspension, magic-formula combined-slip tires, turbo engine, clutch, gearbox, LSD, assists, surfaces, wall/body collisions.
- One car: the Sakura S15, with a procedural model.
- Two locations: Kaze Test Skidpad and Minami Drift Park.
- Basic HUD, menus, settings, touch/gamepad/keyboard input, synthesised engine audio, smoke, skid marks.
- GitHub Actions workflow that deploys `main` to GitHub Pages.

## Phase 2: scoring and the first great location (do this next)

Spec sections 5, 7.2, 8 and 10 (spring, day/night).

1. **Skill chain** (`src/scoring/skillChain.ts`): skills add points, the multiplier runs 1×–10× with tiers, points bank after 2.5 s idle, and a countdown ring on the HUD. A wall, traffic or a spin-out wipes the unbanked chain with a "CHAIN BROKEN" moment. The hooks are already in place:
   - `Game.step()` already gets `vehicle.impacts`.
   - `PostStack.setLook()` already takes a `desaturate` amount (it currently flashes on hard impacts).
   - `ConeField.onKnock` is the hook for Wreckage points.
2. **Drift judging** (`src/scoring/driftJudge.ts`): score = angle × speed × line × proximity × style. Place clipping points and zones in track JSON (`clips: [{ s, side, kind }]`), show them as glowing markers, and add penalties and a results breakdown with medals. Minami's concrete wall is at 0.645–0.765 of the lap (right side) and makes a natural outer clipping zone.
3. **Akagiri Touge**: build it on the `Road` system with a long open (point-to-point) road. Add hairpins, gutters (a narrow drop in the height function at the road edge, which wheels can hook), guardrails, cedar forest, a torii gate and stone lanterns at the summit, a lookout with vending machines, and the hotel. It needs downhill, uphill and full routes, which can be the same road with different start/finish `s` values.
4. **Spring season**: sakura trees as an instanced variant in `scenery.ts`, plus falling petals as a second `SmokeSystem`-style instanced particle layer with a pink tint and slow fall.
5. **Day and night**: `Environment.setHour()` already handles the sun, moon, stars, exposure and environment map. Still to do: point/spot lights for streetlights near the camera (pool ~8, nearest first), a sodium colour, and light pools on the road.
6. **Modes** (`src/modes/`): drift zone, time attack with ghosts and sectors, and tandem chase, which needs `ai/leadDriver.ts` following a scripted line with angle and speed targets.
   - Ghosts: record the pose at 30 Hz and store it delta-encoded in `save.records.ghosts` (see `SaveData`).

## Known gaps and polish notes carried forward

- **glTF car loading** is Phase 4. The node-name contract is documented in the README.
- **Engine swaps, parts and tuning** are Phase 3. `Vehicle.rebuild()` already recomputes everything derived from the spec, so the parts system can edit a cloned `CarPhysicsSpec` and call it.
- **Expert mode (no assists):** the car is drivable but twitchy. The scripted drift test in `tests/sim/drift.ts` with assist 0 oscillates between 18° and 48°. Consider a little more rear falloff or yaw inertia if playtesters find Expert too hard.
- **Car model:** the lamp outlines are a little stepped up close, so raise the patch resolution or clip to the outline. The nose could be slightly sharper.
- **Night** is dark away from the headlights until streetlight lights arrive in Phase 2.
- **Performance** was only checked headless with a software renderer (about 2–3 fps there, so not representative). Measure on real hardware at the Medium preset; the main levers are tree count (`scenery.trees.count`), shadow quality and render scale.
- **Mechanical damage** has a setting slot (`assists.damage`) but no effect yet; visual scuffs come later.

## How to verify a phase

```bash
npm test
```

```bash
npm run build
```

```bash
npx vite preview --port 4173 &
```

```bash
node tests/smoke/smoke.cjs <phase-number>
```

Then look at `screenshots/phase-N/`, fix anything broken or ugly, update `CHANGELOG.md`, `DECISIONS.md` and this file, and commit.
