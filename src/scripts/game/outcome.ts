import type { Attractor, Flower, Vec2 } from "./state";

export type Outcome = "playing" | "won" | "lost";

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The one rule that ends the game: pure geometry, no time, no rendering, no
// input, so it holds regardless of how any of those get built or rebuilt.
// Loss takes precedence — a moth touching both a hazard and the flower on
// the same frame has already made the wrong move.
export function checkOutcome(
  mothPos: Vec2,
  hazards: Attractor[],
  flower: Flower,
  mothRadius: number,
): Outcome {
  for (const hazard of hazards) {
    if (distance(mothPos, hazard.pos) <= hazard.radius + mothRadius) {
      return "lost";
    }
  }
  if (distance(mothPos, flower.pos) <= flower.radius + mothRadius) {
    return "won";
  }
  return "playing";
}
