# Changelog

## 0.3.0: Update 2 (steps 1–4 of 7)

- **Real 3D models.** Seven imported player cars (Takumi AE starter, Kumo Sedan, Sakura 18 Targa, Hoshi GT, Sento RS, Kaze R7 '87, Raiden 34) plus the procedural Sakura S15, and 20 traffic models (Kenney Car Kit and others). One `CarModelLoader` handles scale, orientation, grounding, wheel pivots, paint, fictional plates, badge removal and lights, and each car's physics geometry is fitted to its model. `/model-viewer.html` debug page; in-game Settings → Credits.
- **Cars look good.** Clearcoat paint with gloss / metallic flake / pearl / matte / satin / chrome / candy finishes (including on atlas-textured models), tinted glass, soft contact shadows, stance, SSAO from Medium up.
- **New flow.** Title → main menu (Play, Garage, Dealer, Records, Settings, How to Drift) → mode select → car select → event → drive → results, with level / money / SP on every menu screen.
- **Open Road.** An 8.9 km loop (town, Wangan expressway, Akagiri touge, Shiokaze coast with a tunnel), with left-hand AI traffic that brakes and honks, near misses, 4 drift zones, 2 speed traps, near-miss alleys and a danger sign. Money accrues as you drive; End Run shows the results.
- **Drift Track.** Minami Drift Park, Minami Reverse, Tsukinami Raceway and Port Gymkhana, each with Drift Attack (auto-placed glowing clipping points, line/angle/proximity judging), Time Attack (3 laps, sectors, saved ghost) and Tandem Chase (scripted lead car, Win / OMT / Lose). Medals, first-time medal bonuses, top-10 records.
- **Skill chain.** Drift tiers, transitions, e-brake turns, near misses, Daredevil, clipping points, wreckage, airtime, speed. ×1–×10 multiplier with colour tiers, banking ring, popups, and a dramatic CHAIN BROKEN (flash, desaturation, glass crack).
- **Economy.** ¥ money, XP and driver levels, skill points. `economy.json` is tuned by a scripted-driver pacing test. Dealer with level gates and 60% sell-back; a skill tree with 15 ranks; a milestone celebration every 5 levels.
- **Save v3** migrates Phase 1 saves without losing anything (the new starter car is added alongside).
- 50 unit tests; `tests/smoke/update2.cjs` drives menus → Open Road → results.

## 0.2.0: Phase 1, Foundation

- Vite + TypeScript (strict) + Three.js project. It builds to a static site in `dist/`, and a GitHub Actions workflow tests, builds and deploys `main` to GitHub Pages.
- Game loop with fixed 120 Hz physics and interpolated rendering. Includes a state machine (title, location select, loading, driving, paused) and an event bus.
- Four-wheel vehicle physics, ported from the prototype and improved:
  - raycast spring/damper suspension per wheel, with anti-roll bars and bump stops, riding real elevation, banking and kerbs
  - magic-formula tire model with combined slip, per-compound peak slip angle/ratio, falloff and load sensitivity
  - turbo engine with lag, rev limiter and engine braking; clutch with slip/lock coupling, so clutch kicks work; 6-speed gearbox (auto and manual); 1.5-way LSD; RWD/FWD/AWD support
  - surfaces (asphalt, concrete, paint, kerb, gravel, dirt, grass, snow, ice) with wet grip
  - assists: ABS, TCS, stability, drift assist (counter-steer help + yaw damping), steering assist, plus a one-click Expert preset
  - collisions with walls (tire, concrete, guardrail, fence) and the ground, and knockable cones
- Sakura S15 (fictional, inspired by the Silvia S15) with a procedural model:
  - lofted body with cut wheel arches; separate greenhouse with glass, pillars and headliner
  - swept headlights, wraparound taillights, intakes, Japanese-style plates, door/hood/trunk seams, mirrors, lip spoiler and exhaust
  - right-hand-drive interior
  - 6-spoke "Kumo" wheels with brake discs and calipers
- Locations:
  - Kaze Test Skidpad: painted rings, figure-eight circles and cone gates
  - Minami Drift Park: a 1.04 km mountain course with a gantry, grandstands with spectators, sponsor garages, vending machines, floodlights and forests
- Rendering: physically based sky with a PMREM environment, ACES tone mapping, a tight shadow frustum that follows the car, SSAO, bloom, SMAA, a grade pass (vignette, grain, radial speed blur), instanced tire smoke and skid marks. Low/Medium/High/Ultra presets plus individual toggles.
- Audio: synthesised turbo I4 engine (on/off-throttle layers, limiter), turbo whistle, blow-off valve, tire squeal, gravel crunch, wind, impacts.
- Input: keyboard (ramped steering), gamepad (analog triggers/stick, rumble), touch controls (analog steering slider). All bindings remappable, with sensitivity, linearity and deadzone settings.
- HUD: tachometer with shift lights, gear, speed, boost gauge, drift-angle meter, assist lights, rotating minimap, optional telemetry overlay.
- Menus: title (attract camera), location select with map previews, pause, a full settings screen (graphics, controls, assists, audio, gameplay, save), tachometer-style loading screen with driving tips.
- Versioned save system in localStorage with migrations (including the v0.1 prototype's keys), automatic backup, and compressed export/import codes.
- Tests: 31 vitest tests, including the spec's physics checks (0–100 km/h, braking distance, grip cornering, an 8 s scripted drift hold, no NaN under fuzzing), plus a Playwright smoke test that saves screenshots to `screenshots/phase-1/`.

## 0.1.0: Prototype

- Single-file Three.js r128 prototype with a 2D bicycle-model drift physics. It is kept in `reference/kaze-prototype/`.
