import type { Attractor, HazardConfig, Vec2 } from "./state";

// A moving hazard traces a fixed ellipse around its configured anchor, purely
// as a function of elapsed stage time -- no velocity or path-progress stored
// anywhere. That determinism is what makes stage resets free: restarting
// stage time at 0 already puts every hazard back at the same point in its
// cycle, with nothing extra to reset by hand.
function hazardPositionAt(hazard: HazardConfig, stageTime: number): Vec2 {
  if (!hazard.motion) return hazard.pos;
  const { amplitude, angularSpeed, phase = 0 } = hazard.motion;
  const t = stageTime * angularSpeed + phase;
  return { x: hazard.pos.x + amplitude.x * Math.cos(t), y: hazard.pos.y + amplitude.y * Math.sin(t) };
}

export function resolveHazards(hazards: HazardConfig[], stageTime: number): Attractor[] {
  return hazards.map((hazard) => ({
    pos: hazardPositionAt(hazard, stageTime),
    strength: hazard.strength,
    radius: hazard.radius,
    influenceRadius: hazard.influenceRadius,
  }));
}
