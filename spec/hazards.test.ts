import { describe, expect, it } from "vitest";
import { resolveHazards } from "../src/scripts/game/hazards";
import type { HazardConfig } from "../src/scripts/game/state";

// A moving hazard's position is a pure function of stageTime alone (no
// stored velocity or path progress) -- these pin that contract down so a
// stage reset can rely on "stageTime back to 0" being the entire reset.
describe("resolveHazards", () => {
  it("returns a static hazard's own pos unchanged, regardless of stageTime", () => {
    const hazard: HazardConfig = { pos: { x: 40, y: -20 }, strength: 1, radius: 10 };
    const early = resolveHazards([hazard], 0)[0];
    const later = resolveHazards([hazard], 500)[0];
    expect(early.pos).toEqual({ x: 40, y: -20 });
    expect(later.pos).toEqual({ x: 40, y: -20 });
  });

  it("starts a moving hazard offset along +x from its anchor at stageTime 0 with no phase", () => {
    const hazard: HazardConfig = {
      pos: { x: 100, y: 100 },
      strength: 1,
      radius: 10,
      motion: { amplitude: { x: 50, y: 30 }, angularSpeed: 1 },
    };
    const resolved = resolveHazards([hazard], 0)[0];
    expect(resolved.pos.x).toBeCloseTo(150);
    expect(resolved.pos.y).toBeCloseTo(100);
  });

  it("gives the same position for the same stageTime, every time (no hidden state)", () => {
    const hazard: HazardConfig = {
      pos: { x: 0, y: 0 },
      strength: 1,
      radius: 10,
      motion: { amplitude: { x: 80, y: 80 }, angularSpeed: 0.6, phase: 1.2 },
    };
    const a = resolveHazards([hazard], 3.7)[0];
    resolveHazards([hazard], 999)[0]; // interleave an unrelated call
    const b = resolveHazards([hazard], 3.7)[0];
    expect(b.pos).toEqual(a.pos);
  });

  it("resolves each hazard independently, preserving strength/radius/influenceRadius", () => {
    const hazards: HazardConfig[] = [
      { pos: { x: 0, y: 0 }, strength: 2, radius: 15, influenceRadius: 90 },
      {
        pos: { x: 200, y: 0 },
        strength: 1,
        radius: 20,
        motion: { amplitude: { x: 10, y: 10 }, angularSpeed: 0.5 },
      },
    ];
    const resolved = resolveHazards(hazards, 10);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ strength: 2, radius: 15, influenceRadius: 90 });
    expect(resolved[1]).toMatchObject({ strength: 1, radius: 20 });
  });
});
