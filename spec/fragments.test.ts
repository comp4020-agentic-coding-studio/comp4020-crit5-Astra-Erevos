import { describe, expect, it } from "vitest";
import { collectFragments } from "../src/scripts/game/fragments";
import type { FragmentConfig } from "../src/scripts/game/state";

describe("collectFragments", () => {
  const fragments: FragmentConfig[] = [
    { pos: { x: 0, y: 0 }, radius: 20 },
    { pos: { x: 500, y: 500 }, radius: 20 },
  ];

  it("leaves everything uncollected when the moth is far from all of them", () => {
    const result = collectFragments({ x: -900, y: -900 }, fragments, [false, false], 16);
    expect(result).toEqual([false, false]);
  });

  it("marks a fragment collected once the moth is within radius + mothRadius", () => {
    const result = collectFragments({ x: 10, y: 0 }, fragments, [false, false], 16);
    expect(result).toEqual([true, false]);
  });

  it("is boundary-inclusive, same as checkOutcome's collision rule", () => {
    const result = collectFragments({ x: 36, y: 0 }, fragments, [false, false], 16); // exactly 20+16
    expect(result[0]).toBe(true);
  });

  it("never un-collects an already-collected fragment, even far away", () => {
    const result = collectFragments({ x: -900, y: -900 }, fragments, [true, false], 16);
    expect(result).toEqual([true, false]);
  });

  it("collects independently — reaching one doesn't affect the other", () => {
    const result = collectFragments({ x: 505, y: 500 }, fragments, [false, false], 16);
    expect(result).toEqual([false, true]);
  });
});
