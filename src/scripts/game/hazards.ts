import { resolvePosition } from "./motion";
import type { Attractor, HazardConfig } from "./state";

export function resolveHazards(hazards: HazardConfig[], stageTime: number): Attractor[] {
  return hazards.map((hazard) => ({
    pos: resolvePosition(hazard.pos, hazard.motion, stageTime),
    strength: hazard.strength,
    radius: hazard.radius,
    influenceRadius: hazard.influenceRadius,
    kind: hazard.kind,
  }));
}

// How deep the moth is inside one hazard's influence radius: 0 (outside, or
// no influence radius at all) to 1 (right on top of it). Shared by
// render.ts (the shimmer/pulse standing in for a debug ring) and audio.ts
// (the proximity pulse) so both read exactly the same number instead of
// each re-deriving their own falloff.
export function hazardProximity(mothPos: { x: number; y: number }, hazard: Attractor): number {
  if (hazard.influenceRadius === undefined) return 0;
  const dist = Math.hypot(mothPos.x - hazard.pos.x, mothPos.y - hazard.pos.y);
  return Math.min(1, Math.max(0, (hazard.influenceRadius - dist) / hazard.influenceRadius));
}

export function maxHazardProximity(mothPos: { x: number; y: number }, hazards: Attractor[]): number {
  let max = 0;
  for (const hazard of hazards) max = Math.max(max, hazardProximity(mothPos, hazard));
  return max;
}
