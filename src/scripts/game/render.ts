import { computeCamera, worldToScreen, type Camera } from "./camera";
import { MOTH_RADIUS, type GameState, type StageConfig, type Vec2 } from "./state";

export type RenderExtras = {
  timeSec: number;
  phaseTimer: number; // seconds since the current phase (esp. "lost") began
  deathHazardPos: Vec2 | null; // the hazard that caught the moth, while "lost"
};

// Reads a GameState snapshot and draws it. Never mutates state — all
// decisions live in moth.ts and outcome.ts.
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  stage: StageConfig,
  viewWidth: number,
  viewHeight: number,
  extras: RenderExtras,
): void {
  const camera = computeCamera(viewWidth, viewHeight);

  ctx.fillStyle = "#050507";
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  drawHazards(ctx, camera, stage, state.moth.pos, extras);
  drawFlower(ctx, camera, stage, extras.timeSec);
  if (state.light && state.phase !== "lost") drawLight(ctx, camera, state.light, extras.timeSec);
  drawMoth(ctx, camera, state, extras.timeSec);

  if (state.phase === "lost") drawDeathOverlay(ctx, viewWidth, viewHeight, extras.phaseTimer);
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

// Hazards read as sharp, unstable flares --- jittering star-shaped bursts in
// hot red/orange --- as opposed to the player's calm, round, cool-white light.
function drawHazards(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stage: StageConfig,
  mothPos: Vec2,
  extras: RenderExtras,
) {
  ctx.globalCompositeOperation = "lighter";
  for (const hazard of stage.hazards) {
    const isCause =
      extras.deathHazardPos !== null &&
      hazard.pos.x === extras.deathHazardPos.x &&
      hazard.pos.y === extras.deathHazardPos.y;
    // A brief surge on the specific hazard that just caught the moth, on top
    // of its constant low-level "danger" pulse.
    const deathSurge = isCause ? 1 + Math.max(0, 1 - extras.phaseTimer / 0.4) * 0.9 : 1;

    // A gentler, standing surge while the moth sits inside the hazard's
    // actual pull range --- so the moment attraction.ts starts tugging on
    // the moth is the same moment the hazard visibly reacts to it.
    let proximityT = 0;
    if (hazard.influenceRadius !== undefined) {
      const dist = Math.hypot(mothPos.x - hazard.pos.x, mothPos.y - hazard.pos.y);
      proximityT = Math.min(1, Math.max(0, (hazard.influenceRadius - dist) / hazard.influenceRadius));
      drawInfluenceRing(ctx, camera, hazard.pos, hazard.influenceRadius, proximityT);
    }
    const proximitySurge = 1 + proximityT * 0.6;

    drawHazardBurst(ctx, camera, hazard.pos, hazard.radius, extras.timeSec, deathSurge * proximitySurge);
  }
  ctx.globalCompositeOperation = "source-over";
}

// A very faint ring at the edge of the hazard's actual pull range --- almost
// invisible at rest, so it never reads as a second hard boundary, but warms
// slightly once the moth is inside it as one more cue that something is
// happening.
function drawInfluenceRing(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  worldPos: Vec2,
  worldRadius: number,
  proximityT: number,
) {
  const p = worldToScreen(camera, worldPos);
  const r = worldRadius * camera.scale;
  ctx.strokeStyle = `rgba(255,90,70,${(0.05 + proximityT * 0.12).toFixed(3)})`;
  ctx.lineWidth = Math.max(1, 1.5 * camera.scale);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHazardBurst(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  worldPos: Vec2,
  worldRadius: number,
  timeSec: number,
  surge: number,
) {
  const p = worldToScreen(camera, worldPos);
  const pulse = 0.78 + 0.22 * Math.sin(timeSec * 5.5);
  const r = worldRadius * camera.scale * pulse * surge;

  glow(ctx, p, r * 3.4, `rgba(200,40,40,${0.4 * surge})`);

  const points = 9;
  ctx.beginPath();
  for (let i = 0; i <= points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2;
    const jitter = 0.8 + 0.2 * Math.sin(timeSec * 7 + i * 1.7);
    const spikeRadius = (i % 2 === 0 ? r : r * 0.42) * jitter;
    const x = p.x + Math.cos(angle) * spikeRadius;
    const y = p.y + Math.sin(angle) * spikeRadius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  gradient.addColorStop(0, "rgba(255,140,90,0.95)");
  gradient.addColorStop(0.6, "rgba(255,60,50,0.8)");
  gradient.addColorStop(1, "rgba(200,20,20,0.15)");
  ctx.fillStyle = gradient;
  ctx.fill();
}

// The safe target reads as an actual flower --- petals and a center, not a
// dot --- so it can't be mistaken for a light source. Petals open wider and
// warm up once reached.
function drawFlower(ctx: CanvasRenderingContext2D, camera: Camera, stage: StageConfig, timeSec: number) {
  const p = worldToScreen(camera, stage.flower.pos);
  const bloom = stage.flower.bloomed;
  const r = stage.flower.radius * camera.scale * (bloom ? 1.2 : 1);

  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, r * 3.2, bloom ? "rgba(255,235,190,0.7)" : "rgba(255,205,140,0.42)");
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.sin(timeSec * 0.6) * 0.06);

  const petals = 6;
  const petalColor = bloom ? "rgba(255,246,220,0.95)" : "rgba(255,214,150,0.85)";
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((i / petals) * Math.PI * 2);
    ctx.fillStyle = petalColor;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.62, r * 0.32, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = bloom ? "#fff7e3" : "#ffe4a8";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The player's own light: a clean, round, cool-white glow with a slow, calm
// breathing pulse — the visual opposite of a hazard's hot, jittery flare.
function drawLight(ctx: CanvasRenderingContext2D, camera: Camera, lightPos: Vec2, timeSec: number) {
  const p = worldToScreen(camera, lightPos);
  const breathe = 0.95 + 0.05 * Math.sin(timeSec * 1.3);
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, 46 * camera.scale * breathe, "rgba(225,238,255,0.95)");
  glow(ctx, p, 150 * camera.scale * breathe, "rgba(160,200,255,0.25)");
  ctx.globalCompositeOperation = "source-over";
}

// The moth itself: a body + two flapping wings, drawn as a muted silhouette
// (not a glowing orb) so it never reads as another light source.
function drawMoth(ctx: CanvasRenderingContext2D, camera: Camera, state: GameState, timeSec: number) {
  const p = worldToScreen(camera, state.moth.pos);
  const scale = camera.scale;
  const angle = Math.atan2(state.moth.heading.y, state.moth.heading.x);
  const bob = Math.sin(timeSec * 3) * 1.5 * scale;
  const flap = (Math.sin(timeSec * 9) * 0.5 + 0.5) * 0.4;
  const unit = MOTH_RADIUS * scale;

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(angle);

  ctx.globalCompositeOperation = "lighter";
  glow(ctx, { x: 0, y: 0 }, unit * 2, "rgba(210,205,235,0.16)");
  ctx.globalCompositeOperation = "source-over";

  const wingColor = "rgba(198,192,224,0.88)";
  drawWing(ctx, 1, flap, unit, wingColor);
  drawWing(ctx, -1, flap, unit, wingColor);

  ctx.fillStyle = "#332e48";
  ctx.beginPath();
  ctx.ellipse(0, 0, unit * 0.8, unit * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawWing(
  ctx: CanvasRenderingContext2D,
  side: 1 | -1,
  flap: number,
  unit: number,
  color: string,
) {
  ctx.save();
  ctx.translate(-unit * 0.15, 0);
  ctx.rotate(side * (0.6 - flap));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(unit * 0.85, 0, unit * 1.05, unit * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A quick red flash on the instant of death, settling into a held dark-red
// tint for the rest of the pause before the stage resets — so "you lost" is
// unambiguous even though nothing on screen says it.
function drawDeathOverlay(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  phaseTimer: number,
) {
  const flash = Math.max(0, 1 - phaseTimer / 0.35);
  const hold = Math.min(0.5, phaseTimer / 0.5);
  ctx.fillStyle = `rgba(90,0,0,${hold})`;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,70,60,${flash * 0.55})`;
    ctx.fillRect(0, 0, viewWidth, viewHeight);
  }
}
