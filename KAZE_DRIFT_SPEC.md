# KAZE DRIFT — Full Build Spec for Claude Code

You are building **Kaze Drift**, a JDM street-culture driving game that runs in the web browser. It should feel like a real, hand-crafted game, not an AI demo: tight car handling, real progression, detailed Japanese locations that change with the seasons, and a deep garage where every part changes how the car drives and looks.

Read this whole document before writing code. **Work on your own and do not ask me questions.** When something is unclear, make the choice a good game designer would, write it down in `DECISIONS.md` with one line of reasoning, and keep going. Build in the phases listed at the end. The game must be playable at the end of every phase.

---

## 0. Starting point

- A working prototype (v0.1) is in `reference/kaze-prototype/`: `index.html` (Three.js r128, one file) and `physics.js` (a 2D bicycle-model drift physics with weight transfer). Its driving feel is the baseline. Port the ideas and tuned values into the new architecture, then improve them. Don't throw the feel away.
- Tuned values from the prototype that produce a holdable ~30° drift at ~65 km/h: engine force 12,500 N, mass 1,250 kg, CG to front 1.25 m, CG to rear 1.35 m, front grip 2.0, rear grip 2.15, cornering stiffness front 5.0 / rear 5.4, throttle breakaway 0.38, handbrake keeps 42% of rear grip, yaw-damping drift assist 0.55, weight transfer 0.25, roll resistance 6, air resistance 2.2. The tire curve is linear up to grip, then falls off gently (front 10%, rear 20%), which is what makes slides holdable.

## 1. Product vision (the feel we are going for)

- **Fantasy:** you're a newcomer in Japan's street-car scene. You start with a cheap 80s hatchback, earn your reputation at night meets, touge runs, expressway traffic drifting and circuit days, and build a garage of legends.
- **Tone:** a love letter to JDM culture. Think late-night parking-area meets, cherry blossoms on a mountain pass, neon reflected on wet expressway asphalt, eurobeat energy. It's stylized-realistic, not cartoonish and not gritty.
- **Reference game:** Forza Horizon 6 (set in Japan, released May 2026) is the main reference for *gameplay structure and polish*: skill chains, drift zones, speed traps, danger signs, time attacks, seasons that change the world, event series that unlock progressively, car collection, a deep upgrade and tuning menu, and a performance class system. Borrow these *ideas and mechanics*. Never copy its names, logos, UI artwork, text, music or assets.
- **Our own spin (what makes this game different):**
  1. **Parts you can feel.** Every upgrade changes the physics in a way you notice, and the garage shows a before/after handling chart.
  2. **Tandem chase mode.** You follow an AI lead car down a touge or around a drift course and are judged on how close you stay and how well your angle matches the leader's.
  3. **Build codes.** A whole car (parts + tune + paint + stickers) packs into a short shareable code that someone else can import and drive.
  4. **Real drift judging.** Clipping points, clipping zones and an ideal line, the way competition drifting is judged, not just "angle × speed".

## 2. Legal and originality rules (must follow)

- **No real car brands, model names, badges or logos.** Every car is a fictional model *clearly inspired by* a JDM legend (Section 6). Keep all display names in one data file so a private build could rename them, but ship the fictional names.
- No real sponsor, tuner, wheel or parts brands. Invent original brands for stickers, wheels and parts (e.g. "Hoshi Racing", "Kumo Wheels", "Tora Works", "Shin-Kaze Engineering"). Wheel designs may evoke classic styles (6-spoke, mesh, deep-dish) but must not copy a specific trademarked design.
- No copied music, sound, textures or models. Only use assets you generate in code, or third-party assets under CC0/CC-BY licenses, listed with attribution in `CREDITS.md`.
- Locations are fictional places inspired by real ones (Section 7). No real place names on signs; invent them.

## 3. Tech stack and architecture

- **Vite + TypeScript (strict)** and **Three.js (latest)** with WebGL2. Use no heavier game engine. Build output is a static site (`npm run build` → `dist/`) that runs from any static host.
- Folder structure (suggested):
  ```
  src/
    core/        game loop (fixed 120 Hz physics, interpolated rendering), state machine, events, save system
    physics/     vehicle model, tire model, collisions, surfaces
    vehicles/    car definitions (data), procedural car builder, glTF loader, part system
    world/       track/spline road generator, scenery placement, seasons, weather, time of day, traffic
    modes/       free roam, drift zone, time attack, circuit/sprint race, traffic drift, tandem, touge battle
    scoring/     skill chain, drift judging, medals
    ai/          racing-line follower, traffic drivers, tandem lead driver, rivals
    audio/       synthesized engines, turbo/blow-off, tires, ambience, radio
    render/      post-processing, materials, particles (smoke, sparks, petals, leaves, snow, rain)
    ui/          menus, HUD, garage, tuning, livery editor, photo mode
    data/        cars.json, parts.json, tracks/*.json, events.json, stickers, wheels
  assets/        (optional) glTF models, HDRIs, audio files dropped in by the user
  tests/         vitest unit tests (physics, scoring, save), Playwright smoke tests
  ```
- **Data-driven:** cars, parts, tracks, events and rewards live in JSON or TS data files, so content can be added without touching engine code.
- **Assets:** support loading `.glb` car and prop models from `assets/` through GLTFLoader. If a model is missing, build a **detailed procedural model** in code instead (Section 9), so the game never depends on downloaded files. Document in `README.md` exactly where to drop models and how to map wheels, lights and body panels (by node name).
- **Performance:** hold 60 fps on a mid-range laptop at the "Medium" preset. Use instanced meshes for repeated scenery, LOD for distant objects, frustum culling, a pooled particle system, shadows only near the camera, and texture atlases. Offer Low/Medium/High/Ultra presets plus individual toggles (shadows, SSAO, bloom, motion blur, render scale, particle density, draw distance).
- **Input:** keyboard, gamepad with analog throttle, brake and steering (rumble when supported), and on-screen touch controls for phones. All bindings can be remapped. Add steering sensitivity, steering linearity and deadzone settings.
- **Save system:** versioned localStorage save with migrations. Saves money, XP, owned cars, installed parts, tunes, liveries, medals, best times, ghosts, settings, season and time preferences. Add a save export/import code so progress can move between browsers.

## 4. Driving physics (most important system)

Upgrade the prototype to a **four-wheel vehicle model**:
- Per-wheel suspension raycasts against the track surface (spring + damper), so the car rides real elevation, crests, cambered corners and kerbs.
- Per-wheel load from weight transfer (longitudinal and lateral), with anti-roll bars.
- A tire model in the spirit of Pacejka (a simplified "magic formula"), with combined slip: longitudinal and lateral forces share a friction circle, so wheelspin and braking reduce cornering grip. Slip-angle peak and falloff vary by tire compound.
- **Drivetrain:** engine torque curve per engine type, a gearbox with real ratios and final drive, clutch, rev limiter, auto/manual shifting (manual with clutch-kick as an advanced drift input). Turbo boost builds over time with lag, set by turbo size. Differential types: open, 1.5-way LSD, 2-way LSD, welded. RWD/AWD/FWD, with an RWD conversion part for AWD cars.
- **Drift techniques must work:** power-over, handbrake/e-brake entry, feint (Scandinavian flick), clutch kick, braking drift, lift-off oversteer, transitions between left and right drifts, and holding a long tandem drift.
- **Surfaces:** asphalt, wet asphalt (less grip, spray), concrete, painted lines (slightly slippery when wet), gravel/dirt, grass, snow and ice (winter), kerbs. Grip scales with the surface and the season's weather.
- **Assists** (each can be toggled): ABS, traction control, stability control, drift assist (counter-steer help + yaw damping), auto-brake for racing lines, steering assist. Defaults are friendly, and an "Expert" preset turns them all off.
- **Collisions:** car vs walls, guardrails, barriers, traffic and AI cars, plus knockable props (cones, signs, bins, fences) that give "wreckage" skill points. Sparks on scrapes, small visual damage (scuffs and a hanging bumper) with no mechanical damage by default (optional setting).
- Write vitest tests for the physics: straight-line acceleration times, grip cornering stays stable, a scripted controller can hold a drift between 25° and 45° for 8 seconds on the stock S-chassis car, braking distances are plausible, and nothing ever produces NaN.

## 5. Scoring: skill chains and drift judging

**Skill chain (Forza Horizon-style risk/reward):**
- Skills add points to a live chain. The multiplier grows with chain length (1× up to 10×, with visual tiers).
- Skills: Drift (by angle, speed, duration), Great/Insane/Legendary Drift tiers, Clipping Point, Tandem Close, Near Miss (traffic), Daredevil (several near misses in a row), Slipstream, Clean Racing, Airtime, Burnout, Wreckage (knocked props), E-Brake Turn, Speed (sustained high speed), Overtake, Two-Wheels (rare).
- **Banking:** points bank automatically after ~2.5 s with no new skill. A countdown ring shows the time left.
- **Losing it:** hitting a wall, a car or traffic, or spinning out (going backwards), **wipes the unbanked chain**, with a dramatic "CHAIN BROKEN" moment (screen desaturates briefly and a glass-crack sound plays). Banked points are safe.
- Skill points feed driver XP and unlock perks (small bonuses like +10% credits from drifting, longer bank timer, and more).

**Drift judging (for drift events):**
- Score = angle factor × speed factor × line factor × proximity factor × style multiplier.
- **Clipping points** (inner and outer) and **clipping zones** placed on drift courses: points scale with how close the car's front or rear passes. Show them as glowing markers when an event is active.
- Ideal line: deviating from it reduces the line factor.
- Penalties: two wheels off-track, wall contact, spinning, straightening out mid-zone.
- Results show a breakdown (angle / speed / line / proximity) and bronze/silver/gold/platinum medals.

## 6. Cars (fictional, inspired by JDM legends)

Ship at least these 10. Each has its own engine sound profile, torque curve, weight, drivetrain, wheelbase, upgrade paths and a signature visual detail.

| In-game name | Inspired by | Layout | Stock engine (fictional) | Signature detail |
|---|---|---|---|---|
| **Kaze R7** | Mazda RX-7 (FD) | FR | 1.3L twin-rotor sequential turbo, ~255 hp, 9,000 rpm | Pop-up headlights, rotary "brap" idle |
| **Hoshi 35Z** | Nissan 350Z | FR | 3.5L NA V6, ~285 hp | Wide rear haunches, deep V6 note |
| **Takumi AE** | Toyota AE86 Trueno | FR | 1.6L NA I4, ~130 hp, light | Pop-up lights, panda two-tone paint option |
| **Sakura S15** | Nissan Silvia S15 | FR | 2.0L turbo I4, ~245 hp | The default "learn to drift" car |
| **Raiden 34** | Nissan Skyline GT-R R34 | AWD (RWD conversion available) | 2.6L twin-turbo I6, ~320 hp | Round quad taillights |
| **Kaido A80** | Toyota Supra Mk4 | FR | 3.0L twin-turbo I6, ~320 hp, huge tuning headroom | Big hoop wing option |
| **Kumo JZ** | Toyota Chaser JZX100 | FR 4-door | 2.5L turbo I6, ~280 hp | Sedan drift legend, long wheelbase |
| **Sento IX** | Mitsubishi Lancer Evolution | AWD | 2.0L turbo I4, ~280 hp | Rally/time-attack grip monster |
| **Ronin NS** | Honda NSX (NA1) | MR | 3.0L NA V6, ~270 hp, VTEC-style cam switch | Mid-engine, twitchy at the limit |
| **Mame Kei** | Japanese kei truck | FR | 0.66L I3, ~50 hp | The joke car, funny to drift, has its own leaderboard |

- Engine swaps are possible (e.g. the "2J-style" twin-turbo I6 swapped into the S15 or AE), which changes weight distribution and sound.
- Cars are bought at a dealer in the hub. Some are **hidden "garage finds"** in free roam (FH barn-find style): rusty, and restored for free.
- **Performance rating:** a number from 100 to 999 calculated from power-to-weight, grip, braking, aero and handling, mapped to classes D / C / B / A / S1 / S2 / X. Events can restrict class (e.g. "B-class touge"). Show the rating and class badge everywhere a car appears.

## 7. Locations (fictional, inspired by Japan)

Build each location as a spline-based road network with real elevation, banking and road width, plus hand-placed and procedural scenery. Each location has free roam with activities and several event routes.

1. **Daikaku Parking Area (hub):** inspired by Daikoku Futo PA. A big spiral-ramp expressway parking area at night. It's the main menu world: your car is parked here, other fictional cars come and go, people stand around cars, there are vending machines, food stalls and a neon "Kaze Drift" sign. Entrances lead to Garage, Dealer, Events and Map. Free roam lets you do donuts in the lot.
2. **Akagiri Touge:** a mountain pass inspired by Akina/Haruna/Hakone. Hairpins, gutters (curb drops you can hook a wheel into), guardrails, cedar forests, a shrine torii gate at the summit, stone lanterns, vending machines at a lookout, a hotel on top. Routes: downhill, uphill, full run. Events: touge battle, tandem, drift zones, time attack.
3. **C1 Loop Expressway:** inspired by Tokyo's Shuto Expressway and the Wangan. An elevated multi-lane loop with tunnels, junction ramps, sodium-orange tunnel lights, sound walls, toll booths, city skyline, Rainbow Bridge-style suspension bridge. Dense **AI traffic**. Events: traffic drift, highway time attack, "Wangan" top-speed runs, speed traps.
4. **Neon District:** dense city streets inspired by Shinjuku/Shibuya. Narrow streets, scramble crossing, signs with fictional shop names in Japanese, convenience stores, vending machines, overhead power lines, rain puddle reflections. Events: street sprints, drift zones through intersections, danger signs off parking garage ramps.
5. **Minami Drift Park:** inspired by Ebisu Circuit's minami course and drift course. Drift-specific layouts with judged clipping points, a "drift bible" style tight section and a wall to clip, plus spectator stands. Events: judged drift competitions, tandem battles (lead and chase runs), gymkhana.
6. **Tsukinami Raceway:** a short technical grip circuit inspired by Tsukuba. Kerbs, pit lane, timing board. Events: time attack with ghosts and sector splits, circuit races versus AI.
7. **Bayside Docks:** port and warehouses at night. Containers, cranes, forklifts. Events: gymkhana, drift zones, wreckage challenges.
8. **Satoyama Countryside:** rural roads through rice terraces, small towns, rivers and bridges, a level crossing with a train passing. Events: sprints, speed traps, speed zones, cruising.

Each location has at least: 3 events, 2 drift zones, 1 speed trap, 1 speed zone, 1 danger sign (where it makes sense) and 1 hidden garage find in free roam.

## 8. Game modes and events

- **Free Roam:** drive anywhere in a location. Activities are marked on the map and in the world, Forza Horizon-style: Drift Zones (score target with stars), Speed Traps (one speed reading at a point), Speed Zones (average speed over a section), Danger Signs (jump distance), Trailblazers (point to point, cut corners allowed).
- **Drift Zone / Drift Attack:** a judged section with a medal target.
- **Time Attack:** laps against the clock, a ghost of your best lap (saved), sector splits with live green/red delta, a leaderboard of your own runs and the AI target times.
- **Circuit and Sprint races:** 5 to 7 AI opponents with racing-line AI, skill levels (Novice to Unbeatable) and light, honest rubber-banding.
- **Traffic Drift:** expressway or city with traffic. Score drift + near misses. One crash ends the chain, three crashes end the run.
- **Tandem Chase (signature mode):** follow an AI lead car. Scored on proximity, angle match and line. Swap roles for the second run (you lead and the AI chases). Judges' result: Win / OMT ("one more time") / Lose.
- **Touge Battle:** 1v1 downhill. The chaser wins by closing the gap and the leader by pulling away. Swap and run again.
- **Car Meet (hub):** a showcase mode: walk the camera around the PA and look at AI-built cars. A "rate my build" moment where NPCs react.

**Career / progression (inspired by FH event series and wristbands):**
- Event series grouped by discipline: Drift, Touge, Street, Circuit, Expressway. Each series has tiers that unlock as you earn badges (e.g. "Night Meet Rookie" → "Touge King" → "Wangan Legend"). Use your own badge names and art.
- **Season of Rivals:** each in-game season has a named rival with a signature car and a story beat told through short text cutscenes (no voice acting needed).
- Rewards: credits, XP, parts, cars, stickers, wheels, horns.
- A short guided intro: arrive at the PA in the Takumi AE, get taught to drift by a mentor character (a text-based story beat), run your first touge.

## 9. Garage: mods, tuning and customization

**Performance upgrades** (each with tiers Street / Sport / Race / Pro, a price, a rating impact, and a real effect in physics):
- **Engine:** intake, exhaust (changes sound), ECU tune, camshafts, intercooler, fuel system, engine internals.
- **Forced induction:** small/medium/large single turbo (different lag and power curves), twin-turbo conversion, supercharger. Blow-off valve and turbo flutter sounds. Anti-lag (pops and bangs, flames from the exhaust).
- **Engine swaps** per car.
- **Drivetrain:** clutch, gearbox (5-speed, 6-speed, sequential), driveshaft, differential (open, 1.5-way, 2-way, welded), RWD conversion.
- **Chassis:** coilovers (adjustable), anti-roll bars, chassis bracing, **angle kit** (steering lock 35° stock → 55° → 70° pro), hydraulic handbrake, weight reduction tiers, roll cage (adds rigidity and weight).
- **Tires:** street / sport / semi-slick / drift-spec / rally / snow compounds. Width front and rear (staggered setups).
- **Brakes:** pads, rotors, big brake kits.
- **Aero:** front splitter and rear wing that add real downforce (more grip at speed, a little top speed lost). Adjustable once installed.

**Tuning menu (FH-style, opens once the relevant parts are installed):**
- Tire pressures, gearing (each gear + final drive), alignment (camber, toe, caster), anti-roll bars, springs, ride height, damping (rebound, bump), aero balance, brake balance and pressure, differential (acceleration/deceleration lock).
- Every slider shows a live handling preview (understeer ↔ oversteer bar, a grip/accel/top-speed chart) and a plain-language tooltip ("more rear camber = more lateral grip but less traction exiting a drift").
- Save and load tune presets per car (e.g. "Drift", "Grip", "Touge").
- **Test drive** button that drops you on a skidpad from the garage.

**Visual customization:**
- **Body kits** per car: Stock, Street, Aero, Widebody (riveted overfenders style), Drift Missile (mismatched panels, zip-tied bumper).
- Bumpers, side skirts, hoods (vented, carbon), roof scoops, canards, diffusers.
- **Wings:** ducktail, low GT wing, high GT wing, swan-neck, "chuki"-style vertical wing (fun option), no wing.
- **Wheels:** at least 12 original designs (6-spoke, 5-spoke, mesh, deep-dish 3-piece, turbofan, steelies, bronze 10-spoke and more), from fictional wheel brands. Choose diameter, width, offset/poke, color, lip polish.
- **Stance:** ride height, front/rear camber (visual and physical), tire stretch, fitment. Make the "slammed with negative camber" look possible, with a handling trade-off.
- **Paint:** gloss, metallic, pearl, matte, satin, chrome, candy, color-shift. Separate colors for body, wheels, calipers, wing, mirrors.
- **Livery editor:** layer-based. Original shapes, stripes, numbers, Japanese characters and original sticker brands. Move/scale/rotate/mirror. Includes windshield banners, "drift missile" scuffs, panda two-tone and a few presets.
- **JDM accessories:** tsurikawa (hanging strap), shaken-style window stickers, wakaba beginner leaf, tow hooks, front plate holder, pop-up headlight wink, underglow, smoked lights, oil-cooler fins, bosozoku-style exhaust option (fun option).
- **Build codes:** export the full build (parts + tune + visuals) to a short code and import a code to load someone's build into an owned car.
- **Photo mode:** pause anywhere, free camera, focal length, depth of field, exposure, filters, frame, hide UI, then save the image (via a canvas data URL the user can open or copy).

**Procedural car models (fallback when no glTF is present):** do not build cars out of plain boxes. Generate each car from a set of hand-tuned 2D profile curves (side, top, front) lofted into a smooth body mesh with proper wheel arches, a beveled greenhouse, separate glass, door seams, light housings with emissive lenses, mirrors, a grille and exhausts. Each car's silhouette must be recognizably its inspiration's archetype (the R7's low curvy body, the A80's bubble roof and hoop wing, the AE's boxy hatch, the JZ's long sedan). Use MeshPhysicalMaterial clearcoat paint, carbon fiber, chrome and rubber materials.

## 10. World: seasons, time of day, weather, life

- **Four seasons** that rotate every in-game week (or can be chosen in settings), each changing the whole world:
  - **Spring:** sakura trees in bloom, falling petals that collect on the road and car, soft light, festival lanterns at the shrine.
  - **Summer:** deep green forests, heat haze over asphalt, cicada ambience, summer festival with stalls, fireworks at night in the hub.
  - **Autumn:** momiji maple forests in red and orange, falling leaves, low golden sun, morning fog on the touge.
  - **Winter:** snow on roofs, trees and road edges, snow-covered roads in mountain locations (lower grip, snow spray), icy patches at night, warm-lit buildings, breath-fog on NPCs.
- **Time of day:** a full cycle (dawn, day, golden hour, dusk, night) with a moving sun and moon, plus a choice for events. Night is a big deal for JDM vibes: streetlights, neon, car headlights (real spot lights for the player and nearby cars), taillight trails, lit vending machines.
- **Weather:** clear, cloudy, rain (wet roads with reflections and puddles, spray from tires, rain on the camera, wipers in bumper cam), fog, snowfall (winter).
- **World life:** AI traffic (kei cars, trucks, taxis, buses), parked cars, pedestrians as simple low-poly figures on sidewalks (they never get hit: they step back), trains on viaducts, birds, flags and banners moving in the wind.

## 11. Visual quality (make it NOT look like an AI demo)

- **Rendering:** ACES Filmic tone mapping, sRGB output, a physically based sky with an environment map regenerated as time of day changes (PMREM), soft shadows (cascaded or a tight frustum around the player), SSAO, bloom (headlights, neon, flames), SMAA, subtle motion blur at speed, film grain and vignette at low strength, and a color grade per season and time of day.
- **Materials:** real texture detail made in code: asphalt with aggregate, cracks, tar patches and worn lane paint; concrete with stains; guardrails with rust and dents; tire marks that build up on drift corners. Roughness changes when wet. Avoid flat single-color surfaces anywhere near the camera.
- **Scenery density:** roads should feel lived-in. Utility poles with sagging wires, road signs (original Japanese-style designs and fictional place names), mirrors on blind corners, chevron boards, drainage gutters, vending machines with glowing panels, convenience stores, shrines, vegetation that matches the season.
- **Effects:** volumetric-looking tire smoke that piles up and drifts with the wind, smoke colored by tire choice (option), sparks, backfire flames, exhaust heat haze, rain spray, snow spray, leaves and petals kicked up by the car, dust on gravel.
- **Camera:** a spring-based chase cam with weight. FOV and subtle shake rise with speed, there's an impact shake, and the camera looks into the drift. Views: far chase, close chase, hood, bumper, cockpit (a simple interior with a moving steering wheel and gauges), plus cinematic **replay** cameras (trackside, drone, orbit) for an instant replay after each event.
- **UI and art direction:**
  - A cohesive look built on Japanese street-magazine and racing-livery graphics. Strong typography (e.g. "Chakra Petch" or "Rajdhani" for numbers, "Zen Kaku Gothic New" or "M PLUS 1" for Japanese accents), katakana and kanji used as graphic elements, sticker-bomb textures, angled panels and speed lines.
  - A defined palette (deep night blue, signal red, sakura pink, sodium orange, off-white), applied consistently.
  - Banned: generic glassmorphism cards, purple-blue gradients, emoji icons, default system fonts, placeholder boxes, "Lorem ipsum".
  - The garage is a 3D scene: your car on a turntable in a tuning shop with tool walls, posters with original brand art, a fluorescent tube flicker and a cat sleeping on a tire stack. Menus slide in with snappy motion and sound.
  - HUD: an animated tachometer with shift lights, a gear indicator, speed, turbo boost gauge, a mini-map, skill chain counter with multiplier tier colors, a banking ring, an event timer and delta. Score popups pop and fly like Forza Horizon's, but in our own style.
- **Loading screens:** car tips, a photo-mode screenshot of the player's own car, and progress bars styled as tachometers.

## 12. Audio

- **Synthesized engines** (Web Audio) with layers per engine type: a rotary (smooth high-revving brap), I4 turbo, V6 NA, I6 twin-turbo (smooth and silky), and a kei 3-cylinder (buzzy). Layers: combustion harmonics from RPM and firing order, intake noise, exhaust resonance, a load-dependent filter, an on-throttle/off-throttle crossfade and a limiter bounce.
- Turbo spool whistle, blow-off valve, flutter, anti-lag pops, backfires, gear-shift clunk, and a different exhaust note per exhaust upgrade.
- Tire squeal that changes with slip and surface, gravel crunch, wet hiss, wind noise rising with speed, and impact sounds by material (metal guardrail, concrete, plastic cone).
- Ambience per location, season and time: cicadas, city hum, rain, a distant train, crows, temple bell, festival music in the distance.
- **Radio:** a procedurally generated original synth soundtrack with at least three "stations" (eurobeat-style high-energy, city-pop/lo-fi chill, phonk-style dark), plus support for the user dropping their own audio files into `assets/music/`.

## 13. AI

- **Racing AI** follows a precomputed racing line (spline) with speed targets from curvature, overtakes, defends, and makes small mistakes at lower skill levels.
- **Traffic AI** drives in lanes, changes lanes with indicators, brakes for obstacles, honks, and spawns and despawns around the player.
- **Tandem lead AI** runs scripted drift lines per course (angle and speed targets per section), sometimes with mistakes, so chasing feels alive.
- **Rival AI** in touge battles with personality (aggressive, smooth, unpredictable).

## 14. Quality bar and process

- **Phased build. The game must be playable after each phase.** At the end of each phase: run `npm run build` and the tests, run a Playwright script that loads the game, drives for 10 seconds with scripted inputs and saves screenshots to `screenshots/phase-N/`, look at the screenshots and fix anything that looks broken or ugly before moving on.
- Use git. Commit at the end of every phase with a clear message, and keep `CHANGELOG.md` updated.
- Keep `README.md` current: how to run (`npm install`, `npm run dev`), controls, how to add cars and tracks, where to drop assets.
- If you run out of room in one session, stop at a clean phase boundary and write `NEXT_STEPS.md` saying exactly where to continue.

### Phases

1. **Foundation:** Vite + TS project, the game loop, input (keyboard, gamepad, touch), settings, save system, and the four-wheel physics ported and improved from the prototype, on a test skidpad and the Minami Drift Park layout. One car (Sakura S15) with a detailed procedural model. Basic HUD. Physics tests pass.
2. **Scoring and the first great location:** skill chain with banking and chain-breaking, drift judging with clipping points, Akagiri Touge with full scenery and elevation, spring season, day and night. Drift zone, time attack (with ghosts) and tandem chase modes.
3. **Garage:** all performance upgrades with real physics effects, the tuning menu with previews, the performance rating and classes, paint, wheels, stance, body kits and wings, build codes. The 3D garage scene.
4. **Cars:** all 10 cars with unique silhouettes, engines, sounds and upgrade paths. Dealer and garage finds. The glTF loading path.
5. **World expansion:** Daikaku PA hub, C1 Loop Expressway with traffic and traffic-drift mode, Tsukinami Raceway with AI racing, Neon District. Free roam activities (speed traps, speed zones, danger signs).
6. **Seasons and atmosphere:** all four seasons, full time-of-day cycle, rain/fog/snow with grip effects, particles (petals, leaves, snow), ambience, the radio.
7. **Career:** event series with badges, rivals, intro story, rewards, perks, the remaining locations (Bayside Docks, Satoyama Countryside) and touge battles.
8. **Polish:** livery editor, JDM accessories, photo mode, replays with cinematic cameras, loading screens, menu animations, audio mix, performance tuning for the Low preset, mobile touch polish, and a final playthrough checklist (every event completable, no console errors, 60 fps on Medium).

Start with Phase 1 now.
