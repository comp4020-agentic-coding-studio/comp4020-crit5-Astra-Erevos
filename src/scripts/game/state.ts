export type Vec2 = { x: number; y: number };
export type Phase = "intro" | "playing" | "won" | "lost";

// The light and every hazard pull the moth by the same rule (see moth.ts) —
// only their position and strength differ, and the moth can't tell them
// apart. `influenceRadius`, when set, confines the pull to a local zone
// around the attractor (ramping up from a faint tug at its edge to full
// strength at `radius`) instead of reaching across the whole stage — used by
// hazards so the player's light stays the dominant, always-on pull and a
// hazard only competes with it once the moth is already close.
export type Attractor = { pos: Vec2; strength: number; radius: number; influenceRadius?: number };

export type Flower = {
  pos: Vec2;
  radius: number;
  isGoal: boolean;
  bloomed: boolean;
};

export type StageConfig = {
  name: string;
  mothStart: Vec2;
  flower: Flower;
  hazards: Attractor[];
  followSpeed: number;
  maxTurnRate: number;
};

export type MothState = { pos: Vec2; heading: Vec2; speed: number };

export type GameState = {
  phase: Phase;
  stageIndex: number;
  light: Vec2 | null; // null until the player's first pointer input
  moth: MothState;
};

// A fixed square the game plays out in. main.ts fits this to whatever
// viewport it's shown in (letterboxed against the same background color, so
// the letterbox is invisible), which keeps every stage's layout identical at
// 1920x1080 and 390x844 alike.
export const WORLD = { width: 1000, height: 1000 };

export const MOTH_RADIUS = 16;
export const LIGHT_STRENGTH = 1;

// render.ts draws a flower's petals reaching roughly 1.22x its logical
// radius, and the moth's wings reaching roughly 1.75x MOTH_RADIUS -- so the
// two visually touch at about 1.22*radius + 1.75*MOTH_RADIUS, well past the
// raw radius + MOTH_RADIUS that checkOutcome used to test. This widens only
// the flower side of that gap (applied at the checkOutcome call site in
// main.ts) so a player who visibly reaches the flower wins, without touching
// MOTH_RADIUS itself -- which also sets hazard danger geometry and must stay
// exactly as tuned there.
export const FLOWER_VISUAL_OVERSHOOT = 1.5;

export const STAGES: StageConfig[] = [
  {
    name: "First Light",
    mothStart: { x: 220, y: 500 },
    flower: { pos: { x: 800, y: 500 }, radius: 42, isGoal: false, bloomed: false },
    hazards: [],
    followSpeed: 340,
    maxTurnRate: 2.6,
  },
  {
    name: "Cold Glimmer",
    mothStart: { x: 160, y: 560 },
    flower: { pos: { x: 860, y: 460 }, radius: 42, isGoal: true, bloomed: false },
    // Sits well clear of the direct start-to-flower line (~210 units) and
    // only pulls within influenceRadius, so flying straight for the flower
    // never brushes it — reaching it at all is a deliberate detour, and a
    // player who notices the tug and steers back out within roughly its
    // radius can still recover the moth.
    hazards: [{ pos: { x: 500, y: 300 }, strength: 1, radius: 40, influenceRadius: 170 }],
    followSpeed: 340,
    maxTurnRate: 2.6,
  },
];

export function createInitialState(): GameState {
  const first = STAGES[0];
  return {
    phase: "intro",
    stageIndex: 0,
    light: null,
    moth: { pos: { ...first.mothStart }, heading: { x: 1, y: 0 }, speed: 0 },
  };
}
