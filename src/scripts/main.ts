import { computeCamera, screenToWorld, type Camera } from "./game/camera";
import { resolveHazards } from "./game/hazards";
import { stepMoth } from "./game/moth";
import { checkOutcome } from "./game/outcome";
import { render } from "./game/render";
import {
  createInitialState,
  FLOWER_VISUAL_OVERSHOOT,
  MOTH_RADIUS,
  STAGES,
  type Attractor,
  type GameState,
  type Vec2,
} from "./game/state";

// How long the death animation (flash + the moth visibly pulled into the
// hazard) plays before the Retry control appears. After that the game is
// genuinely paused — nothing moves again until the player asks it to.
const RETRY_REVEAL_DELAY = 0.6;

function getCanvas(): HTMLCanvasElement {
  const el = document.querySelector<HTMLCanvasElement>("#scene");
  if (!el) throw new Error("missing #scene canvas");
  return el;
}

function getContext(el: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = el.getContext("2d");
  if (!context) throw new Error("2d context unavailable");
  return context;
}

function getRetryButton(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>("#retry");
  if (!el) throw new Error("missing #retry button");
  return el;
}

const canvas = getCanvas();
const ctx = getContext(canvas);
const retryButton = getRetryButton();

const state: GameState = createInitialState();
let camera: Camera = computeCamera(window.innerWidth, window.innerHeight);
let lastTime = 0;
let introTime = 0; // drives the idle wobble before the player's first move
// Seconds elapsed since the current stage entered "playing" -- the only
// input hazard motion depends on (see hazards.ts), so restarting it at 0 on
// every stage entry is the entire "reset hazard movement" step.
let stageTime = 0;

let previousPhase = state.phase;
let phaseTimer = 0;

// Captured the instant the moth is lost, so the death animation can pull it
// toward the specific hazard that caught it and highlight that hazard.
let deathHazard: Attractor | null = null;
let deathMothPos: Vec2 | null = null;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera = computeCamera(window.innerWidth, window.innerHeight);
}

function onPointerActivity(event: PointerEvent): void {
  if (state.phase === "won" || state.phase === "lost") return;
  const rect = canvas.getBoundingClientRect();
  state.light = screenToWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  if (state.phase === "intro") state.phase = "playing";
}

function showRetry(): void {
  retryButton.classList.add("is-visible");
}

function hideRetry(): void {
  retryButton.classList.remove("is-visible");
}

window.addEventListener("resize", resize);
window.addEventListener("pointermove", onPointerActivity);
window.addEventListener("pointerdown", onPointerActivity);
retryButton.addEventListener("click", () => {
  if (state.phase !== "lost") return;
  resetStage();
  hideRetry();
});
resize();

function idleWobble(time: number) {
  const stage = STAGES[state.stageIndex];
  const t = time / 1000;
  return {
    x: stage.mothStart.x + Math.sin(t * 0.7) * 18,
    y: stage.mothStart.y + Math.cos(t * 0.5) * 12,
  };
}

// Which hazard actually caught the moth — same inclusion rule as
// checkOutcome, just naming the culprit instead of only the verdict.
function findCauseHazard(mothPos: Vec2, hazards: Attractor[]): Attractor | null {
  for (const hazard of hazards) {
    const dist = Math.hypot(mothPos.x - hazard.pos.x, mothPos.y - hazard.pos.y);
    if (dist <= hazard.radius + MOTH_RADIUS) return hazard;
  }
  return null;
}

// Re-initializes every piece of dynamic state for the current stage — moth,
// player light, and the death bookkeeping — so a retry never inherits
// anything from the attempt that just failed.
function resetStage(): void {
  const stage = STAGES[state.stageIndex];
  state.moth = { pos: { ...stage.mothStart }, heading: { x: 1, y: 0 }, speed: 0 };
  state.light = null;
  state.phase = "playing";
  deathHazard = null;
  deathMothPos = null;
  stageTime = 0;
}

function advanceStage(): void {
  const next = STAGES[state.stageIndex + 1];
  state.stageIndex += 1;
  state.moth = { pos: { ...next.mothStart }, heading: state.moth.heading, speed: 0 };
  stageTime = 0;
}

function frame(time: number): void {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 1 / 20) : 0;
  lastTime = time;
  const timeSec = time / 1000;

  if (state.phase !== previousPhase) {
    phaseTimer = 0;
    previousPhase = state.phase;
  } else {
    phaseTimer += dt;
  }

  const stage = STAGES[state.stageIndex];
  // Resolved fresh every frame from stageTime alone (see hazards.ts) -- used
  // both for this frame's simulation below and for rendering, so a hazard's
  // drawn position always matches the one the moth/outcome logic just acted
  // on, in every phase (frozen along with stageTime once "playing" ends).
  let hazards = resolveHazards(stage.hazards, stageTime);

  if (state.phase === "intro") {
    introTime += dt * 1000;
    state.moth.pos = idleWobble(introTime);
  } else if (state.phase === "playing") {
    stageTime += dt;
    hazards = resolveHazards(stage.hazards, stageTime);
    state.moth = stepMoth(state.moth, state.light, hazards, stage.followSpeed, stage.maxTurnRate, dt);
    // The flower's petals (and the moth's own wings) visually reach well past
    // their logical radii once drawn -- see drawFlower/drawMoth in render.ts
    // -- so a player who visibly touches the flower should win, not just one
    // whose moth-center is within its raw radius. Widen only the flower side
    // of the check to close that gap; hazard danger geometry (MOTH_RADIUS +
    // hazard.radius) is untouched.
    const visualFlower = { ...stage.flower, radius: stage.flower.radius * FLOWER_VISUAL_OVERSHOOT };
    const outcome = checkOutcome(state.moth.pos, hazards, visualFlower, MOTH_RADIUS);
    if (outcome === "lost") {
      deathMothPos = { ...state.moth.pos };
      deathHazard = findCauseHazard(state.moth.pos, hazards);
      state.phase = "lost";
    } else if (outcome === "won") {
      stage.flower.bloomed = true;
      if (stage.flower.isGoal) {
        state.phase = "won";
      } else {
        advanceStage();
      }
    }
  } else if (state.phase === "lost") {
    // Sell the cause: visibly drag the moth the rest of the way into the
    // hazard that caught it, instead of freezing it mid-air. Once that
    // settles, the game stays paused here — nothing runs again until Retry
    // is clicked.
    if (deathHazard && deathMothPos) {
      const pullT = Math.min(1, phaseTimer / 0.3);
      state.moth.pos = {
        x: deathMothPos.x + (deathHazard.pos.x - deathMothPos.x) * pullT,
        y: deathMothPos.y + (deathHazard.pos.y - deathMothPos.y) * pullT,
      };
    }
    if (phaseTimer >= RETRY_REVEAL_DELAY) showRetry();
  }

  render(ctx, state, { ...stage, hazards }, window.innerWidth, window.innerHeight, {
    timeSec,
    phaseTimer,
    deathHazardPos: deathHazard ? deathHazard.pos : null,
  });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
