import type { Attractor, MothState, Vec2 } from "./state";

const MIN_DISTANCE = 24; // clamps the pull of anything the moth is right on top of
const SPEED_EASE = 4; // higher = quicker to reach target speed

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len < 1e-6 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

// The moth is pulled toward every attractor at once, each weighted by
// strength over distance — whichever is closest relative to its strength
// wins the direction. The player's light and every hazard use this same
// rule; nothing distinguishes them except position and strength.
function desiredDirection(mothPos: Vec2, attractors: Attractor[]): Vec2 | null {
  let sum: Vec2 = { x: 0, y: 0 };
  for (const attractor of attractors) {
    const toAttractor = subtract(attractor.pos, mothPos);
    const distance = Math.max(length(toAttractor), MIN_DISTANCE);
    const weight = attractor.strength / distance;
    const direction = normalize(toAttractor);
    sum = { x: sum.x + direction.x * weight, y: sum.y + direction.y * weight };
  }
  return length(sum) < 1e-6 ? null : normalize(sum);
}

function headingAngle(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

function angleToVec(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// Wraps a - b into (-PI, PI], so turning always takes the short way round.
function angleDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

export function stepMoth(
  moth: MothState,
  attractors: Attractor[],
  followSpeed: number,
  maxTurnRate: number,
  dt: number,
): MothState {
  const desired = desiredDirection(moth.pos, attractors);
  const currentAngle = headingAngle(moth.heading);
  const targetAngle = desired ? headingAngle(desired) : currentAngle;
  const maxStep = maxTurnRate * dt;
  const delta = angleDelta(targetAngle, currentAngle);
  const clampedDelta = Math.max(-maxStep, Math.min(maxStep, delta));
  const heading = angleToVec(currentAngle + clampedDelta);

  const targetSpeed = desired ? followSpeed : 0;
  const speed = moth.speed + (targetSpeed - moth.speed) * Math.min(1, dt * SPEED_EASE);

  const pos = {
    x: moth.pos.x + heading.x * speed * dt,
    y: moth.pos.y + heading.y * speed * dt,
  };

  return { pos, heading, speed };
}
