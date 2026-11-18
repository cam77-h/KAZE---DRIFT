# Next steps

To continue in a new session, say: **"Read KAZE_DRIFT_UPDATE_4.mr, DECISIONS.md and NEXT_STEPS.md and continue."**

## Where the build stands

Work is on branch **`update-4`** (pushed). `KAZE_DRIFT_UPDATE_4.mr` overrides the earlier docs (`KAZE_DRIFT_SPEC.md`, `KAZE_DRIFT_UPDATE_2.md`; there is no `KAZE_DRIFT_UPDATE_3.md`). Update 4 replaces Update 2's unfinished garage step.

| Step | Update 4 section | Status |
|---|---|---|
| 1 | §1 Faster acceleration and the feel of speed | **Done.** Commit `ee90f5d`. `tests/accel.test.ts`; 20 s capture in `screenshots/update-4/accel-*.png` |
| 2 | §2 Showroom car select | **Done.** `src/render/showroom.ts`, `src/ui/showroomUi.ts`; Car Select, Dealer and My Cars |
| 3 | §3 Upgrade shop (FH6 structure) | **Done.** `src/garage/{parts,rating,build,balance}.ts`, `src/ui/upgradeShop.ts`; `tests/parts.test.ts` |
| 4 | §4 Visible installs and the engine bay | **Next: not started** (plan below) |
| 5 | §5 Akagiri Touge | Not started |
| 6 | §6 Multiplayer (Supabase) | Not started |
| 7 | §7 Final verification | Not started |

Checks:
- `npm test`: 74 vitest tests pass. They cover the acceleration targets (stock and fully upgraded), every part changing the physics, tuning locks, rating and class.
- `node tests/smoke/update4_accel.cjs`: staged launch, then 20 s flat out, run on game time.
- `node tests/smoke/update4_showroom.cjs`: dealer → paint preview → buy → My Cars → upgrades (hover, confirm, conversion warning, tuning, quick upgrade, presets) → car select → drive → portrait view.

Both scripts need `npx vite --port 5199` running.

**Software GL is slow.** One game second takes about 1.5 minutes under SwiftShader, so run the captures in the background. Never edit files the page imports while a capture runs: Vite's hot reload kills the page. For long runs, snapshot the tree and serve it on another port; the accel capture accepts the URL as its first argument.

## How the new systems fit together

- **`applyBuild(baseSpec, parts, tune)`** in `src/garage/parts.ts` is the single source of truth. The car on the road (`Game.ensureCar`), the showroom, the rating, the stat bars, the shop previews and the acceleration tests all use it.
- **`rate(spec)`** (`src/garage/rating.ts`) is analytic and instant: rating 100–999, class D…R, six 0–10 bars.
- **`measure(spec)`** (`src/physics/performance.ts`) runs the physics for the honest 0–100 and top speed, cached by spec.
- **Saves:** `OwnedCar.parts` is slot → option id; `OwnedCar.inventory` lists bought parts (reinstalling them is free); `OwnedCar.presets` holds saved builds. Build codes are `KZ1-…` (`src/garage/build.ts`).

## Known gaps to close first (small)

1. **Engine sound per swap:** `CarAudio.start(cylinders)` only looks at the cylinder count. Give it a profile for `rotary`, `v8` and `moto` (13,000 rpm). Swaps already set `engine.sound`.
2. **Paint & Livery tile** in the shop shows a toast. Section 4.5 builds the real paint screen (body, wheels, calipers, window banner, plates).

## Step 4: visible installs and the engine bay (§4). Do this next.

Build in this order, committing after each part:

1. **The garage scene:** a second `Showroom`-like scene, `src/render/garage.ts`.
   - Shop set-up: a two-post lift (posts, arms, hydraulic raise), tool walls, tire racks, fluorescent tubes, posters for the fictional brands, and the shop cat (a low-poly loaf on a tire stack).
   - The upgrade shop renders over this scene instead of the showroom: `Game` callbacks `upgrades`, `preview` and `install` in `src/game.ts`.
2. **Camera presets with smooth 0.6 s ease-in-out flights:** Engine Bay, Underside (the lift raises the car), Wheel (FL), Rear, Front, Interior, Full.
   - Map each slot to a preset; add a `camera` field to `SlotDef`.
   - Opening a slot flies the camera there.
3. **The hood:** split the hood from the body. For GLB cars, use the hood material/node where the model has one; otherwise hinge a procedural panel over the bay opening, sized from the bounding box. Add the hinge animation.
4. **The procedural engine bay**, `src/vehicles/engineBay.ts`, sized from the car's length, width and front-axle position:
   - Blocks: I4, I6 (long), V6, V8, rotary, moto. Each has an embossed cam cover, coil packs, belts and pulleys.
   - Parts per tier: intake, manifold, turbo(s) with a BOV, supercharger, front-mount intercooler and piping, headers, fuel rail, coils, radiator, oil cooler and catch can, strut brace.
   - Idle shake and fan spin; a "Rev" button drives `CarAudio`.
5. **Underside and corners:**
   - The exhaust route and tips (single, dual, quad, side exit, takeyari), the gearbox, driveshaft and diff (finned cover on Race).
   - Coilovers in the wells (coloured by tier), ride height from `suspension.cgHeight`.
   - Brakes (rotor size, 4→6-piston calipers, drilled rotors), tire width and sidewall lettering.
   - Interior: rear seats out on Sport, bare floor on Race, roll cage, hydro handbrake, sequential shifter.
   - Angle-kit sweep with a readout.
   - Aero meshes: wings (ducktail, low GT, high GT, swan-neck, adjustable), splitter, skirts, diffuser, canards, flares, hood variants.
6. **X-ray toggle:** body materials go to about 0.15 opacity with depthWrite off.
7. **The install animation**, about 2 s and skippable, as a timeline:
   1. The camera flies to the slot's preset.
   2. The old part glows red, bolts spin (particles) to a clank, and the part lifts away.
   3. The new part slides in, lands with a thunk, flashes green, and gives sparks (metal) or a pssht (hoses).
   4. The bars and rating roll; a class change gets a sting.
   5. For engine and exhaust parts, an auto-rev.
   "Install All" for Quick Upgrade plays 0.4 s per part. The hook is `UpgradeCallbacks.install(o, slot)`, already awaited by the shop.
8. **Screenshots** before and after install of every slot in `screenshots/update-4/parts/`. Write `tests/smoke/update4_parts.cjs` looping over `SLOTS`, and look at them all.

## Step 5: Akagiri Touge (§5)

- Generate the track like `tests/tools/gen_openroad.py`: a 6–8 km open road, about 450 m of elevation, 35+ corners and 10+ hairpins.
- Landmarks per the doc.
- Four seasons as scenery/lighting variants.
- Events:
  - downhill and uphill time attack
  - a touge battle (a lead/chase AI using the tandem lead-car code in `src/modes/driftEvent.ts`)
  - drift zones and tandem
- Connect it to the Open Road with a junction, or a menu location if the junction is too costly.

## Step 6: Multiplayer (§6)

- A `NetTransport` interface with a Supabase Realtime implementation (`@supabase/supabase-js`). Config lives in `src/config/multiplayer.ts`; with no config, the game stays fully offline and the online menu says how to enable it.
- Rooms of up to 6 players.
- Netcode: an 8 Hz quantized state, 150 ms interpolation buffer.
- Write `MULTIPLAYER_SETUP.md` (step by step for the owner).
- The optional `scores` table: write its SQL and RLS policies.

## Step 7: Final verification (§7)

- One Playwright end-to-end run over everything.
- Screenshots in `screenshots/update-4/`.
- Update the README, CHANGELOG and this file.
