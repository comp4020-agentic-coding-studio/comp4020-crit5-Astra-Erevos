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
} from "./game/state";

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

const canvas = getCanvas();
const ctx = getContext(canvas);

const state: GameState = createInitialState();
let camera: Camera = computeCamera(window.innerWidth, window.innerHeight);
let lastTime = 0;
let introTime = 0; // drives the idle wobble before the player's first move

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

window.addEventListener("resize", resize);
window.addEventListener("pointermove", onPointerActivity);
window.addEventListener("pointerdown", onPointerActivity);
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

function advanceStage(): void {
  const next = STAGES[state.stageIndex + 1];
  state.stageIndex += 1;
  state.moth = { pos: { ...next.mothStart }, heading: state.moth.heading, speed: 0 };
}

function frame(time: number): void {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 1 / 20) : 0;
  lastTime = time;

  const stage = STAGES[state.stageIndex];

  if (state.phase === "intro") {
    introTime += dt * 1000;
    state.moth.pos = idleWobble(introTime);
  } else if (state.phase === "playing") {
    state.moth = stepMoth(state.moth, attractorsFor(state), stage.followSpeed, stage.maxTurnRate, dt);
    const outcome = checkOutcome(state.moth.pos, stage.hazards, stage.flower, MOTH_RADIUS);
    if (outcome === "lost") {
      state.phase = "lost";
    } else if (outcome === "won") {
      stage.flower.bloomed = true;
      if (stage.flower.isGoal) {
        state.phase = "won";
      } else {
        advanceStage();
      }
    }
  }

  render(ctx, state, STAGES[state.stageIndex], window.innerWidth, window.innerHeight);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
