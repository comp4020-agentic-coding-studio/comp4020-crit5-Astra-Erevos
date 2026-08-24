import { createAudio } from "./game/audio";
import { computeCamera, screenToWorld, type Camera } from "./game/camera";
import { collectFragments } from "./game/fragments";
import { maxHazardProximity, resolveHazards } from "./game/hazards";
import { stepMoth } from "./game/moth";
import { resolvePosition } from "./game/motion";
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

// How many recent moth positions the luminescent trail keeps. Pure display
// bookkeeping, kept the same way deathMothPos/deathHazard already are below
// -- not part of GameState, since it's derived, not decided.
const TRAIL_LENGTH = 22;

// When the final stage's ending text/replay control appears, in seconds into
// the "won" phase -- the earlier beats (bloom easing open, environment wash,
// light motes, the moth's moonlit variant) are timed directly off
// extras.phaseTimer inside render.ts.
const ENDING_TEXT_AT = 6;

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

function getEndingOverlay(): HTMLElement {
  const el = document.querySelector<HTMLElement>("#ending");
  if (!el) throw new Error("missing #ending overlay");
  return el;
}

function getMuteButton(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>("#mute");
  if (!el) throw new Error("missing #mute button");
  return el;
}

const canvas = getCanvas();
const ctx = getContext(canvas);
const retryButton = getRetryButton();
const endingOverlay = getEndingOverlay();
const muteButton = getMuteButton();
const audio = createAudio();

const state: GameState = createInitialState();
let camera: Camera = computeCamera(window.innerWidth, window.innerHeight);
let lastTime = 0;
let introTime = 0; // drives the idle wobble before the player's first move
// Seconds elapsed since the current stage entered "playing" -- the only
// input hazard/flower motion depends on (see hazards.ts/motion.ts), so
// restarting it at 0 on every stage entry is the entire "reset movement"
// step.
let stageTime = 0;

let previousPhase = state.phase;
let phaseTimer = 0;

// Captured the instant the moth is lost, so the death animation can pull it
// toward the specific hazard that caught it and highlight that hazard.
let deathHazard: Attractor | null = null;
let deathMothPos: Vec2 | null = null;

// Recent moth positions, oldest first, for the trail render.ts draws behind
// the moth. Cleared on every stage entry alongside everything else transient.
let trail: Vec2[] = [];

// Set once the final stage's multi-beat ending has actually revealed its
// text -- distinguishes "still mid-ending-animation" from "done", so the
// reveal and the Retry-button relabel each only fire once per playthrough.
let endingRevealed = false;

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
  audio.ensureStarted();
  if (state.phase === "won" || state.phase === "lost") return;
  const rect = canvas.getBoundingClientRect();
  state.light = screenToWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  if (state.phase === "intro") state.phase = "playing";
}

function showRetry(label: string): void {
  retryButton.querySelector(".retry-label")!.textContent = label;
  retryButton.classList.add("is-visible");
}

function hideRetry(): void {
  retryButton.classList.remove("is-visible");
}

window.addEventListener("resize", resize);
window.addEventListener("pointermove", onPointerActivity);
window.addEventListener("pointerdown", onPointerActivity);
retryButton.addEventListener("click", () => {
  if (state.phase === "lost") {
    resetStage();
    hideRetry();
  } else if (endingRevealed) {
    restartGame();
    hideRetry();
  }
});
muteButton.addEventListener("click", () => {
  audio.ensureStarted();
  const muted = audio.toggleMute();
  muteButton.textContent = muted ? "🔇" : "🔊";
  muteButton.setAttribute("aria-label", muted ? "Unmute" : "Mute");
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
// player light, fragment progress, trail, and the death bookkeeping — so a
// retry never inherits anything from the attempt that just failed.
function resetStage(): void {
  const stage = STAGES[state.stageIndex];
  state.moth = { pos: { ...stage.mothStart }, heading: { x: 1, y: 0 }, speed: 0 };
  state.light = null;
  state.phase = "playing";
  state.fragmentsCollected = stage.fragments.map(() => false);
  deathHazard = null;
  deathMothPos = null;
  stageTime = 0;
  trail = [];
}

function advanceStage(): void {
  const next = STAGES[state.stageIndex + 1];
  state.stageIndex += 1;
  state.moth = { pos: { ...next.mothStart }, heading: state.moth.heading, speed: 0 };
  state.fragmentsCollected = next.fragments.map(() => false);
  stageTime = 0;
  trail = [];
}

// Only reachable from the completed ending (the "Play Again" branch of the
// Retry/replay control) — a full return to Stage 1, distinct from
// resetStage()'s single-stage retry-after-death.
function restartGame(): void {
  const fresh = createInitialState();
  state.phase = fresh.phase;
  state.stageIndex = fresh.stageIndex;
  state.light = fresh.light;
  state.moth = fresh.moth;
  state.fragmentsCollected = fresh.fragmentsCollected;
  for (const stage of STAGES) stage.flower.bloomed = false;
  deathHazard = null;
  deathMothPos = null;
  stageTime = 0;
  introTime = 0;
  trail = [];
  endingRevealed = false;
  endingOverlay.classList.remove("is-visible");
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
  // Resolved fresh every frame from stageTime alone (see hazards.ts/motion.ts)
  // -- used both for this frame's simulation below and for rendering, so a
  // hazard/flower's drawn position always matches the one the moth/outcome
  // logic just acted on, in every phase (frozen along with stageTime once
  // "playing" ends).
  let hazards = resolveHazards(stage.hazards, stageTime);
  let flowerPos = resolvePosition(stage.flower.pos, stage.flower.motion, stageTime);

  if (state.phase === "intro") {
    introTime += dt * 1000;
    state.moth.pos = idleWobble(introTime);
  } else if (state.phase === "playing") {
    stageTime += dt;
    hazards = resolveHazards(stage.hazards, stageTime);
    flowerPos = resolvePosition(stage.flower.pos, stage.flower.motion, stageTime);
    state.moth = stepMoth(state.moth, state.light, hazards, stage.followSpeed, stage.maxTurnRate, dt);

    const newlyCollected = collectFragments(state.moth.pos, stage.fragments, state.fragmentsCollected, MOTH_RADIUS);
    for (let i = 0; i < newlyCollected.length; i++) {
      if (newlyCollected[i] && !state.fragmentsCollected[i]) audio.onFragmentCollected();
    }
    state.fragmentsCollected = newlyCollected;

    // The flower's petals (and the moth's own wings) visually reach well past
    // their logical radii once drawn -- see drawFlower/drawMoth in render.ts
    // -- so a player who visibly touches the flower should win, not just one
    // whose moth-center is within its raw radius. Widen only the flower side
    // of the check to close that gap; hazard danger geometry (MOTH_RADIUS +
    // hazard.radius) is untouched.
    const visualFlower = { ...stage.flower, pos: flowerPos, radius: stage.flower.radius * FLOWER_VISUAL_OVERSHOOT };
    const outcome = checkOutcome(state.moth.pos, hazards, visualFlower, MOTH_RADIUS);
    // A geometrically-true "won" only counts once every fragment this stage
    // asks for is actually collected -- Stages 1-3 have none, so this is a
    // no-op there. Otherwise the moth can sit on an unripe flower harmlessly:
    // still "playing", no penalty, no new geometry rule.
    if (outcome === "won" && !state.fragmentsCollected.every(Boolean)) {
      // fall through as "playing" -- flower stays closed
    } else if (outcome === "lost") {
      deathMothPos = { ...state.moth.pos };
      deathHazard = findCauseHazard(state.moth.pos, hazards);
      state.phase = "lost";
    } else if (outcome === "won") {
      const wasBloomed = stage.flower.bloomed;
      stage.flower.bloomed = true;
      if (!wasBloomed) audio.onBloom();
      if (stage.flower.isGoal) {
        state.phase = "won";
        audio.onFinalBloom();
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
    if (phaseTimer >= RETRY_REVEAL_DELAY) showRetry("Retry");
  } else if (state.phase === "won" && stage.flower.isGoal && !endingRevealed && phaseTimer >= ENDING_TEXT_AT) {
    endingRevealed = true;
    endingOverlay.classList.add("is-visible");
    showRetry("Play Again");
  }

  audio.update({
    lightActive: state.phase === "playing" && state.light !== null,
    mothSpeedT: state.moth.speed / stage.followSpeed,
    timeSec,
    maxProximity: maxHazardProximity(state.moth.pos, hazards),
  });

  trail.push({ ...state.moth.pos });
  if (trail.length > TRAIL_LENGTH) trail.shift();

  const renderStage = {
    ...stage,
    hazards,
    flower: { ...stage.flower, pos: flowerPos },
  };
  render(ctx, state, renderStage, window.innerWidth, window.innerHeight, {
    timeSec,
    phaseTimer,
    deathHazardPos: deathHazard ? deathHazard.pos : null,
    fragmentsCollected: state.fragmentsCollected,
    trail,
  });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
