import { computeCamera, screenToWorld, type Camera } from "./game/camera";
import { stepMoth } from "./game/moth";
import { checkOutcome } from "./game/outcome";
import { render } from "./game/render";
import {
  createInitialState,
  LIGHT_STRENGTH,
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

function attractorsFor(current: GameState): Attractor[] {
  const stage = STAGES[current.stageIndex];
  const attractors: Attractor[] = [...stage.hazards];
  if (current.light) attractors.push({ pos: current.light, strength: LIGHT_STRENGTH, radius: 0 });
  return attractors;
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
}

function advanceStage(): void {
  const next = STAGES[state.stageIndex + 1];
  state.stageIndex += 1;
  state.moth = { pos: { ...next.mothStart }, heading: state.moth.heading, speed: 0 };
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

  if (state.phase === "intro") {
    introTime += dt * 1000;
    state.moth.pos = idleWobble(introTime);
  } else if (state.phase === "playing") {
    state.moth = stepMoth(state.moth, attractorsFor(state), stage.followSpeed, stage.maxTurnRate, dt);
    const outcome = checkOutcome(state.moth.pos, stage.hazards, stage.flower, MOTH_RADIUS);
    if (outcome === "lost") {
      deathMothPos = { ...state.moth.pos };
      deathHazard = findCauseHazard(state.moth.pos, stage.hazards);
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

  render(ctx, state, STAGES[state.stageIndex], window.innerWidth, window.innerHeight, {
    timeSec,
    phaseTimer,
    deathHazardPos: deathHazard ? deathHazard.pos : null,
  });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
