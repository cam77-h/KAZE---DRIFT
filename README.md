# Kaze Drift 風

A JDM street-culture driving game for the browser: tight drift handling, Japanese-inspired locations and a deep garage. Built with Vite, TypeScript (strict) and Three.js. The full design spec is in [`KAZE_DRIFT_SPEC.md`](KAZE_DRIFT_SPEC.md); progress and the next steps are in [`NEXT_STEPS.md`](NEXT_STEPS.md).

**Status: Update 2, steps 1–4 of 7 done** (see [`KAZE_DRIFT_UPDATE_2.md`](KAZE_DRIFT_UPDATE_2.md) and [`NEXT_STEPS.md`](NEXT_STEPS.md)):
- **Cars:** eight, seven of them imported 3D models.
- **Modes:** Open Road (a 9 km loop with traffic), Drift Track (four venues: Drift Attack, Time Attack and Tandem), and Practice.
- **Progression:** a skill chain, money, levels, a dealer and a skill tree.
- **Still to build:** the 3D garage with part installs, and the records screen.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Vitest unit tests (physics, tires, save system, track, input) |
| `npm run smoke` | Update 2 check: menus → Open Road → results, screenshots to `screenshots/update-2/`. Needs `npx vite --port 5199` running |
| `/model-viewer.html` | Every car and traffic model on a turntable, with bounding boxes and wheel pivots (`?m=<id>`) |

`dist/` is a plain static site with relative paths, so it runs from any static host, including a GitHub Pages project subpath.

### Deployment

`.github/workflows/deploy.yml` type-checks, tests and builds every pull request. Every push to `main` (including merged pull requests) is also deployed to GitHub Pages. One-time repo setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. GitHub Pages on a private repository needs a paid GitHub plan; on a free plan the repository must be public.

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Throttle | W / ↑ | RT (analog) |
| Brake / reverse | S / ↓ | LT (analog) |
| Steer | A D / ← → | Left stick (analog), D-pad |
| Handbrake | Space | A |
| Clutch (clutch kick) | Left Shift | LB |
| Shift up / down (manual) | E / Q | B / X |
| Change camera | C | Y |
| Look back | B | RB |
| Reset car | R | Back |
| Pause | Esc / P | Start |

All bindings can be remapped in **Settings → Controls**, along with steering sensitivity, steering linearity, stick deadzone, keyboard steering speed and vibration. On phones and tablets, on-screen controls appear: a steering slider on the left, and gas, brake, e-brake and camera buttons on the right.

Assists are friendly by default: ABS, drift assist at 55%, steering assist, automatic gearbox. **Settings → Assists → Expert** turns them all off and switches to the manual gearbox.

URL options for testing: `?hour=21` previews night (any hour 0–24).

## How it is built

```
src/
  core/      game loop (fixed 120 Hz physics, interpolated rendering), state machine, events, settings, save system
  input/     keyboard, gamepad (analog + rumble) and touch input with remappable bindings
  physics/   four-wheel vehicle (raycast suspension), magic-formula tire model, drivetrain, surfaces, collisions
  vehicles/  procedural car model (lofted profiles), wheels, the physics-to-model binding
  world/     spline track system (ground query used by physics and meshes), track meshes, scenery
  render/    sky + time of day + PMREM environment, post-processing, chase camera, smoke, skid marks, textures
  audio/     synthesised engine, turbo, blow-off valve, tire squeal, wind, impacts
  ui/        HUD, menus, settings screens, touch controls, styles
  data/      cars.json, tires.json, names.json (all display names), tracks/*.json
tests/       vitest unit tests; tests/smoke = Playwright smoke test; tests/sim = headless tuning tools
reference/   the v0.1 prototype the handling was ported from
dev/         dev-only pages (dev/car.html is a car turntable for checking models)
```

### Adding a car

1. Add an entry to `src/data/cars.json`. The `physics` block sets mass, geometry, engine torque curve, turbo, gearbox, differential, suspension and tires. The `visual` block picks the procedural body shape and wheel size.
2. Add the display name to `src/data/names.json`. Every in-game name lives there, and all names are fictional.
3. Give it a body: add a profile function in `src/vehicles/shapes.ts` (side, top and plan curves plus greenhouse) and register it in `SHAPES` in `src/vehicles/carView.ts`. Or drop in a glTF model (see below).
4. Use `dev/car.html?yaw=0.7&pitch=0.15` under `npm run dev` to look at it, and `npx tsx tests/sim/drift.ts` to check its handling.

### Adding a track

1. Create `src/data/tracks/<id>.json`. `roads` are closed or open Catmull-Rom splines: each point is `[x, y, z]` or `[x, y, z, width, bankDegrees]`, with kerbs, shoulders and walls (`tire`, `concrete`, `guardrail`, `fence`) placed by fraction of road length. `pads` are flat areas (paddocks, skidpads). `terrain` sets the noise-based hills around the course, and `scenery` sets trees, stands and the theme.
2. Register it in `TRACKS` in `src/data/index.ts` and give it a name in `names.json`.
3. Preview the layout with `npx tsx tests/sim/layout.ts src/data/tracks/<id>.json out.svg`. This prints the length, tightest radius and the closest gap between separate parts of the road.

### Dropping in assets (models, music)

The game generates everything in code and needs no downloaded files. Optional assets go in `assets/`:

- **Cars:** put the `.glb` under `public/assets/models/` and describe it in `src/data/cars.json` → `visual.glb`:
  - `file`, `forward` (`"+z"` or `"-z"`) and the real-world `length` in metres
  - optional `wheels` node names [FL, FR, RL, RR]; wheels are auto-detected by shape and position otherwise, and a shared rear-axle node is fine
  - `paintMaterials`, or `paintKey`/`paintTolerance` for atlas-textured models
  - `hide` (badge nodes or materials), `plates`, `headMaterials`/`tailMaterials`
  - `strip`: regions where modelled lettering is deleted

  Check it in `/model-viewer.html?m=<id>`. If loading fails, the game falls back to the procedural car.
- **Music:** `assets/music/*.mp3|ogg` (the radio arrives in Phase 6).

Third-party assets must be CC0 or CC-BY and listed in [`CREDITS.md`](CREDITS.md).

## Docs

- [`KAZE_DRIFT_SPEC.md`](KAZE_DRIFT_SPEC.md): the full design spec
- [`NEXT_STEPS.md`](NEXT_STEPS.md): where the build stands and what to do next
- [`DECISIONS.md`](DECISIONS.md): design calls made along the way, one line of reasoning each
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each phase
- [`CREDITS.md`](CREDITS.md): fonts and libraries
