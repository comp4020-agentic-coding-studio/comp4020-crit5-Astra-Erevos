import { describe, expect, it } from "vitest";
import { checkOutcome } from "../src/scripts/game/outcome";
import type { Attractor, Flower } from "../src/scripts/game/state";

// checkOutcome is the one rule that ends the game: pure geometry over plain
// numbers, no time, no rendering, no input. These pin down its edges —
// boundary-inclusive radii, and loss taking precedence over a simultaneous
// win — so the rule can't quietly drift as the rest of the game changes
// around it.
const MOTH_RADIUS = 10;

function flower(overrides: Partial<Flower> = {}): Flower {
  return {
    pos: { x: 500, y: 500 },
    radius: 40,
    isGoal: false,
    bloomed: false,
    ...overrides,
  };
}

function hazard(overrides: Partial<Attractor> = {}): Attractor {
  return { pos: { x: 100, y: 100 }, strength: 1, radius: 40, ...overrides };
}

describe("checkOutcome", () => {
  it("is playing when the moth is far from everything", () => {
    const outcome = checkOutcome({ x: 0, y: 0 }, [hazard()], flower(), MOTH_RADIUS);
    expect(outcome).toBe("playing");
  });

  it("wins when the moth reaches the flower", () => {
    const target = flower({ pos: { x: 500, y: 500 } });
    const outcome = checkOutcome({ x: 500, y: 500 }, [], target, MOTH_RADIUS);
    expect(outcome).toBe("won");
  });

  it("treats the flower boundary as inclusive", () => {
    const target = flower({ pos: { x: 0, y: 0 }, radius: 40 });
    // exactly radius + mothRadius away
    const outcome = checkOutcome({ x: 50, y: 0 }, [], target, MOTH_RADIUS);
    expect(outcome).toBe("won");
  });

  it("is still playing just outside the flower boundary", () => {
    const target = flower({ pos: { x: 0, y: 0 }, radius: 40 });
    const outcome = checkOutcome({ x: 50.01, y: 0 }, [], target, MOTH_RADIUS);
    expect(outcome).toBe("playing");
  });

  it("loses when the moth touches a hazard", () => {
    const danger = hazard({ pos: { x: 200, y: 200 }, radius: 30 });
    const outcome = checkOutcome({ x: 200, y: 200 }, [danger], flower(), MOTH_RADIUS);
    expect(outcome).toBe("lost");
  });

  it("treats the hazard boundary as inclusive", () => {
    const danger = hazard({ pos: { x: 0, y: 0 }, radius: 30 });
    // exactly radius + mothRadius away
    const outcome = checkOutcome({ x: 40, y: 0 }, [danger], flower(), MOTH_RADIUS);
    expect(outcome).toBe("lost");
  });

  it("is still playing just outside the hazard boundary", () => {
    const danger = hazard({ pos: { x: 0, y: 0 }, radius: 30 });
    const outcome = checkOutcome({ x: 40.01, y: 0 }, [danger], flower(), MOTH_RADIUS);
    expect(outcome).toBe("playing");
  });

  it("prefers loss when the moth is inside both a hazard and the flower", () => {
    const samePos = { x: 500, y: 500 };
    const danger = hazard({ pos: samePos, radius: 30 });
    const target = flower({ pos: samePos, radius: 30 });
    const outcome = checkOutcome(samePos, [danger], target, MOTH_RADIUS);
    expect(outcome).toBe("lost");
  });

  it("checks every hazard, not just the first", () => {
    const near = hazard({ pos: { x: 0, y: 0 }, radius: 30 });
    const far = hazard({ pos: { x: 900, y: 900 }, radius: 30 });
    const outcome = checkOutcome({ x: 900, y: 900 }, [near, far], flower(), MOTH_RADIUS);
    expect(outcome).toBe("lost");
  });

  it("is playing with no hazards at all", () => {
    const outcome = checkOutcome({ x: 10, y: 10 }, [], flower({ pos: { x: 999, y: 999 } }), MOTH_RADIUS);
    expect(outcome).toBe("playing");
  });
});
