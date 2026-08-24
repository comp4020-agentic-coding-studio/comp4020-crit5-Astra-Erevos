export type Vec2 = { x: number; y: number };
export type Phase = "intro" | "playing" | "won" | "lost";

// The light and every hazard pull the moth by the same rule (see moth.ts) —
// only their position and strength differ, and the moth can't tell them
// apart. `influenceRadius`, when set, confines the pull to a local zone
// around the attractor (ramping up from a faint tug at its edge to full
// strength at `radius`) instead of reaching across the whole stage — used by
// hazards so the player's light stays the dominant, always-on pull and a
// hazard only competes with it once the moth is already close. `kind` is
// purely cosmetic (render.ts picks a lantern/wisp skin from it) and never
// read by moth.ts or outcome.ts.
export type HazardKind = "lantern" | "wisp";
export type Attractor = {
  pos: Vec2;
  strength: number;
  radius: number;
  influenceRadius?: number;
  kind?: HazardKind;
};

// An anchor's `motion`, when present, drifts it on a slow closed ellipse
// around that anchor — amplitude per axis, angularSpeed in radians/sec,
// phase to offset where in the cycle it starts — so its actual position each
// frame is a pure function of elapsed stage time (see motion.ts) with
// nothing to reset by hand when a stage restarts: starting stage time back
// at 0 already puts it back at the same point in its cycle. Shared between
// hazards and (from Stage 5) the flower itself.
export type DriftMotion = { amplitude: Vec2; angularSpeed: number; phase?: number };
export type HazardConfig = {
  pos: Vec2;
  strength: number;
  radius: number;
  influenceRadius?: number;
  motion?: DriftMotion;
  kind?: HazardKind;
};

// A moon fragment is a pure pickup, not an attractor — it never enters
// stepMoth's weighted pull, so the core "only light and hazards move the
// moth" mechanic is unchanged. The moth only ever reaches one because the
// player steered it there.
export type FragmentConfig = { pos: Vec2; radius: number };

export type Flower = {
  pos: Vec2;
  radius: number;
  isGoal: boolean;
  bloomed: boolean;
  motion?: DriftMotion;
};

// Per-stage art direction for the environment layers in render.ts — kept as
// plain color/flag data here so the render code stays generic across stages.
// `frame` names a screen-space foreground-foliage overlay (drawn last, over
// everything else in-world) and `skylightBeam` gates Stage 1's single moon
// shaft through the glasshouse roof — both purely cosmetic switches picked
// up by render.ts, never read by game logic.
export type FrameKind = "glasshouseLeaves" | "hangingVines" | "reedFringe" | "ruinBranches" | "sanctuaryBoughs";
export type SceneArt = {
  skyTop: string;
  skyBottom: string;
  silhouette: string;
  fog: string;
  water?: boolean;
  moon?: boolean;
  skylightBeam?: boolean;
  frame?: FrameKind;
};

// A small hand-authored plant motif, positioned and sized once at module
// load (see `silhouettes()` below) and drawn by render.ts's matching
// `drawFern`/`drawReed`/etc — `kind` picks which, defaulting to the original
// generic leaf-cluster blob when omitted so nothing breaks if a stage
// doesn't bother naming one.
export type PlantKind = "leafCluster" | "fern" | "reed" | "vine" | "deadBranch" | "grassTuft";
export type SilhouetteShape = { x: number; y: number; w: number; h: number; phase: number; kind?: PlantKind };

// The larger, hand-placed set-pieces that make a stage read as a specific
// place rather than a backdrop of generic foliage — a glasshouse arch, a
// lamp post, a collapsed archway. Always placed deliberately (never via the
// seeded `silhouettes()` scatter) because their position is doing narrative
// work: framing a route, standing beside a hazard, marking where three
// fragments' paths converge.
export type StructureKind =
  | "glasshouseArch"
  | "brokenGlassPane"
  | "lampPost"
  | "ironGate"
  | "deadTree"
  | "cattailCluster"
  | "ruinArch"
  | "brokenColumn"
  | "statueFragment"
  | "sanctuaryAltar";
export type StructureShape = {
  x: number;
  y: number;
  scale: number;
  kind: StructureKind;
  flip?: boolean;
  tilt?: number;
};

export type StageConfig = {
  name: string;
  mothStart: Vec2;
  flower: Flower;
  hazards: HazardConfig[];
  fragments: FragmentConfig[];
  followSpeed: number;
  maxTurnRate: number;
  art: SceneArt;
  silhouettesNear: SilhouetteShape[];
  silhouettesFar: SilhouetteShape[];
  structures: StructureShape[];
};

export type MothState = { pos: Vec2; heading: Vec2; speed: number };

export type GameState = {
  phase: Phase;
  stageIndex: number;
  light: Vec2 | null; // null until the player's first pointer input
  moth: MothState;
  fragmentsCollected: boolean[]; // per-attempt progress for the current stage
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

// Deterministic seeded RNG (mulberry32), used only to lay out decorative
// silhouette shapes once at module load — never per frame — so a given
// stage's backdrop is fixed and stable rather than reshuffling on reload.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function silhouettes(
  seed: number,
  count: number,
  yBand: [number, number],
  sizeRange: [number, number],
  kinds?: PlantKind[],
): SilhouetteShape[] {
  const rand = mulberry32(seed);
  const shapes: SilhouetteShape[] = [];
  for (let i = 0; i < count; i++) {
    const w = sizeRange[0] + rand() * (sizeRange[1] - sizeRange[0]);
    shapes.push({
      x: rand() * WORLD.width,
      y: yBand[0] + rand() * (yBand[1] - yBand[0]),
      w,
      h: w * (0.6 + rand() * 0.8),
      phase: rand() * Math.PI * 2,
      kind: kinds ? kinds[i % kinds.length] : undefined,
    });
  }
  return shapes;
}

// MOTH — The Last Night. One continuous night's journey: a decaying garden,
// its broken lanterns, the marsh beyond, the ruins past that, and finally the
// moon flower itself. Difficulty comes from what the player must notice and
// route around — followSpeed/maxTurnRate never change stage to stage.
export const STAGES: StageConfig[] = [
  {
    name: "The Garden",
    mothStart: { x: 220, y: 500 },
    // No hazards yet — this stage only teaches that the moth follows light.
    // Parking the light on the flower and waiting is a perfectly good way to
    // learn that, so it's left free to work here.
    flower: { pos: { x: 800, y: 500 }, radius: 42, isGoal: false, bloomed: false },
    hazards: [],
    fragments: [],
    followSpeed: 340,
    maxTurnRate: 2.6,
    art: {
      skyTop: "#0c1712",
      skyBottom: "#050a08",
      silhouette: "#0e2117",
      fog: "rgba(160,220,180,0.05)",
      skylightBeam: true,
      frame: "glasshouseLeaves",
    },
    // A ruined glasshouse: its arches are the room the player starts inside,
    // so they read before any plant does.
    structures: [
      { x: 150, y: 60, scale: 1.15, kind: "glasshouseArch" },
      { x: 500, y: 30, scale: 1.4, kind: "glasshouseArch" },
      { x: 850, y: 60, scale: 1.15, kind: "glasshouseArch" },
      { x: 500, y: 70, scale: 1, kind: "brokenGlassPane" },
    ],
    silhouettesNear: silhouettes(1, 8, [700, 980], [70, 150], ["fern", "leafCluster", "fern", "grassTuft"]),
    silhouettesFar: silhouettes(2, 6, [560, 780], [50, 100], ["leafCluster", "vine"]),
  },
  {
    name: "The Lanterns",
    mothStart: { x: 160, y: 560 },
    flower: { pos: { x: 860, y: 460 }, radius: 42, isGoal: false, bloomed: false },
    // A single broken garden lantern, well clear of the direct start-to-
    // flower line (~210 units) and only pulling within influenceRadius, so
    // flying straight for the flower never brushes it — reaching it at all
    // is a deliberate detour. Very easy, but its presence has to register.
    hazards: [
      { pos: { x: 500, y: 300 }, strength: 1, radius: 40, influenceRadius: 170, kind: "lantern" },
    ],
    fragments: [],
    followSpeed: 340,
    maxTurnRate: 2.6,
    art: {
      skyTop: "#160f10",
      skyBottom: "#080505",
      silhouette: "#20120f",
      fog: "rgba(255,170,110,0.04)",
      frame: "hangingVines",
    },
    // A stone path deep enough into the garden that human hands built
    // something here — an iron gate the moth has already flown past, and a
    // couple of dead lamps standing unlit beside the one live hazard.
    structures: [
      { x: 130, y: 430, scale: 1.05, kind: "ironGate" },
      { x: 330, y: 660, scale: 1, kind: "lampPost" },
      { x: 720, y: 620, scale: 1, kind: "lampPost", flip: true },
    ],
    silhouettesNear: silhouettes(11, 7, [720, 980], [70, 150], ["leafCluster", "vine", "grassTuft"]),
    silhouettesFar: silhouettes(12, 6, [600, 780], [50, 100], ["leafCluster", "vine"]),
  },
  {
    name: "The Marsh",
    mothStart: { x: 150, y: 500 },
    flower: { pos: { x: 850, y: 520 }, radius: 42, isGoal: false, bloomed: false },
    // Unlike every earlier hazard, this ghost light's anchor sits right on
    // the direct start-to-flower line, with only a small drift amplitude —
    // it stays near that line for its whole cycle. A player who parks the
    // light on the flower and does nothing gets caught; reaching the flower
    // now requires actually walking the light around the wisp's live
    // position first. (Verified in spec/progression.test.ts.)
    hazards: [
      {
        pos: { x: 500, y: 510 },
        strength: 1,
        radius: 42,
        influenceRadius: 190,
        kind: "wisp",
        motion: { amplitude: { x: 45, y: 30 }, angularSpeed: 0.45 },
      },
    ],
    fragments: [],
    followSpeed: 340,
    maxTurnRate: 2.6,
    art: {
      skyTop: "#0a1416",
      skyBottom: "#04080a",
      silhouette: "#0c2226",
      fog: "rgba(150,210,220,0.07)",
      water: true,
      frame: "reedFringe",
    },
    // Dead trees standing in the shallows and dense cattails along the
    // shoreline — the garden's last plants give way to marsh growth here.
    structures: [
      { x: 210, y: 660, scale: 1.3, kind: "deadTree" },
      { x: 780, y: 620, scale: 1.1, kind: "deadTree", flip: true },
      { x: 380, y: 720, scale: 1, kind: "cattailCluster" },
      { x: 630, y: 700, scale: 1.15, kind: "cattailCluster" },
    ],
    silhouettesNear: silhouettes(21, 6, [780, 960], [40, 90], ["reed", "reed", "deadBranch"]),
    silhouettesFar: silhouettes(22, 5, [650, 760], [30, 70], ["deadBranch", "reed"]),
  },
  {
    name: "The Ruins",
    mothStart: { x: 150, y: 500 },
    flower: { pos: { x: 850, y: 500 }, radius: 42, isGoal: false, bloomed: false },
    // Two wisps flanking the direct line, drifting out of phase with each
    // other so a hazard-safe path always exists — it's the three fragments
    // below, not these, that stop naive parking from winning here.
    hazards: [
      {
        pos: { x: 430, y: 300 },
        strength: 1,
        radius: 38,
        influenceRadius: 150,
        kind: "wisp",
        motion: { amplitude: { x: 60, y: 40 }, angularSpeed: 0.47 },
      },
      {
        pos: { x: 620, y: 650 },
        strength: 1,
        radius: 38,
        influenceRadius: 150,
        kind: "wisp",
        motion: { amplitude: { x: 70, y: 50 }, angularSpeed: 0.38, phase: Math.PI },
      },
    ],
    // Three moon fragments spread off the direct line — the flower can't
    // fully open until the moth has absorbed all three, so reaching it
    // requires touring the ruins rather than beelining across them.
    fragments: [
      { pos: { x: 330, y: 220 }, radius: 22 },
      { pos: { x: 500, y: 780 }, radius: 22 },
      { pos: { x: 730, y: 260 }, radius: 22 },
    ],
    followSpeed: 340,
    maxTurnRate: 2.6,
    art: {
      skyTop: "#0e0e12",
      skyBottom: "#07070a",
      silhouette: "#18181f",
      fog: "rgba(200,190,220,0.05)",
      frame: "ruinBranches",
    },
    // Collapsed archways and broken columns frame each fragment's approach
    // without sitting on top of any pickup or hazard — the ruins form the
    // corridors the route actually follows.
    structures: [
      { x: 260, y: 330, scale: 1.25, kind: "ruinArch" },
      { x: 640, y: 610, scale: 1.15, kind: "ruinArch", flip: true },
      { x: 420, y: 500, scale: 1, kind: "brokenColumn" },
      { x: 590, y: 420, scale: 0.9, kind: "brokenColumn", tilt: 0.32 },
      { x: 770, y: 530, scale: 1, kind: "brokenColumn" },
      { x: 290, y: 610, scale: 1, kind: "statueFragment" },
    ],
    silhouettesNear: silhouettes(31, 8, [700, 960], [60, 130], ["vine", "leafCluster"]),
    silhouettesFar: silhouettes(32, 6, [560, 700], [40, 90], ["leafCluster", "vine"]),
  },
  {
    name: "The Moon Flower",
    mothStart: { x: 150, y: 850 },
    // Visibly the largest, calmest target in the game, now also slowly
    // adrift itself — the first flower whose position isn't fixed. Same
    // fragment gate as the Ruins, plus one wisp anchored on the direct
    // diagonal (the other two sit further out) so naive play fails twice
    // over: it can't reach the flower safely, and it can't finish without
    // the fragments even if it did.
    flower: {
      pos: { x: 850, y: 150 },
      radius: 60,
      isGoal: true,
      bloomed: false,
      motion: { amplitude: { x: 40, y: 30 }, angularSpeed: 0.18 },
    },
    hazards: [
      {
        pos: { x: 190, y: 470 },
        strength: 1,
        radius: 40,
        influenceRadius: 150,
        kind: "wisp",
        motion: { amplitude: { x: 70, y: 55 }, angularSpeed: 0.35 },
      },
      {
        pos: { x: 733, y: 593 },
        strength: 1,
        radius: 40,
        influenceRadius: 150,
        kind: "wisp",
        motion: { amplitude: { x: 60, y: 45 }, angularSpeed: 0.29, phase: 2.1 },
      },
      {
        pos: { x: 500, y: 500 },
        strength: 1,
        radius: 40,
        influenceRadius: 180,
        kind: "wisp",
        motion: { amplitude: { x: 50, y: 40 }, angularSpeed: 0.41, phase: 4.2 },
      },
    ],
    fragments: [
      { pos: { x: 300, y: 620 }, radius: 24 },
      { pos: { x: 620, y: 300 }, radius: 24 },
      { pos: { x: 780, y: 700 }, radius: 24 },
    ],
    followSpeed: 340,
    maxTurnRate: 2.6,
    art: {
      skyTop: "#0a0e1c",
      skyBottom: "#05060d",
      silhouette: "#141a34",
      fog: "rgba(180,200,255,0.05)",
      moon: true,
      frame: "sanctuaryBoughs",
    },
    // The ruins' architecture continues here and culminates in the altar the
    // Moon Flower grows from — the same stone language as Stage 4, arriving
    // at its center.
    structures: [
      { x: 850, y: 150, scale: 1.9, kind: "sanctuaryAltar" },
      { x: 640, y: 300, scale: 1.1, kind: "brokenColumn" },
      { x: 260, y: 260, scale: 1, kind: "brokenColumn", tilt: -0.24 },
      { x: 460, y: 110, scale: 1.05, kind: "ruinArch" },
      { x: 150, y: 610, scale: 0.95, kind: "statueFragment" },
    ],
    silhouettesNear: silhouettes(41, 6, [780, 970], [50, 110], ["vine", "leafCluster", "deadBranch"]),
    silhouettesFar: silhouettes(42, 5, [640, 760], [35, 80], ["leafCluster", "vine"]),
  },
];

export function createInitialState(): GameState {
  const first = STAGES[0];
  return {
    phase: "intro",
    stageIndex: 0,
    light: null,
    moth: { pos: { ...first.mothStart }, heading: { x: 1, y: 0 }, speed: 0 },
    fragmentsCollected: first.fragments.map(() => false),
  };
}
