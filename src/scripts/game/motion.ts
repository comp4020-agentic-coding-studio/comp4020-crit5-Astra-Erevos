import type { DriftMotion, Vec2 } from "./state";

// Resolves any anchor + optional drift motion to its live position at a
// given elapsed stage time — a pure function of that one input, so a stage
// reset (stageTime back to 0) is the entire reset for anything built on
// this, whether a hazard (hazards.ts) or, from Stage 5, a slowly-drifting
// flower.
export function resolvePosition(anchor: Vec2, motion: DriftMotion | undefined, stageTime: number): Vec2 {
  if (!motion) return anchor;
  const { amplitude, angularSpeed, phase = 0 } = motion;
  const t = stageTime * angularSpeed + phase;
  return { x: anchor.x + amplitude.x * Math.cos(t), y: anchor.y + amplitude.y * Math.sin(t) };
}
