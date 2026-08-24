import { computeCamera, worldToScreen, type Camera } from "./camera";
import { MOTH_RADIUS, type GameState, type StageConfig, type Vec2 } from "./state";

// Reads a GameState snapshot and draws it. Never mutates state — all
// decisions live in moth.ts and outcome.ts.
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  stage: StageConfig,
  viewWidth: number,
  viewHeight: number,
): void {
  const camera = computeCamera(viewWidth, viewHeight);

  ctx.fillStyle = "#050507";
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  drawHazards(ctx, camera, stage);
  drawFlower(ctx, camera, stage);
  if (state.light) drawLight(ctx, camera, state.light);
  drawMoth(ctx, camera, state);
}

function glow(ctx: CanvasRenderingContext2D, center: Vec2, radius: number, color: string) {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawHazards(ctx: CanvasRenderingContext2D, camera: Camera, stage: StageConfig) {
  ctx.globalCompositeOperation = "lighter";
  for (const hazard of stage.hazards) {
    const p = worldToScreen(camera, hazard.pos);
    const r = hazard.radius * camera.scale;
    glow(ctx, p, r * 3, "rgba(180,40,60,0.55)");
    glow(ctx, p, r, "rgba(255,90,90,0.9)");
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawFlower(ctx: CanvasRenderingContext2D, camera: Camera, stage: StageConfig) {
  const p = worldToScreen(camera, stage.flower.pos);
  const r = stage.flower.radius * camera.scale;
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, r * 3.4, stage.flower.bloomed ? "rgba(255,240,200,0.75)" : "rgba(255,210,120,0.5)");
  glow(ctx, p, r, stage.flower.bloomed ? "rgba(255,255,240,1)" : "rgba(255,225,150,0.95)");
  ctx.globalCompositeOperation = "source-over";
}

function drawLight(ctx: CanvasRenderingContext2D, camera: Camera, lightPos: Vec2) {
  const p = worldToScreen(camera, lightPos);
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, 46 * camera.scale, "rgba(255,255,255,0.95)");
  glow(ctx, p, 140 * camera.scale, "rgba(200,220,255,0.28)");
  ctx.globalCompositeOperation = "source-over";
}

function drawMoth(ctx: CanvasRenderingContext2D, camera: Camera, state: GameState) {
  const p = worldToScreen(camera, state.moth.pos);
  const r = MOTH_RADIUS * camera.scale;
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, r * 2.2, "rgba(230,225,255,0.35)");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#e8e4f5";
  ctx.beginPath();
  ctx.ellipse(
    p.x,
    p.y,
    r,
    r * 0.6,
    Math.atan2(state.moth.heading.y, state.moth.heading.x),
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
