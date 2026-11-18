import { Profile, type BodyShape } from './profile';

// Hand-tuned body profiles. Coordinates: z forward from the CG station, y up from the ground,
// half widths in metres. Wheel centres must match the physics spec (cgToFront / cgToRear).

/** Sakura S15: low, smooth wedge coupe, long hood, swept headlights, short rear deck with a lip spoiler. */
export function s15Shape(cgToFront: number, cgToRear: number, wheelRadius: number): BodyShape {
  const zf = cgToFront + 0.88;
  const zr = -cgToRear - 0.965;
  return {
    zRear: zr,
    zFront: zf,
    top: new Profile([
      [zr, 0.5], [zr + 0.02, 0.7], [zr + 0.06, 0.84], [zr + 0.18, 0.925], [zr + 0.5, 0.955], [-1.32, 0.945],
      [-0.9, 0.925], [0.0, 0.895], [0.58, 0.858],
      [0.9, 0.82], [1.4, 0.772], [1.8, 0.715], [zf - 0.12, 0.645], [zf - 0.04, 0.56], [zf - 0.008, 0.45], [zf, 0.3],
    ]),
    bottom: new Profile([
      [zr, 0.34], [zr + 0.12, 0.25], [zr + 0.4, 0.2], [-1.8, 0.185], [1.85, 0.165], [zf - 0.1, 0.15], [zf, 0.2],
    ]),
    halfWidth: new Profile([
      [zr, 0.66], [zr + 0.06, 0.765], [zr + 0.3, 0.83], [-1.35, 0.848], [-0.5, 0.836], [0.4, 0.83], [1.25, 0.846],
      [1.75, 0.82], [zf - 0.2, 0.765], [zf - 0.05, 0.69], [zf, 0.58],
    ]),
    shoulder: new Profile([[zr, 0.55], [-1.5, 0.62], [0.6, 0.62], [1.6, 0.66], [zf, 0.6]]),
    upperExp: new Profile([[zr, 2.6], [-1.6, 3.0], [-1.25, 6.0], [0.55, 6.0], [0.95, 3.0], [zf, 2.4]]),
    lowerExp: 4.5,
    wheels: [
      { z: cgToFront, y: wheelRadius, arch: wheelRadius + 0.06 },
      { z: -cgToRear, y: wheelRadius, arch: wheelRadius + 0.06 },
    ],
    greenhouse: {
      zRear: -1.34,
      zFront: 0.6,
      roof: new Profile([
        [-1.34, 0.94], [-1.1, 1.07], [-0.85, 1.19], [-0.6, 1.262], [-0.3, 1.285], [-0.05, 1.28], [0.12, 1.235],
        [0.3, 1.1], [0.46, 0.97], [0.6, 0.85],
      ]),
      roofHalfWidth: 0.6,
      beltInset: 0.055,
      windshieldZ: 0.06,
      rearWindowZ: -0.66,
      quarterZ: -0.86,
      bPillar: [-0.6, -0.53],
    },
  };
}
