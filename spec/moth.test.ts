import { describe, expect, it } from "vitest";
import { stepMoth } from "../src/scripts/game/moth";
import type { Attractor, MothState } from "../src/scripts/game/state";

// The moth used to fly at a fixed followSpeed right up to the light and,
// because its turn rate is clamped, had a fixed minimum turning radius it
// could never shrink below near a point target -- so it endlessly orbited
// instead of arriving. These pin down the fix: speed must fall as the moth
// nears the light, and repeated stepping must actually converge and hold,
// not just slow down and still circle forever.
const FOLLOW_SPEED = 340;
const MAX_TURN_RATE = 2.6;
const DT = 1 / 60;

function moth(overrides: Partial<MothState> = {}): MothState {
  return { pos: { x: 0, y: 0 }, heading: { x: 1, y: 0 }, speed: FOLLOW_SPEED, ...overrides };
}

describe("stepMoth arrival behaviour", () => {
  it("targets full speed while far from the light", () => {
    const start = moth({ pos: { x: 0, y: 0 }, heading: { x: 0, y: 1 } });
    const result = stepMoth(start, { x: 400, y: 0 }, [], FOLLOW_SPEED, MAX_TURN_RATE, DT);
    // already at followSpeed and still far off, so speed shouldn't have eased downward
    expect(result.speed).toBeGreaterThanOrEqual(start.speed - 1e-6);
  });

  it("caps speed much lower once close to the light than while far away, given the same incoming speed", () => {
    const far = stepMoth(
      moth({ pos: { x: 0, y: 0 }, speed: FOLLOW_SPEED, heading: { x: 1, y: 0 } }),
      { x: 400, y: 0 },
      [],
      FOLLOW_SPEED,
      MAX_TURN_RATE,
      DT,
    );
    const near = stepMoth(
      moth({ pos: { x: 0, y: 0 }, speed: FOLLOW_SPEED, heading: { x: 1, y: 0 } }),
      { x: 20, y: 0 },
      [],
      FOLLOW_SPEED,
      MAX_TURN_RATE,
      DT,
    );
    expect(near.speed).toBeLessThan(far.speed);
  });

  it("slows toward a stop as it reaches the light, rather than sailing past at full speed", () => {
    let state = moth({ pos: { x: 0, y: 0 }, heading: { x: 0, y: 1 }, speed: FOLLOW_SPEED });
    const light = { x: 5, y: 0 }; // already essentially on top of the light
    for (let i = 0; i < 30; i++) {
      state = stepMoth(state, light, [], FOLLOW_SPEED, MAX_TURN_RATE, DT);
    }
    expect(state.speed).toBeLessThan(FOLLOW_SPEED * 0.2);
  });

  it("converges on a stationary light and stays converged, instead of orbiting forever", () => {
    let state = moth({ pos: { x: -300, y: 200 }, heading: { x: 1, y: 0 }, speed: 0 });
    const light = { x: 0, y: 0 };
    let settledFrame = -1;
    for (let i = 0; i < 600; i++) {
      // 10s at 60fps
      state = stepMoth(state, light, [], FOLLOW_SPEED, MAX_TURN_RATE, DT);
      const dist = Math.hypot(state.pos.x - light.x, state.pos.y - light.y);
      if (settledFrame === -1 && dist < 15) settledFrame = i;
    }
    expect(settledFrame).toBeGreaterThan(-1);
    // Once settled it must hold, not swing back out into another orbit --
    // replay the remaining frames from that point and check it stays close.
    let holdState = moth({ pos: { x: -300, y: 200 }, heading: { x: 1, y: 0 }, speed: 0 });
    let maxDistAfterSettling = 0;
    for (let i = 0; i < 600; i++) {
      holdState = stepMoth(holdState, light, [], FOLLOW_SPEED, MAX_TURN_RATE, DT);
      const dist = Math.hypot(holdState.pos.x - light.x, holdState.pos.y - light.y);
      if (i >= settledFrame) maxDistAfterSettling = Math.max(maxDistAfterSettling, dist);
    }
    expect(maxDistAfterSettling).toBeLessThan(15);
  });

  it("still lets a nearby hazard bias direction without blocking arrival at the light", () => {
    const hazard: Attractor = { pos: { x: 30, y: 0 }, strength: 1, radius: 20, influenceRadius: 80 };
    let state = moth({ pos: { x: -300, y: 0 }, heading: { x: 1, y: 0 }, speed: 0 });
    const light = { x: 0, y: 0 };
    for (let i = 0; i < 600; i++) {
      state = stepMoth(state, light, [hazard], FOLLOW_SPEED, MAX_TURN_RATE, DT);
    }
    const dist = Math.hypot(state.pos.x - light.x, state.pos.y - light.y);
    expect(dist).toBeLessThan(15);
  });

  it("re-accelerates smoothly when the light moves away after arrival", () => {
    let state = moth({ pos: { x: 0, y: 0 }, heading: { x: 1, y: 0 }, speed: 0 });
    for (let i = 0; i < 60; i++) {
      state = stepMoth(state, { x: 0, y: 0 }, [], FOLLOW_SPEED, MAX_TURN_RATE, DT);
    }
    expect(state.speed).toBeLessThan(FOLLOW_SPEED * 0.1);
    const afterMove = stepMoth(state, { x: 500, y: 0 }, [], FOLLOW_SPEED, MAX_TURN_RATE, DT);
    expect(afterMove.speed).toBeGreaterThan(state.speed);
  });
});
