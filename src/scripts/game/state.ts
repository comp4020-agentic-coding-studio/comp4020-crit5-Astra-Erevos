export type Vec2 = { x: number; y: number };
export type Phase = "intro" | "playing" | "won" | "lost";

// The light and every hazard pull the moth by the same rule (see moth.ts) —
// only their position and strength differ, and the moth can't tell them apart.
export type Attractor = { pos: Vec2; strength: number; radius: number };

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
    hazards: [{ pos: { x: 520, y: 380 }, strength: 1, radius: 40 }],
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
