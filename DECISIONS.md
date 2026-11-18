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
