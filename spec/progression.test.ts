import { describe, expect, it } from "vitest";
import { collectFragments } from "../src/scripts/game/fragments";
import { resolveHazards } from "../src/scripts/game/hazards";
import { resolvePosition } from "../src/scripts/game/motion";
import { stepMoth } from "../src/scripts/game/moth";
import { checkOutcome, type Outcome } from "../src/scripts/game/outcome";
import { FLOWER_VISUAL_OVERSHOOT, MOTH_RADIUS, STAGES, type MothState, type Vec2 } from "../src/scripts/game/state";

// This is the permanent sensor for the game's central difficulty invariant:
// from The Marsh onward, parking the light on the flower and never moving it
// again must not reliably win. The engine is fully deterministic (no RNG
// anywhere), so this is provable by simulation rather than left to feel —
// exactly the same technique used to tune hazard drift by hand, pinned down
// here so a future stage edit can't quietly undo it.
const DT = 1 / 60;

function simulateStage(stageIndex: number, lightAt: (stageTime: number) => Vec2, seconds: number): Outcome {
  const stage = STAGES[stageIndex];
  let moth: MothState = { pos: { ...stage.mothStart }, heading: { x: 1, y: 0 }, speed: 0 };
  let collected = stage.fragments.map(() => false);
  let stageTime = 0;
  const steps = Math.round(seconds / DT);

  for (let i = 0; i < steps; i++) {
    stageTime += DT;
    const hazards = resolveHazards(stage.hazards, stageTime);
    const light = lightAt(stageTime);
    moth = stepMoth(moth, light, hazards, stage.followSpeed, stage.maxTurnRate, DT);
    collected = collectFragments(moth.pos, stage.fragments, collected, MOTH_RADIUS);

    const flowerPos = resolvePosition(stage.flower.pos, stage.flower.motion, stageTime);
    const visualFlower = { ...stage.flower, pos: flowerPos, radius: stage.flower.radius * FLOWER_VISUAL_OVERSHOOT };
    const outcome = checkOutcome(moth.pos, hazards, visualFlower, MOTH_RADIUS);
    if (outcome === "lost") return "lost";
    if (outcome === "won" && collected.every(Boolean)) return "won";
  }
  return "playing";
}

// The naive strategy: place the light on the flower's own anchor once, at
// the very start, and never touch it again.
function naiveLight(stageIndex: number): (stageTime: number) => Vec2 {
  const anchor = STAGES[stageIndex].flower.pos;
  return () => anchor;
}

// A scripted route: hold the light at each waypoint in turn for a fixed
// duration, long enough for the moth to actually arrive there.
function routedLight(waypoints: { pos: Vec2; hold: number }[]): (stageTime: number) => Vec2 {
  const bounds = waypoints.reduce<number[]>((acc, wp) => [...acc, (acc.at(-1) ?? 0) + wp.hold], []);
  return (stageTime: number) => {
    const i = bounds.findIndex((b) => stageTime < b);
    return waypoints[i === -1 ? waypoints.length - 1 : i].pos;
  };
}

describe("naive light-on-flower can no longer win, from The Marsh onward", () => {
  it("The Garden (Stage 1): naive play still wins — this is the tutorial stage", () => {
    expect(simulateStage(0, naiveLight(0), 15)).toBe("won");
  });

  it("The Marsh (Stage 3): naive play gets caught by the wisp guarding the direct line", () => {
    expect(simulateStage(2, naiveLight(2), 20)).toBe("lost");
  });

  it("The Ruins (Stage 4): naive play never wins — the flower stays gated on fragments", () => {
    expect(simulateStage(3, naiveLight(3), 25)).not.toBe("won");
  });

  it("The Moon Flower (Stage 5): naive play never wins — gated on fragments and unsafe besides", () => {
    expect(simulateStage(4, naiveLight(4), 25)).not.toBe("won");
  });
});

describe("every stage is still winnable by some route", () => {
  it("The Garden", () => {
    expect(simulateStage(0, naiveLight(0), 15)).toBe("won");
  });

  it("The Lanterns", () => {
    expect(simulateStage(1, naiveLight(1), 15)).toBe("won");
  });

  it("The Marsh: a route that swings around the wisp reaches the flower", () => {
    const route = routedLight([
      { pos: { x: 500, y: 150 }, hold: 3 },
      { pos: { x: 850, y: 520 }, hold: 17 },
    ]);
    expect(simulateStage(2, route, 20)).toBe("won");
  });

  it("The Ruins: visiting all three fragments before the flower wins", () => {
    // The direct hop between the second and third fragments cuts straight
    // through the second wisp's territory — the wide swing east first is
    // the "actually route around it" detour this stage is designed to teach.
    const route = routedLight([
      { pos: { x: 330, y: 220 }, hold: 4 },
      { pos: { x: 500, y: 780 }, hold: 4 },
      { pos: { x: 850, y: 850 }, hold: 2 },
      { pos: { x: 730, y: 260 }, hold: 4 },
      { pos: { x: 850, y: 500 }, hold: 15 },
    ]);
    expect(simulateStage(3, route, 31)).toBe("won");
  });

  it("The Moon Flower: collecting the fragments and then pursuing the flower wins", () => {
    // The central wisp sits between the first two fragments, so the route
    // swings south around it; the third fragment sits deep in the second
    // wisp's territory, so the light steps it out to a clear corner before
    // making the final run at the (drifting) flower.
    const route = routedLight([
      { pos: { x: 300, y: 620 }, hold: 4 },
      { pos: { x: 300, y: 780 }, hold: 1 },
      { pos: { x: 850, y: 780 }, hold: 1.5 },
      { pos: { x: 850, y: 150 }, hold: 1.5 },
      { pos: { x: 620, y: 150 }, hold: 1 },
      { pos: { x: 620, y: 300 }, hold: 3 },
      { pos: { x: 850, y: 300 }, hold: 1 },
      { pos: { x: 850, y: 700 }, hold: 1 },
      { pos: { x: 780, y: 700 }, hold: 3 },
      { pos: { x: 850, y: 850 }, hold: 1 },
      { pos: { x: 850, y: 150 }, hold: 20 },
    ]);
    expect(simulateStage(4, route, 40)).toBe("won");
  });
});
