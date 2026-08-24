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

// A hazard's `pos` is its fixed anchor. `motion`, when present, drifts it on a
// slow closed ellipse around that anchor -- amplitude per axis, angularSpeed
// in radians/sec, phase to offset where in the cycle it starts -- so its
// actual position each frame is a pure function of elapsed stage time (see
// hazards.ts) with nothing to reset by hand when a stage restarts: starting
// stage time back at 0 already puts every hazard back at the same point in
// its cycle.
export type HazardMotion = { amplitude: Vec2; angularSpeed: number; phase?: number };
export type HazardConfig = {
  pos: Vec2;
  strength: number;
  radius: number;
  influenceRadius?: number;
  motion?: HazardMotion;
};

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
  hazards: HazardConfig[];
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
    flower: { pos: { x: 860, y: 460 }, radius: 42, isGoal: false, bloomed: false },
    // Sits well clear of the direct start-to-flower line (~210 units) and
    // only pulls within influenceRadius, so flying straight for the flower
    // never brushes it — reaching it at all is a deliberate detour, and a
    // player who notices the tug and steers back out within roughly its
    // radius can still recover the moth.
    hazards: [{ pos: { x: 500, y: 300 }, strength: 1, radius: 40, influenceRadius: 170 }],
    followSpeed: 340,
    maxTurnRate: 2.6,
  },
  {
    name: "Drifting Chill",
    mothStart: { x: 150, y: 500 },
    flower: { pos: { x: 850, y: 520 }, radius: 42, isGoal: false, bloomed: false },
    // Same shape as Cold Glimmer's hazard, now drifting a slow ellipse around
    // its anchor -- same followSpeed/maxTurnRate as every other stage, so the
    // only new thing being taught is that the safe gap around it isn't fixed,
    // and a player can always just wait a beat for it to drift clear.
    hazards: [
      {
        pos: { x: 500, y: 350 },
        strength: 1,
        radius: 40,
        influenceRadius: 170,
        motion: { amplitude: { x: 90, y: 60 }, angularSpeed: 0.35 },
      },
    ],
    followSpeed: 340,
    maxTurnRate: 2.6,
  },
  {
    name: "Two Flames",
    mothStart: { x: 150, y: 500 },
    flower: { pos: { x: 850, y: 500 }, radius: 42, isGoal: false, bloomed: false },
    // Two hazards flanking the direct line, drifting out of phase with each
    // other so their danger zones rarely close the middle at the same time --
    // a route always exists, it just isn't always the same route.
    hazards: [
      {
        pos: { x: 430, y: 300 },
        strength: 1,
        radius: 38,
        influenceRadius: 150,
        motion: { amplitude: { x: 60, y: 40 }, angularSpeed: 0.4 },
      },
      {
        pos: { x: 620, y: 650 },
        strength: 1,
        radius: 38,
        influenceRadius: 150,
        motion: { amplitude: { x: 70, y: 50 }, angularSpeed: 0.32, phase: Math.PI },
      },
    ],
    followSpeed: 340,
    maxTurnRate: 2.6,
  },
  {
    name: "Moon Flower",
    mothStart: { x: 150, y: 850 },
    // Visibly the largest, calmest target in the game -- see the isGoal
    // palette in render.ts's drawFlower -- so its own presence reads as "this
    // is the end" with no other signal needed.
    flower: { pos: { x: 850, y: 150 }, radius: 60, isGoal: true, bloomed: false },
    // Three hazards on staggered drift cycles, each anchored (and given
    // amplitude) so its influenceRadius can never quite reach the direct
    // start-to-flower diagonal -- same "flying straight never brushes it"
    // guarantee Cold Glimmer's single hazard makes, just harder to eyeball
    // here since that diagonal runs near the world's center, where all three
    // drift fields sit close enough to feel present. A player who wanders off
    // the straight line to explore, or overcorrects while dodging one, is who
    // actually has to deal with them. Same followSpeed/maxTurnRate as every
    // earlier stage -- difficulty is "more to keep track of," never a
    // twitchier moth.
    hazards: [
      {
        pos: { x: 190, y: 470 },
        strength: 1,
        radius: 40,
        influenceRadius: 150,
        motion: { amplitude: { x: 70, y: 55 }, angularSpeed: 0.3 },
      },
      {
        pos: { x: 733, y: 593 },
        strength: 1,
        radius: 40,
        influenceRadius: 150,
        motion: { amplitude: { x: 60, y: 45 }, angularSpeed: 0.25, phase: 2.1 },
      },
      {
        pos: { x: 500, y: 80 },
        strength: 1,
        radius: 40,
        influenceRadius: 160,
        motion: { amplitude: { x: 90, y: 50 }, angularSpeed: 0.35, phase: 4.2 },
      },
    ],
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
