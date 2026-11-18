# Changelog

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
