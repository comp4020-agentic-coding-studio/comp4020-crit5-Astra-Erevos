import { computeCamera, worldToScreen, type Camera } from "./camera";
import { hazardProximity, maxHazardProximity } from "./hazards";
import {
  MOTH_RADIUS,
  WORLD,
  type Attractor,
  type FragmentConfig,
  type FrameKind,
  type GameState,
  type SilhouetteShape,
  type StageConfig,
  type StructureShape,
  type Vec2,
  STAGES,
} from "./state";

export type RenderExtras = {
  timeSec: number;
  phaseTimer: number; // seconds since the current phase (esp. "lost"/"won") began
  deathHazardPos: Vec2 | null; // the hazard that caught the moth, while "lost"
  fragmentsCollected: boolean[]; // this attempt's progress toward the current stage's flower
  trail: Vec2[]; // recent moth positions, oldest first, for the luminescent trail
  // 0..1, how much of the current stage's fragments are collected so far —
  // drives a faint wake-up glow on structures/the hero landmark as the
  // player makes progress, not just on the moth itself.
  awakenT: number;
  // Set only while main.ts is holding its fixed cosmetic pause between two
  // stages (see `transition` in main.ts). `t` is 0..1 progress through that
  // pause; `effect` picks which full-screen cause-and-effect plays.
  transition?: { t: number; effect: "ignite" | "flood" | "drain" | "reveal" };
  // Null unless main.ts is currently holding a Memory Echo window open (see
  // `echoElapsed`) — 0..1 progress through that ~0.9s window, one fired per
  // fragment collected on whichever stage has fragments.
  echoT: number | null;
};

// What render actually needs from a stage: everything StageConfig has,
// except hazards already resolved to their current on-screen positions (see
// hazards.ts) rather than the raw per-stage motion config, and the flower's
// `pos` already resolved too (from Stage 5 on, it drifts the same way).
type RenderStage = Omit<StageConfig, "hazards"> & { hazards: Attractor[] };

// Hand-authored vector motifs, shared across every stage that draws a petal
// or a leaf, so the whole game speaks one visual language instead of each
// stage inventing its own primitive shapes. Built from literal SVG path
// data (teardrop curves) rather than ellipses.
const PETAL_PATH = new Path2D("M0,0 C-0.55,-0.32 -0.42,-0.82 0,-1 C0.42,-0.82 0.55,-0.32 0,0 Z");
const LEAF_PATH = new Path2D("M0,0 C-0.15,-0.4 -0.5,-0.7 0,-1 C0.5,-0.7 0.15,-0.4 0,0 Z");
// A crescent built from two overlapping circular subpaths, filled with the
// "evenodd" rule so the overlap punches a bite out of the disc — a moon
// fragment reads as a sliver of moonlight, not a rotating diamond.
const FRAGMENT_PATH = new Path2D();
FRAGMENT_PATH.arc(0, 0, 1, 0, Math.PI * 2);
FRAGMENT_PATH.arc(0.55, 0, 0.95, 0, Math.PI * 2, true);

// A small carved/inlaid crescent, sharing FRAGMENT_PATH's exact silhouette —
// the same emblem a moon fragment glows as, cut faintly into the world's
// architecture from Stage 1 onward so its completion at the sanctuary's
// altar reads as recognition, not a new symbol. Always the same pale
// moonlight tint regardless of the caller's local palette, and always
// additive, so it never overpowers a stage's own colors — a gleam, not a
// paint job.
function drawCrescentMark(ctx: CanvasRenderingContext2D, size: number, alpha: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(210,222,255,${alpha})`;
  ctx.scale(size, size);
  ctx.fill(FRAGMENT_PATH, "evenodd");
  ctx.restore();
}

// Every point of light in a frame — the player's own light plus every
// hazard, each carrying its own tint — so the environment can react to
// whichever one is nearest, not just the player's. Purely a render-side
// concept; moth.ts's attraction math never sees this.
type LightSource = { pos: Vec2; rgb: string; radius: number };

// The one fixed world-space line every stage's ground/horizon and Stage 3's
// water surface share, so the new ground band always lines up exactly with
// the existing water reflection rather than competing with it.
const HORIZON_WORLD_Y = 760;

// A pale, cool "moonlight caught the edge of this" tint used for rim
// highlights and detail lines drawn additively on top of a solid silhouette
// fill — the same tone everywhere so every structure's edge separates from
// the sky behind it the same way, independent of that stage's own hue.
const RIM_LIGHT_RGB = "200,215,255";

function withRimLight(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(${RIM_LIGHT_RGB},${alpha})`;
  ctx.fillStyle = `rgba(${RIM_LIGHT_RGB},${alpha})`;
  draw();
  ctx.restore();
}

// Reads a GameState snapshot and draws it. Never mutates state — all
// decisions live in moth.ts and outcome.ts.
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  stage: RenderStage,
  viewWidth: number,
  viewHeight: number,
  extras: RenderExtras,
): void {
  const camera = computeCamera(viewWidth, viewHeight);

  // A cheap depth cue: each layer nudges slightly opposite whatever the
  // player is currently steering toward (the light once it exists, the
  // moth's own idle drift before that) — far barely at all, mid-ground
  // structures a little more, near foliage the most — no real camera
  // scroll, WORLD stays fixed.
  const focus = state.light ?? state.moth.pos;
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const parallaxFar = { x: (center.x - focus.x) * 0.012, y: (center.y - focus.y) * 0.012 };
  const parallaxMid = { x: (center.x - focus.x) * 0.02, y: (center.y - focus.y) * 0.02 };
  const parallaxNear = { x: (center.x - focus.x) * 0.026, y: (center.y - focus.y) * 0.026 };

  const isEnding = state.phase === "won" && stage.flower.isGoal;
  const wash = isEnding ? Math.min(1, Math.max(0, (extras.phaseTimer - 2) / 2)) : 0;
  const extinguish = isEnding ? Math.min(1, Math.max(0, (extras.phaseTimer - 3) / 2)) : 0;

  // The full set of things the environment should visibly react to this
  // frame — the player's cool white light plus every hazard, warm amber for
  // a lantern's flame, cool green for a wisp's glow.
  const lightSources: LightSource[] = [];
  if (state.light && state.phase === "playing") {
    lightSources.push({ pos: state.light, rgb: "210,225,255", radius: 170 });
  }
  for (const hazard of stage.hazards) {
    lightSources.push({
      pos: hazard.pos,
      rgb: hazard.kind === "lantern" ? "255,170,90" : "150,255,210",
      radius: hazard.influenceRadius ?? hazard.radius * 3,
    });
  }

  drawSkyAndGround(ctx, camera, viewWidth, viewHeight, stage.art, wash, extras.timeSec, extras.awakenT);
  if (stage.art.skylightBeam) drawSkylightBeam(ctx, camera, extras.timeSec);
  drawHeroLandmark(
    ctx,
    camera,
    stage.heroLandmark,
    stage.art.silhouette,
    extras.timeSec,
    parallaxFar,
    extras.awakenT,
  );
  drawSilhouetteLayer(ctx, camera, stage.silhouettesFar, stage.art.silhouette, extras.timeSec, parallaxFar, 0.45);
  drawAtmosphere(ctx, camera, extras.timeSec, stage.art.fog, state.light);
  drawStructureLayer(
    ctx,
    camera,
    stage.structures,
    stage.art.silhouette,
    extras.timeSec,
    parallaxMid,
    0.75,
    lightSources,
    extras.awakenT,
  );
  drawSilhouetteLayer(
    ctx,
    camera,
    stage.silhouettesNear,
    stage.art.silhouette,
    extras.timeSec,
    parallaxNear,
    0.8,
    lightSources,
  );

  if (stage.heroLandmark.kind === "heroLanternGantry") {
    drawConduitCaptureBeat(ctx, camera, { x: stage.heroLandmark.x, y: stage.heroLandmark.y }, extras.timeSec);
  }

  if (extras.echoT !== null) {
    drawMemoryEcho(ctx, camera, stage, state.moth.pos, extras.echoT, extras.awakenT);
  }

  if (isEnding) {
    // The structures light up too, not just the plants — the final bloom's
    // wash is what lets the player see, for the first time, what this place
    // used to be.
    const wakingPositions: Vec2[] = [
      ...stage.silhouettesNear,
      ...stage.silhouettesFar,
      ...stage.structures.map((s) => ({ x: s.x, y: s.y })),
    ];
    drawEmberBlooms(ctx, camera, wakingPositions, wash, extras.timeSec);
  }

  if (stage.art.water) {
    drawWaterReflection(ctx, camera, stage, state.moth.pos, state.light, extras.timeSec, viewWidth, viewHeight);
  }

  drawHazards(ctx, camera, stage, state.moth.pos, extras, extinguish);

  const openT = isEnding ? Math.min(1, extras.phaseTimer / 2.2) : 1;
  drawFlower(ctx, camera, stage, extras, openT);

  for (let i = 0; i < stage.fragments.length; i++) {
    if (!extras.fragmentsCollected[i]) drawFragment(ctx, camera, stage.fragments[i], extras.timeSec, i);
  }

  if (state.light && state.phase === "playing") drawLight(ctx, camera, state.light, extras.timeSec);

  const fragmentGlowBoost = extras.fragmentsCollected.filter(Boolean).length;
  drawMothTrail(ctx, camera, extras.trail, 1 + fragmentGlowBoost * 0.22);

  const danger = state.phase === "playing" ? maxHazardProximity(state.moth.pos, stage.hazards) : 0;
  drawDangerShimmer(ctx, camera, state.moth.pos, extras.timeSec, danger);

  const moonlit = isEnding && extras.phaseTimer >= 4;
  drawMoth(ctx, camera, state, extras.timeSec, fragmentGlowBoost, moonlit);

  if (isEnding) {
    const sources = [stage.flower.pos, ...stage.structures.slice(0, 4).map((s) => ({ x: s.x, y: s.y }))];
    drawLightMotes(ctx, camera, sources, extras.phaseTimer);
    drawLightReturn(
      ctx,
      camera,
      stage.hazards.map((h) => h.pos),
      stage.flower.pos,
      extras.phaseTimer,
    );
  }

  drawForegroundFrame(ctx, viewWidth, viewHeight, stage.art.frame, stage.art.silhouette, extras.timeSec);
  drawVignette(ctx, viewWidth, viewHeight);

  if (isEnding) drawEndingMontage(ctx, viewWidth, viewHeight, extras.phaseTimer, extras.timeSec);

  if (extras.transition) drawTransitionEffect(ctx, viewWidth, viewHeight, extras.transition, camera, stage);

  if (state.phase === "lost") drawDeathOverlay(ctx, viewWidth, viewHeight, extras.phaseTimer);
  else if (state.phase === "won") drawWinOverlay(ctx, viewWidth, viewHeight, extras.phaseTimer);
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

// A cheap stand-in for real per-pixel lighting: draws a small additive glow
// offset toward each nearby light source from an object's own position, so
// the side of a plant or a stone facing the light reads slightly brighter —
// "the light touches this thing" without ever clipping to its silhouette.
function applyLightKiss(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  worldPos: Vec2,
  worldSize: number,
  lights: LightSource[],
) {
  if (lights.length === 0) return;
  const p = worldToScreen(camera, worldPos);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const light of lights) {
    const dx = light.pos.x - worldPos.x;
    const dy = light.pos.y - worldPos.y;
    const dist = Math.hypot(dx, dy);
    const reach = light.radius + worldSize;
    if (dist > reach || dist < 0.001) continue;
    const t = 1 - dist / reach;
    if (t <= 0) continue;
    const nx = dx / dist;
    const ny = dy / dist;
    const offset = worldSize * 0.35 * camera.scale;
    const kissPos = { x: p.x + nx * offset, y: p.y + ny * offset };
    const kissRadius = worldSize * 0.9 * camera.scale * (0.4 + t * 0.6);
    glow(ctx, kissPos, kissRadius, `rgba(${light.rgb},${(t * 0.35).toFixed(3)})`);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sky, atmosphere, and the two vector-motif scenery layers
// ---------------------------------------------------------------------------

// A fixed field of twinkling points above the horizon — position is a hash
// of the star's own index (same "pure function of index + timeSec, no
// stored state" idiom as drawAtmosphere's motes), so the field never
// reshuffles frame to frame or stage to stage. Drawn before the moon so the
// moon's opaque disc naturally sits in front of any star behind it.
function drawStarfield(ctx: CanvasRenderingContext2D, viewWidth: number, horizonY: number, timeSec: number) {
  const count = 46;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const hx = Math.sin(i * 12.9898) * 43758.5453;
    const fx = hx - Math.floor(hx);
    const hy = Math.sin(i * 78.233) * 12543.123;
    const fy = hy - Math.floor(hy);
    const x = fx * viewWidth;
    const y = fy * horizonY * 0.92;
    const twinkle = 0.4 + 0.4 * Math.sin(timeSec * (0.5 + (i % 7) * 0.13) + i * 2.1);
    const r = 0.6 + (i % 3) * 0.5;
    ctx.globalAlpha = Math.max(0, Math.min(1, twinkle));
    ctx.fillStyle = `rgba(${RIM_LIGHT_RGB},1)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// A soft radial darkening toward the screen edges, drawn once as the very
// last screen-space pass — gives the frame a curated, composed-shot edge
// instead of a flat rectangle. Purely cosmetic, no gameplay meaning.
function drawVignette(ctx: CanvasRenderingContext2D, viewWidth: number, viewHeight: number) {
  const cx = viewWidth / 2;
  const cy = viewHeight / 2;
  const inner = Math.min(viewWidth, viewHeight) * 0.38;
  const outer = Math.hypot(cx, cy);
  const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
}

// The moon's own screen-space position/radius, shared by drawSkyAndGround and
// drawWaterReflection's mirror of it — so the water always reflects the same
// moon actually drawn in the sky rather than a second hand-tuned guess.
// Also the moon-progression tuning for item 7: each stage's moon reads as a
// step further into the journey, not a fixed decoration.
function moonScreenPos(
  viewWidth: number,
  viewHeight: number,
  art: StageConfig["art"],
): { x: number; y: number; r: number } | null {
  if (!art.moonVisibility) return null;
  const full = art.moonVisibility === "full";
  const near = art.moonVisibility === "near";
  const obscured = art.moonVisibility === "obscured";
  const x = viewWidth * (full ? 0.66 : near ? 0.78 : 0.85);
  const y = viewHeight * (full ? 0.27 : near ? 0.17 : 0.13);
  const r = Math.min(viewWidth, viewHeight) * (full ? 0.19 : near ? 0.11 : obscured ? 0.035 : 0.045);
  return { x, y, r };
}

// Full-viewport gradient backdrop (not world-locked — it's the sky, not a
// stage object) down to a fixed world-space horizon, below which a distinct,
// noticeably darker ground/water band gives every stage an actual floor to
// stand on; an optional moon for the final stage (a large, detailed one once
// the story reaches the sanctuary); and the ending's slow world-wide relight
// (`wash`, 0 outside the ending).
function drawSkyAndGround(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewWidth: number,
  viewHeight: number,
  art: StageConfig["art"],
  wash: number,
  timeSec: number,
  awakenT = 0,
) {
  const horizonY = HORIZON_WORLD_Y * camera.scale + camera.offsetY;

  const gradient = ctx.createLinearGradient(0, 0, 0, horizonY);
  gradient.addColorStop(0, art.skyTop);
  gradient.addColorStop(1, art.skyBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewWidth, Math.max(0, horizonY));

  drawStarfield(ctx, viewWidth, horizonY, timeSec);

  const ground = ctx.createLinearGradient(0, horizonY, 0, viewHeight);
  ground.addColorStop(0, art.groundTop);
  ground.addColorStop(1, art.groundBottom);
  ctx.fillStyle = ground;
  ctx.fillRect(0, Math.max(0, horizonY), viewWidth, Math.max(0, viewHeight - horizonY));

  const moon = moonScreenPos(viewWidth, viewHeight, art);
  if (moon) {
    const { x: mx, y: my, r: mr } = moon;
    const full = art.moonVisibility === "full";
    const near = art.moonVisibility === "near";
    const obscured = art.moonVisibility === "obscured";
    const discAlpha = full ? 0.92 : near ? 0.8 : obscured ? 0.25 : 0.5;
    // The old network waking up as fragments come home reads on the moon
    // too, faintly — mainly visible on The Ruins and the sanctuary itself.
    const haloAlpha = (full ? 0.34 : near ? 0.26 : obscured ? 0.1 : 0.14) + awakenT * 0.06;

    ctx.globalCompositeOperation = "lighter";
    glow(ctx, { x: mx, y: my }, mr * 3.4, `rgba(210,225,255,${haloAlpha.toFixed(3)})`);
    ctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = `rgba(235,240,255,${discAlpha})`;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    if (full) {
      ctx.fillStyle = "rgba(200,210,230,0.35)";
      ctx.beginPath();
      ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx + mr * 0.1, my - mr * 0.35, mr * 0.1, 0, Math.PI * 2);
      ctx.fill();
    } else if (obscured) {
      // Stage 2's moon: mostly blocked by the sanctuary's own infrastructure
      // rather than merely dim — a few dark occluding bars across the disc.
      ctx.fillStyle = "rgba(10,8,6,0.55)";
      for (let i = 0; i < 3; i++) {
        const by = my - mr * 0.7 + i * mr * 0.7;
        ctx.fillRect(mx - mr * 1.1, by, mr * 2.2, mr * 0.22);
      }
    }
    ctx.restore();

    if (full) {
      const cloudX = mx + Math.sin(timeSec * 0.05) * mr * 0.6 - mr * 0.9;
      ctx.fillStyle = "rgba(10,12,22,0.18)";
      ctx.beginPath();
      ctx.ellipse(cloudX, my + mr * 0.15, mr * 1.1, mr * 0.32, 0.1, 0, Math.PI * 2);
      ctx.fill();
    } else if (near) {
      // A thin drift of haze across the disc — glimpsed through The Ruins'
      // broken roof, not yet the open sky the sanctuary sees.
      ctx.fillStyle = "rgba(20,20,28,0.22)";
      ctx.beginPath();
      ctx.ellipse(mx, my + mr * 0.3, mr * 1.3, mr * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (wash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(wash * 0.2).toFixed(3)})`;
    ctx.fillRect(0, 0, viewWidth, viewHeight);
  }
}

// Stage 1 only: a soft shaft of moonlight through the glasshouse roof's
// broken pane, anchored to that gap rather than floating free — the same
// beam a real skylight would cast.
function drawSkylightBeam(ctx: CanvasRenderingContext2D, camera: Camera, timeSec: number) {
  const top = worldToScreen(camera, { x: 460, y: 40 });
  const topWide = worldToScreen(camera, { x: 560, y: 40 });
  const bottom = worldToScreen(camera, { x: 300, y: 640 });
  const bottomWide = worldToScreen(camera, { x: 460, y: 640 });
  const sway = Math.sin(timeSec * 0.15) * 6;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  ctx.moveTo(top.x + sway, top.y);
  ctx.lineTo(topWide.x + sway, topWide.y);
  ctx.lineTo(bottomWide.x, bottomWide.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.closePath();
  const beam = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  beam.addColorStop(0, "rgba(220,235,255,0.22)");
  beam.addColorStop(1, "rgba(220,235,255,0)");
  ctx.fillStyle = beam;
  ctx.fill();
  ctx.restore();
}

// The one giant background silhouette per stage (see StageConfig.heroLandmark
// in state.ts) — drawn far larger than anything in `structures`, at reduced
// alpha so it reads as a distant landmark rather than a competing
// foreground object, tinted by the stage's own silhouette color like every
// other layer. This is the fix for "small corner props can't carry a
// stage's story" — one unmistakable shape per stage instead.
function drawHeroLandmark(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shape: StructureShape,
  color: string,
  timeSec: number,
  parallax: Vec2,
  awakenT: number,
) {
  const base = worldToScreen(camera, { x: shape.x, y: shape.y });
  const worldSize = 90 * shape.scale;
  const u = worldSize * camera.scale;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.translate(base.x + parallax.x, base.y + parallax.y);
  if (shape.flip) ctx.scale(-1, 1);
  if (shape.tilt) ctx.rotate(shape.tilt);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (shape.kind) {
    case "heroDomeIntact":
      drawHeroDomeMotif(ctx, u, timeSec, {});
      break;
    case "heroDomeSunken":
      drawHeroDomeMotif(ctx, u, timeSec, { submerge: 0.4 });
      break;
    case "heroDomeBroken":
      drawHeroDomeMotif(ctx, u, timeSec, { broken: true });
      break;
    case "heroLanternGantry":
      drawHeroLanternGantryMotif(ctx, u, timeSec);
      break;
    case "heroMural":
      drawHeroMuralMotif(ctx, u, timeSec, awakenT);
      break;
    default:
      break;
  }
  ctx.restore();

  if (awakenT > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, base, u * 0.9, `rgba(210,222,255,${(awakenT * 0.3).toFixed(3)})`);
    ctx.restore();
  }
}

// The sanctuary dome at hero scale — whole (The Garden, The Moon Flower),
// half-submerged with a translucent waterline (The Marsh, the direct answer
// to what the flood did), or torn open with a gap in its roofline (The
// Ruins) — three readings of the same silhouette so every stage's landmark
// visibly answers the others instead of inventing a new shape each time.
function drawHeroDomeMotif(
  ctx: CanvasRenderingContext2D,
  u: number,
  timeSec: number,
  opts: { submerge?: number; broken?: boolean },
) {
  const submerge = opts.submerge ?? 0;
  const broken = opts.broken ?? false;

  ctx.save();
  // The dome's full outer silhouette, filled solid, so its scale actually
  // reads as one dark mass instead of a thin outline dissolving into the
  // sky — the torn roofline (below) is drawn as a highlighted crack on top
  // of this same solid shape rather than a literal hole in the fill.
  ctx.beginPath();
  ctx.moveTo(-u * 0.75, u * 0.55);
  ctx.lineTo(-u * 0.75, -u * 0.1);
  ctx.quadraticCurveTo(-u * 0.75, -u * 1.05, 0, -u * 1.15);
  ctx.quadraticCurveTo(u * 0.75, -u * 1.05, u * 0.75, -u * 0.1);
  ctx.lineTo(u * 0.75, u * 0.55);
  ctx.closePath();
  ctx.fill();

  withRimLight(ctx, 0.5, () => {
    ctx.lineWidth = Math.max(1, u * 0.025);
    ctx.beginPath();
    ctx.moveTo(-u * 0.75, -u * 0.1);
    ctx.quadraticCurveTo(-u * 0.75, -u * 1.05, 0, -u * 1.15);
    if (!broken) ctx.quadraticCurveTo(u * 0.75, -u * 1.05, u * 0.75, -u * 0.1);
    ctx.stroke();
  });

  withRimLight(ctx, 0.22, () => {
    ctx.lineWidth = Math.max(1, u * 0.02);
    for (let i = -2; i <= 2; i++) {
      if (broken && i >= 0) continue; // the torn gap swallows these ribs
      const y = -u * 0.5 + i * u * 0.28;
      const half = u * 0.72 * (1 - Math.abs(i) * 0.04);
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
    }
  });

  if (broken) {
    // The torn gap itself: a jagged crack rendered as a bright highlighted
    // edge cutting across the solid fill, rather than an actual hole — the
    // dome stays one legible dark mass even where its roofline is broken.
    withRimLight(ctx, 0.55, () => {
      ctx.lineWidth = Math.max(1, u * 0.03);
      ctx.beginPath();
      ctx.moveTo(u * 0.05, -u * 1.02);
      ctx.lineTo(u * 0.22, -u * 0.72);
      ctx.lineTo(u * 0.4, -u * 0.85);
      ctx.lineTo(u * 0.6, -u * 0.5);
      ctx.stroke();
    });
  }
  ctx.restore();

  if (submerge > 0) {
    // Clip the lower `submerge` fraction of the dome under a translucent
    // water band, with a faint ripple line at the waterline — the same
    // silhouette, just half swallowed, rather than a shorter dome.
    const waterY = u * 0.55 - u * 1.7 * submerge;
    ctx.save();
    ctx.fillStyle = "rgba(35,65,75,0.4)";
    ctx.fillRect(-u * 0.9, waterY, u * 1.8, u * 1.5);
    ctx.restore();

    const wobble = Math.sin(timeSec * 1.1) * u * 0.03;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(180,210,225,0.3)";
    ctx.lineWidth = Math.max(1, u * 0.02);
    ctx.beginPath();
    ctx.moveTo(-u * 0.85, waterY + wobble);
    ctx.lineTo(u * 0.85, waterY - wobble);
    ctx.stroke();
    ctx.restore();
  }
}

// A tall iron gantry rack lined with small unlit lantern cages — Stage 2's
// hoarding system made visually literal at hero scale, one giant version of
// the same cage hardware the lamp posts carry.
function drawHeroLanternGantryMotif(ctx: CanvasRenderingContext2D, u: number, timeSec: number) {
  ctx.save();
  // The two rails as real filled bars, not thin ruled lines — the gantry's
  // main mass, now dark and solid enough to actually read against the sky.
  const railW = u * 0.09;
  ctx.fillRect(-u * 0.55 - railW / 2, -u * 1.0, railW, u * 1.9);
  ctx.fillRect(u * 0.55 - railW / 2, -u * 1.0, railW, u * 1.9);

  withRimLight(ctx, 0.3, () => {
    ctx.lineWidth = Math.max(1, u * 0.02);
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const y = -u * 1.0 + (i / rows) * u * 1.9;
      ctx.beginPath();
      ctx.moveTo(-u * 0.55, y);
      ctx.lineTo(u * 0.55, y);
      ctx.stroke();
    }
  });

  for (let i = 0; i < 3; i++) {
    const y = -u * 0.55 + i * u * 0.5;
    ctx.fillRect(-u * 0.12, y, u * 0.24, u * 0.32);
    withRimLight(ctx, 0.45, () => {
      ctx.lineWidth = Math.max(1, u * 0.02);
      ctx.strokeRect(-u * 0.12, y, u * 0.24, u * 0.32);
    });
    ctx.save();
    ctx.translate(0, y + u * 0.16);
    drawCrescentMark(ctx, u * 0.06, 0.18 + 0.05 * Math.sin(timeSec * 0.6 + i));
    ctx.restore();
  }
  ctx.restore();
}

// The Ruins' hero landmark: a ruined pictographic mural, split by a crack
// down the middle. The left panel carries the old closed cycle — crescent,
// petal, moth, garden — in a ring that brightens continuously with
// `awakenT` as fragments come home, since this is the stage's actual story
// reveal rather than a shape that only changes meaning through text. The
// right panel shows the same moonlight arrow diverted into a cage by later
// ironwork bolted onto the older stone — static, never brightens, since
// it's the interruption being read, not the memory being restored.
function drawHeroMuralMotif(ctx: CanvasRenderingContext2D, u: number, timeSec: number, awakenT: number) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-u * 0.95, u * 0.85);
  ctx.lineTo(-u * 0.95, -u * 0.55);
  ctx.quadraticCurveTo(-u * 0.95, -u * 0.9, -u * 0.6, -u * 0.95);
  ctx.lineTo(u * 0.6, -u * 0.95);
  ctx.quadraticCurveTo(u * 0.95, -u * 0.9, u * 0.95, -u * 0.55);
  ctx.lineTo(u * 0.95, u * 0.85);
  ctx.closePath();
  ctx.fill();

  withRimLight(ctx, 0.4, () => {
    ctx.lineWidth = Math.max(1, u * 0.025);
    ctx.stroke();
  });

  // The crack down the middle — literally where the story splits in two.
  withRimLight(ctx, 0.3, () => {
    ctx.lineWidth = Math.max(1, u * 0.02);
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.9);
    ctx.lineTo(-u * 0.05, -u * 0.4);
    ctx.lineTo(u * 0.05, u * 0.1);
    ctx.lineTo(-u * 0.03, u * 0.8);
    ctx.stroke();
  });

  // Left panel: the old, closed cycle — four glyphs in a ring joined by
  // curved arcs, brightness tied directly to fragments collected this stage.
  const ringAlpha = 0.2 + awakenT * 0.55;
  const cx = -u * 0.42;
  const cy = -u * 0.05;
  const ringR = u * 0.36;
  withRimLight(ctx, ringAlpha, () => {
    ctx.lineWidth = Math.max(1, u * 0.02);
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / 4) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, a0 + 0.25, a1 - 0.25);
      ctx.stroke();
    }
  });
  const glyphs: Array<"crescent" | "petal" | "moth" | "garden"> = ["crescent", "petal", "moth", "garden"];
  for (let i = 0; i < glyphs.length; i++) {
    const a = (i / glyphs.length) * Math.PI * 2 - Math.PI / 2;
    const gx = cx + Math.cos(a) * ringR;
    const gy = cy + Math.sin(a) * ringR;
    ctx.save();
    ctx.translate(gx, gy);
    const glyph = glyphs[i];
    if (glyph === "crescent") {
      drawCrescentMark(ctx, u * 0.1, 0.3 + awakenT * 0.5);
    } else {
      withRimLight(ctx, ringAlpha, () => {
        ctx.lineWidth = Math.max(1, u * 0.018);
        if (glyph === "petal") {
          ctx.save();
          ctx.scale(u * 0.08, u * 0.14);
          ctx.stroke(PETAL_PATH);
          ctx.restore();
        } else if (glyph === "moth") {
          ctx.beginPath();
          ctx.moveTo(-u * 0.08, u * 0.06);
          ctx.lineTo(0, -u * 0.08);
          ctx.lineTo(u * 0.08, u * 0.06);
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, u * 0.07, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  // Right panel: the diverted moonlight — a dashed arrow flowing toward a
  // cage glyph, interrupted right at the seam where a visibly different,
  // later-bolted ironwork strip crosses it.
  withRimLight(ctx, 0.32, () => {
    ctx.lineWidth = Math.max(1, u * 0.022);
    ctx.setLineDash([u * 0.05, u * 0.05]);
    ctx.beginPath();
    ctx.moveTo(u * 0.1, -u * 0.05);
    ctx.lineTo(u * 0.55, -u * 0.05);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(u * 0.5, -u * 0.12);
    ctx.lineTo(u * 0.6, -u * 0.05);
    ctx.lineTo(u * 0.5, u * 0.02);
    ctx.stroke();
  });
  ctx.fillRect(u * 0.68, -u * 0.16, u * 0.2, u * 0.22);
  withRimLight(ctx, 0.3, () => {
    ctx.strokeRect(u * 0.68, -u * 0.16, u * 0.2, u * 0.22);
  });
  withRimLight(ctx, 0.22, () => {
    for (let i = 0; i < 3; i++) {
      const rx = u * 0.05 + i * u * 0.02;
      ctx.beginPath();
      ctx.arc(rx, -u * 0.45, u * 0.015, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Once every fragment this stage asks for is home, the ring's own beam
  // reaches off the mural's edge, angled toward where the journey heads
  // next — the mural's own answer, not a caption.
  if (awakenT >= 0.999) {
    const pulse = 0.7 + 0.3 * Math.sin(timeSec * 1.4);
    withRimLight(ctx, 0.5 * pulse, () => {
      ctx.lineWidth = Math.max(1, u * 0.03);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(u * 1.3, -u * 0.75);
      ctx.stroke();
    });
  }
  ctx.restore();
}

// The Lanterns' own answer to "the light was kept" made visible, ambiently
// — no fragments gate this stage, so nothing here is triggered by
// collection: a conduit running down from the sky into the gantry's cage,
// with motes traveling it and cooling from moonlight silver to trapped
// amber as they near the cage, plus a second, visibly dead conduit
// continuing past the gantry toward where the flower stands — "this used to
// go further" without narration. Drawn only when the stage's hero landmark
// is the gantry itself, so no new state.ts discriminator is needed.
function drawConduitCaptureBeat(ctx: CanvasRenderingContext2D, camera: Camera, heroPos: Vec2, timeSec: number) {
  const topWorld = { x: heroPos.x, y: -40 };
  const cageWorld = { x: heroPos.x, y: heroPos.y + 40 };
  const deadEndWorld = { x: heroPos.x + 220, y: 720 };

  const top = worldToScreen(camera, topWorld);
  const cage = worldToScreen(camera, cageWorld);
  const deadEnd = worldToScreen(camera, deadEndWorld);

  ctx.save();
  ctx.strokeStyle = "rgba(210,222,255,0.12)";
  ctx.lineWidth = Math.max(1, 2 * camera.scale);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(cage.x, cage.y);
  ctx.stroke();

  // The dead conduit past the gantry — static, dark, never lit, so its mere
  // presence reads as "this used to continue somewhere" without implying it
  // still works.
  ctx.strokeStyle = "rgba(120,110,100,0.25)";
  ctx.setLineDash([6 * camera.scale, 8 * camera.scale]);
  ctx.beginPath();
  ctx.moveTo(cage.x, cage.y);
  ctx.lineTo(deadEnd.x, deadEnd.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalCompositeOperation = "lighter";
  const count = 4;
  for (let i = 0; i < count; i++) {
    const cycle = 3.4;
    const localT = ((((timeSec + (i * cycle) / count) % cycle) + cycle) % cycle) / cycle;
    const x = topWorld.x + (cageWorld.x - topWorld.x) * localT;
    const y = topWorld.y + (cageWorld.y - topWorld.y) * localT;
    const p = worldToScreen(camera, { x, y });
    const rgb = blendChannels(MOONLIGHT_RGB, [255, 170, 90], localT);
    const alpha = 0.75 * Math.sin(Math.PI * localT);
    glow(ctx, p, 8 * camera.scale, `rgba(${rgb},${Math.max(0, alpha).toFixed(3)})`);
  }
  ctx.restore();
}

// A hand-authored array of fixed shapes (see state.ts's `silhouettes()`
// helper), each dispatched by `kind` to a distinct bezier-drawn plant
// motif — fern, reed, vine, dead branch, grass tuft, or the generic leaf
// cluster — instead of one repeated ellipse blob. `phase` staggers their
// gentle sway so a whole layer doesn't breathe in lockstep. `lights`, when
// given, kisses the near layer with whatever light sources are active this
// frame.
function drawSilhouetteLayer(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shapes: SilhouetteShape[],
  color: string,
  timeSec: number,
  parallax: Vec2,
  alpha: number,
  lights: LightSource[] = [],
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const shape of shapes) {
    const base = worldToScreen(camera, { x: shape.x, y: shape.y });
    const w = shape.w * camera.scale;
    const h = shape.h * camera.scale;
    const sway = Math.sin(timeSec * 0.4 + shape.phase) * 0.06;
    ctx.save();
    ctx.translate(base.x + parallax.x, base.y + parallax.y);
    ctx.rotate(sway);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    switch (shape.kind) {
      case "fern":
        drawFernMotif(ctx, w, h);
        break;
      case "reed":
        drawReedMotif(ctx, w, h);
        break;
      case "vine":
        drawVineMotif(ctx, w, h);
        break;
      case "deadBranch":
        drawDeadBranchMotif(ctx, w, h);
        break;
      case "grassTuft":
        drawGrassTuftMotif(ctx, w, h);
        break;
      default:
        drawLeafClusterMotif(ctx, w, h);
        break;
    }
    ctx.restore();
    if (lights.length > 0) {
      applyLightKiss(ctx, camera, { x: shape.x, y: shape.y }, Math.max(shape.w, shape.h) * 0.5, lights);
    }
  }
  ctx.restore();
}

// Four leaves fanned from a common base at varying angles/lengths — the
// default plant silhouette when a stage hasn't named a more specific kind.
function drawLeafClusterMotif(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const angles = [-0.55, -0.18, 0.18, 0.55];
  for (const a of angles) {
    ctx.save();
    ctx.rotate(a);
    const len = h * (0.7 + Math.abs(a) * 0.3);
    ctx.scale(w * 0.32, len);
    ctx.fill(LEAF_PATH);
    ctx.restore();
  }
}

// A curved central stem with small frond leaflets alternating down its
// length, shrinking toward the tip.
function drawFernMotif(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, w * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w * 0.05, -h * 0.5, w * 0.02, -h);
  ctx.stroke();
  const fronds = 6;
  for (let i = 0; i < fronds; i++) {
    const t = i / fronds;
    const side = i % 2 === 0 ? 1 : -1;
    const y = -t * h;
    const size = w * 0.22 * (1 - t * 0.6);
    ctx.save();
    ctx.translate(0, y);
    ctx.rotate(side * (0.9 - t * 0.3));
    ctx.scale(size, size * 1.6);
    ctx.fill(LEAF_PATH);
    ctx.restore();
  }
  ctx.restore();
}

// Three thin curved blades — marsh reeds along the shoreline.
function drawReedMotif(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, w * 0.05);
  for (let i = 0; i < 3; i++) {
    const t = (i - 1) * 0.3;
    ctx.beginPath();
    ctx.moveTo(t * w, 0);
    ctx.quadraticCurveTo(t * w + w * 0.25, -h * 0.5, t * w * 1.5, -h * (0.85 + Math.abs(t) * 0.2));
    ctx.stroke();
  }
  ctx.restore();
}

// Two wavy vine strands with leaf nodes — see drawVineStrand.
function drawVineMotif(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawVineStrand(ctx, -w * 0.2, 0, w * 0.35, -h * 0.9, w * 0.14);
  drawVineStrand(ctx, w * 0.15, 0, -w * 0.3, -h * 0.7, w * 0.12);
}

// A smaller, background-scale version of the dead tree's recursive
// branching, for background scatter rather than a named set-piece.
function drawDeadBranchMotif(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, w * 0.05);
  function branch(x: number, y: number, angle: number, len: number, depth: number) {
    if (depth <= 0 || len < h * 0.08) return;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    branch(x2, y2, angle - 0.45, len * 0.65, depth - 1);
    branch(x2, y2, angle + 0.45, len * 0.65, depth - 1);
  }
  branch(0, 0, -Math.PI / 2, h * 0.6, 3);
  ctx.restore();
}

// Five short leaning blade strokes — low grass filler between larger plants.
function drawGrassTuftMotif(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, w * 0.04);
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    ctx.beginPath();
    ctx.moveTo(t * w * 0.3, 0);
    ctx.quadraticCurveTo(t * w * 0.5, -h * 0.4, t * w * 0.8, -h * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

// A wavy vine strand with a handful of leaf nodes climbing it — shared by
// the plant-layer "vine" motif and as a decorative accent on the iron gate
// and ruin arch structures. Uses its own moss-green leaf fill regardless of
// the caller's palette (vines read the same everywhere), but relies on the
// caller having set `strokeStyle` for the strand itself.
function drawVineStrand(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  leafSize: number,
) {
  ctx.save();
  ctx.lineWidth = Math.max(1, leafSize * 0.25);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const midX = x0 + dx * 0.5 + leafSize * 0.6;
  const midY = y0 + dy * 0.5;
  const endX = x0 + dx;
  const endY = y0 + dy;
  ctx.quadraticCurveTo(midX, midY, endX, endY);
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = "rgba(50,75,45,0.6)";
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const lx = x0 + dx * t + Math.sin(t * Math.PI) * leafSize * 0.6;
    const ly = y0 + dy * t;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate((i % 2 === 0 ? 1 : -1) * 0.7);
    ctx.scale(leafSize * 0.5, leafSize * 0.8);
    ctx.fill(LEAF_PATH);
    ctx.restore();
  }
  ctx.restore();
  ctx.restore();
}

// Drifting fog/pollen/spore motes — position is a pure function of elapsed
// time and a fixed per-mote index (same "no stored mutable state, no RNG"
// idiom hazard drift already uses), wrapping across WORLD bounds. Dim by
// default; strongly boosted within the player's light so particles only
// clearly show up inside the light field.
function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  timeSec: number,
  color: string,
  lightWorldPos: Vec2 | null,
) {
  const count = 36;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const speed = 6 + (i % 5) * 3;
    const driftY = 8 + (i % 4) * 6;
    const baseX = (i * 137) % WORLD.width;
    const baseY = (i * 71) % WORLD.height;
    const x = (((baseX + timeSec * speed) % WORLD.width) + WORLD.width) % WORLD.width;
    const y = (((baseY + Math.sin(timeSec * 0.5 + i) * driftY) % WORLD.height) + WORLD.height) % WORLD.height;
    const p = worldToScreen(camera, { x, y });
    const r = (1.3 + (i % 3) * 0.8) * camera.scale;
    let alpha = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(timeSec * 0.8 + i * 1.7));
    if (lightWorldPos) {
      const dist = Math.hypot(x - lightWorldPos.x, y - lightWorldPos.y);
      const t = Math.max(0, 1 - dist / 220);
      alpha += t * t * 0.85;
    }
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The larger, hand-placed set-pieces (see state.ts's StructureShape) that
// make a stage read as a specific place — a glasshouse arch, a lamp post, a
// collapsed archway — each dispatched by `kind` to its own motif function
// built from Canvas bezier/quadratic curves. Drawn at mid-parallax, between
// the far and near plant-silhouette layers, and kissed by whatever light
// sources are active this frame.
function drawStructureLayer(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shapes: StructureShape[],
  color: string,
  timeSec: number,
  parallax: Vec2,
  alpha: number,
  lights: LightSource[],
  awakenT: number = 0,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const shape of shapes) {
    const base = worldToScreen(camera, { x: shape.x, y: shape.y });
    const worldSize = 90 * shape.scale;
    const u = worldSize * camera.scale;
    ctx.save();
    ctx.translate(base.x + parallax.x, base.y + parallax.y);
    if (shape.flip) ctx.scale(-1, 1);
    if (shape.tilt) ctx.rotate(shape.tilt);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    switch (shape.kind) {
      case "glasshouseArch":
        drawGlasshouseArchMotif(ctx, u);
        break;
      case "brokenGlassPane":
        drawBrokenGlassPaneMotif(ctx, u, timeSec);
        break;
      case "keeperStatue":
        drawKeeperStatueMotif(ctx, u);
        break;
      case "lampPost":
        drawLampPostMotif(ctx, u);
        break;
      case "ironGate":
        drawIronGateMotif(ctx, u, color);
        break;
      case "irrigationPump":
        drawIrrigationPumpMotif(ctx, u, timeSec);
        break;
      case "deadTree":
        drawDeadTreeMotif(ctx, u);
        break;
      case "cattailCluster":
        drawCattailClusterMotif(ctx, u, timeSec);
        break;
      case "ruinArch":
        drawRuinArchMotif(ctx, u, color);
        break;
      case "brokenColumn":
        drawBrokenColumnMotif(ctx, u);
        break;
      case "statueFragment":
        drawStatueFragmentMotif(ctx, u);
        break;
      case "sanctuaryAltar":
        drawSanctuaryAltarMotif(ctx, u, timeSec);
        break;
    }
    ctx.restore();
    applyLightKiss(ctx, camera, { x: shape.x, y: shape.y }, worldSize, lights);
    if (awakenT > 0.01) applyAwakenGlow(ctx, camera, { x: shape.x, y: shape.y }, worldSize, awakenT);
  }
  ctx.restore();
}

// The same additive-glow trick as applyLightKiss, but centered on the object
// (not offset toward a light source) and scaled by how much of the current
// stage's fragments have been collected — the ruins/moon-markings visibly
// waking as the player makes progress, not just the moth glowing brighter.
function applyAwakenGlow(ctx: CanvasRenderingContext2D, camera: Camera, worldPos: Vec2, worldSize: number, awakenT: number) {
  const p = worldToScreen(camera, worldPos);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, worldSize * 1.1 * camera.scale, `rgba(210,222,255,${(awakenT * 0.22).toFixed(3)})`);
  ctx.restore();
}

// A ruined greenhouse arch: two legs rising into a rounded top, cross-brace
// panes with one deliberately missing — the gap carries a faint crescent
// gleam rather than being simply empty, the first sighting of the motif
// that recurs through every later stage's architecture — and a rust streak
// down one leg.
function drawGlasshouseArchMotif(ctx: CanvasRenderingContext2D, u: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.045);
  ctx.beginPath();
  ctx.moveTo(-u * 0.55, u * 0.9);
  ctx.lineTo(-u * 0.55, -u * 0.2);
  ctx.quadraticCurveTo(-u * 0.55, -u * 0.95, 0, -u * 1.0);
  ctx.quadraticCurveTo(u * 0.55, -u * 0.95, u * 0.55, -u * 0.2);
  ctx.lineTo(u * 0.55, u * 0.9);
  ctx.closePath();
  ctx.fill();
  withRimLight(ctx, 0.5, () => {
    ctx.beginPath();
    ctx.moveTo(-u * 0.55, -u * 0.2);
    ctx.quadraticCurveTo(-u * 0.55, -u * 0.95, 0, -u * 1.0);
    ctx.quadraticCurveTo(u * 0.55, -u * 0.95, u * 0.55, -u * 0.2);
    ctx.stroke();
  });
  for (let i = -2; i <= 2; i++) {
    const y = -u * 0.15 - i * u * 0.28;
    if (i === 1) {
      ctx.save();
      ctx.translate(0, y);
      drawCrescentMark(ctx, u * 0.12, 0.22);
      ctx.restore();
      continue; // the missing pane
    }
    withRimLight(ctx, 0.3, () => {
      ctx.beginPath();
      ctx.moveTo(-u * 0.55, y);
      ctx.lineTo(u * 0.55, y);
      ctx.stroke();
    });
  }
  withRimLight(ctx, 0.35, () => {
    ctx.beginPath();
    ctx.moveTo(-u * 0.5, u * 0.2);
    ctx.quadraticCurveTo(-u * 0.42, u * 0.5, -u * 0.48, u * 0.85);
    ctx.stroke();
  });
  ctx.restore();
}

// A dangling jagged glass shard hanging from a broken pane, swaying gently.
function drawBrokenGlassPaneMotif(ctx: CanvasRenderingContext2D, u: number, timeSec: number) {
  const sway = Math.sin(timeSec * 0.8) * 0.04;
  ctx.save();
  ctx.rotate(sway);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(-u * 0.2, -u * 0.1);
  ctx.lineTo(u * 0.05, u * 0.05);
  ctx.lineTo(u * 0.25, -u * 0.5);
  ctx.lineTo(-u * 0.05, -u * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(u * 0.1, -u * 0.05);
  ctx.lineTo(u * 0.32, u * 0.15);
  ctx.lineTo(u * 0.42, -u * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// A tapered lamp post with a base flare and a cross-arm carrying an unlit
// cage head — the dead lamps standing beside the one live hazard. The cage
// carries the same faint crescent inlay as the live lantern's — the same
// hardware, just not burning right now — which is what lets its toppled,
// half-submerged reappearance in The Marsh read as this exact object.
function drawLampPostMotif(ctx: CanvasRenderingContext2D, u: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  ctx.moveTo(-u * 0.06, u * 0.9);
  ctx.lineTo(-u * 0.03, -u * 0.7);
  ctx.lineTo(u * 0.03, -u * 0.7);
  ctx.lineTo(u * 0.06, u * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, u * 0.9, u * 0.14, u * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-u * 0.2, -u * 0.7);
  ctx.lineTo(u * 0.2, -u * 0.7);
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.strokeRect(-u * 0.1, -u * 0.95, u * 0.2, u * 0.22);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(0, -u * 0.84);
  drawCrescentMark(ctx, u * 0.08, 0.2);
  ctx.restore();
  ctx.restore();
}

// A squat irrigation pump: base, a bent pipe rising to a cracked valve
// wheel (one spoke missing, a crescent inlay at its hub — the same hardware
// language as the lantern posts), and a deterministic drip leaking from the
// crack, looping on a fixed cycle of `timeSec` rather than stored state.
// This is the mechanical cause behind The Marsh's flooding two stages later.
function drawIrrigationPumpMotif(ctx: CanvasRenderingContext2D, u: number, timeSec: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  ctx.moveTo(-u * 0.32, u * 0.9);
  ctx.lineTo(-u * 0.26, u * 0.15);
  ctx.lineTo(u * 0.26, u * 0.15);
  ctx.lineTo(u * 0.32, u * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(u * 0.05, u * 0.15);
  ctx.quadraticCurveTo(u * 0.3, -u * 0.05, u * 0.2, -u * 0.45);
  ctx.stroke();
  ctx.save();
  ctx.translate(u * 0.2, -u * 0.58);
  ctx.beginPath();
  ctx.arc(0, 0, u * 0.24, 0, Math.PI * 2);
  ctx.stroke();
  const spokes = 5;
  for (let i = 0; i < spokes; i++) {
    if (i === 2) continue; // the broken spoke
    const a = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * u * 0.24, Math.sin(a) * u * 0.24);
    ctx.stroke();
  }
  drawCrescentMark(ctx, u * 0.09, 0.24);
  ctx.restore();
  // the crack, and its deterministic drip: a streak that grows and resets
  // on a fixed cycle, never depending on any stored per-frame state.
  const cycle = 2.6;
  const t = (timeSec % cycle) / cycle;
  ctx.beginPath();
  ctx.moveTo(-u * 0.02, u * 0.15);
  ctx.lineTo(u * 0.05, u * 0.28);
  ctx.stroke();
  ctx.globalAlpha = 0.55 * (1 - t);
  ctx.strokeStyle = "rgba(140,190,220,0.8)";
  ctx.beginPath();
  ctx.moveTo(u * 0.02, u * 0.28);
  ctx.lineTo(u * 0.02, u * 0.28 + u * 0.5 * t);
  ctx.stroke();
  ctx.restore();
}

// An iron gate: two posts, scrollwork arch, three bars (one visibly bent),
// and a vine already climbing one post.
function drawIronGateMotif(ctx: CanvasRenderingContext2D, u: number, color: string) {
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.04);
  ctx.beginPath();
  ctx.moveTo(-u * 0.5, u * 0.9);
  ctx.lineTo(-u * 0.5, -u * 0.6);
  ctx.moveTo(u * 0.5, u * 0.9);
  ctx.lineTo(u * 0.5, -u * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-u * 0.5, -u * 0.6);
  ctx.quadraticCurveTo(0, -u * 0.95, u * 0.5, -u * 0.6);
  ctx.stroke();
  withRimLight(ctx, 0.4, () => {
    ctx.lineWidth = Math.max(1, u * 0.04);
    ctx.beginPath();
    ctx.moveTo(-u * 0.5, u * 0.9);
    ctx.lineTo(-u * 0.5, -u * 0.6);
    ctx.quadraticCurveTo(0, -u * 0.95, u * 0.5, -u * 0.6);
    ctx.lineTo(u * 0.5, u * 0.9);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(0, -u * 0.62, u * 0.09, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(0, -u * 0.62);
  drawCrescentMark(ctx, u * 0.1, 0.24);
  ctx.restore();
  for (let i = -1; i <= 1; i++) {
    const x = i * u * 0.32;
    ctx.beginPath();
    ctx.moveTo(x, -u * 0.55);
    if (i === 0) ctx.quadraticCurveTo(x + u * 0.18, u * 0.1, x + u * 0.08, u * 0.85);
    else ctx.lineTo(x, u * 0.85);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  drawVineStrand(ctx, -u * 0.5, u * 0.5, u * 0.25, -u * 0.9, u * 0.08);
  ctx.restore();
}

// A curved dead trunk with recursive, angular bare branches.
function drawDeadTreeMotif(ctx: CanvasRenderingContext2D, u: number) {
  ctx.save();
  function branch(x: number, y: number, angle: number, len: number, depth: number) {
    if (depth <= 0 || len < u * 0.05) return;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    ctx.lineWidth = Math.max(0.6, u * 0.06 * (depth / 4));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (Math.cos(angle) * len * 0.5 + len * 0.1), y + Math.sin(angle) * len * 0.5, x2, y2);
    ctx.stroke();
    branch(x2, y2, angle - 0.5 - depth * 0.05, len * 0.68, depth - 1);
    branch(x2, y2, angle + 0.5 + depth * 0.05, len * 0.68, depth - 1);
  }
  branch(0, u * 0.9, -Math.PI / 2, u * 0.55, 4);
  ctx.restore();
}

// Five swaying reed blades, each topped with a small cattail head.
function drawCattailClusterMotif(ctx: CanvasRenderingContext2D, u: number, timeSec: number) {
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.035);
  for (let i = 0; i < 5; i++) {
    const t = i / 4 - 0.5;
    const sway = Math.sin(timeSec * 0.9 + i) * u * 0.05;
    const baseX = t * u * 0.5;
    const height = u * (0.7 + Math.abs(t) * 0.2);
    ctx.beginPath();
    ctx.moveTo(baseX, u * 0.9);
    ctx.quadraticCurveTo(baseX + sway, u * 0.9 - height * 0.6, baseX + sway * 1.4, u * 0.9 - height);
    ctx.stroke();
    ctx.save();
    ctx.translate(baseX + sway * 1.4, u * 0.9 - height);
    ctx.beginPath();
    ctx.ellipse(0, 0, u * 0.035, u * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// One intact fluted pillar, one jagged shorter broken pillar, a partial
// arch spanning only the intact side, and a vine already climbing it.
function drawRuinArchMotif(ctx: CanvasRenderingContext2D, u: number, color: string) {
  ctx.save();
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.fillRect(-u * 0.55, -u * 0.9, u * 0.22, u * 1.8);
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(-u * 0.55, -u * 0.7 + i * u * 0.45);
    ctx.lineTo(-u * 0.33, -u * 0.7 + i * u * 0.45);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(u * 0.33, u * 0.9);
  ctx.lineTo(u * 0.33, -u * 0.1);
  ctx.lineTo(u * 0.42, -u * 0.25);
  ctx.lineTo(u * 0.48, -u * 0.05);
  ctx.lineTo(u * 0.55, -u * 0.18);
  ctx.lineTo(u * 0.55, u * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.16);
  ctx.beginPath();
  ctx.moveTo(-u * 0.44, -u * 0.9);
  ctx.quadraticCurveTo(-u * 0.1, -u * 1.25, u * 0.2, -u * 1.05);
  ctx.stroke();
  withRimLight(ctx, 0.4, () => {
    ctx.lineWidth = Math.max(1, u * 0.16);
    ctx.beginPath();
    ctx.moveTo(-u * 0.44, -u * 0.9);
    ctx.quadraticCurveTo(-u * 0.1, -u * 1.25, u * 0.2, -u * 1.05);
    ctx.stroke();
  });
  ctx.save();
  ctx.translate(-u * 0.1, -u * 1.05);
  drawCrescentMark(ctx, u * 0.14, 0.2);
  ctx.restore();
  ctx.strokeStyle = color;
  drawVineStrand(ctx, -u * 0.4, u * 0.6, u * 0.2, -u * 1.1, u * 0.09);
  ctx.restore();
}

// A jagged-topped fluted column with a fallen capital piece resting at its
// base.
function drawBrokenColumnMotif(ctx: CanvasRenderingContext2D, u: number) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-u * 0.3, u * 0.9);
  ctx.lineTo(-u * 0.3, -u * 0.3);
  ctx.lineTo(-u * 0.15, -u * 0.55);
  ctx.lineTo(u * 0.05, -u * 0.35);
  ctx.lineTo(u * 0.3, -u * 0.5);
  ctx.lineTo(u * 0.3, u * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(1, u * 0.02);
  for (let i = -2; i <= 2; i++) {
    const x = i * u * 0.1;
    ctx.beginPath();
    ctx.moveTo(x, u * 0.85);
    ctx.lineTo(x, -u * 0.2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(u * 0.5, u * 0.95, u * 0.28, u * 0.1, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The robed body shared by both the whole keeper statue (The Garden) and its
// headless ruin (The Ruins) — kept as one function so the two are
// guaranteed to read as the same figure, not two similarly-shaped ones.
function drawKeeperBody(ctx: CanvasRenderingContext2D, u: number) {
  ctx.beginPath();
  ctx.moveTo(-u * 0.22, u * 0.9);
  ctx.quadraticCurveTo(-u * 0.3, u * 0.2, -u * 0.18, -u * 0.3);
  ctx.quadraticCurveTo(0, -u * 0.42, u * 0.18, -u * 0.28);
  ctx.quadraticCurveTo(u * 0.3, u * 0.2, u * 0.22, u * 0.9);
  ctx.closePath();
  ctx.fill();
}

// A headless robed-figure silhouette, its fallen head resting at its feet,
// with a moss patch spreading across the base — the keeper's statue,
// fallen, this far into its own ruin.
function drawStatueFragmentMotif(ctx: CanvasRenderingContext2D, u: number) {
  ctx.save();
  drawKeeperBody(ctx, u);
  ctx.beginPath();
  ctx.ellipse(u * 0.45, u * 0.85, u * 0.13, u * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "rgba(70,110,70,0.6)";
  ctx.beginPath();
  ctx.ellipse(-u * 0.05, u * 0.75, u * 0.22, u * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The same keeper, whole and distant — the only intact figure the game
// shows, watching over The Garden's flower before anything here broke. A
// small crescent at its chest is the first sighting of the motif that
// recurs through every later stage's architecture.
function drawKeeperStatueMotif(ctx: CanvasRenderingContext2D, u: number) {
  ctx.save();
  drawKeeperBody(ctx, u);
  ctx.beginPath();
  ctx.ellipse(0, -u * 0.52, u * 0.15, u * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(0, -u * 0.05);
  drawCrescentMark(ctx, u * 0.13, 0.3);
  ctx.restore();
  ctx.restore();
}

// The final stage's centerpiece: three stacked stone steps, a pedestal
// basin, a soft pulse glowing where the Moon Flower's stem meets the stone,
// a faint carved moon-arc on the front riser, and two flanking low broken
// pillars.
function drawSanctuaryAltarMotif(ctx: CanvasRenderingContext2D, u: number, timeSec: number) {
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const stepWidth = u * (1.2 - i * 0.25);
    const stepHeight = u * 0.16;
    const y = u * 0.55 - i * stepHeight;
    ctx.globalAlpha = 0.85 - i * 0.1;
    ctx.fillRect(-stepWidth / 2, y, stepWidth, stepHeight);
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(0, u * 0.05, u * 0.32, u * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  const pulse = 0.6 + 0.4 * Math.sin(timeSec * 1.1);
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, { x: 0, y: 0 }, u * 0.6 * pulse, `rgba(220,230,255,${(0.35 * pulse).toFixed(3)})`);
  ctx.globalCompositeOperation = "source-over";

  // The crescent motif's fullest statement — every earlier stage carved it
  // small (a gate's keystone, a lamp's cage); here, at the source, it's
  // large and unmistakable, breathing with the same pulse as the glow.
  ctx.save();
  ctx.translate(0, -u * 0.02);
  drawCrescentMark(ctx, u * 0.34 * pulse, 0.3 + 0.18 * pulse);
  ctx.restore();

  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(0, u * 0.48, u * 0.09, 0.3, Math.PI * 1.6);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillRect(-u * 0.75, u * 0.3, u * 0.14, u * 0.35);
  ctx.fillRect(u * 0.61, u * 0.3, u * 0.14, u * 0.35);
  withRimLight(ctx, 0.4, () => {
    for (let i = 0; i < 3; i++) {
      const stepWidth = u * (1.2 - i * 0.25);
      const y = u * 0.55 - i * u * 0.16;
      ctx.beginPath();
      ctx.moveTo(-stepWidth / 2, y);
      ctx.lineTo(stepWidth / 2, y);
      ctx.stroke();
    }
  });
  ctx.restore();
}

// A fragment collected briefly shows this place "whole" again: a silver
// rim-light ghost of every ruined structure drawn additively over (never
// replacing) its current broken form, a bright pulse at the hero landmark,
// a flare at the moth itself, and -- on the last fragment of a stage with a
// real goal flower -- one connected line tracing the whole route the light
// still has to travel. Pure function of `echoT` (0..1 across the ~0.9s
// window main.ts holds open per fragment); never touches stage geometry.
function drawMemoryEcho(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stage: RenderStage,
  mothPos: Vec2,
  echoT: number,
  awakenT: number,
) {
  const envelope = Math.max(0, Math.sin(Math.PI * echoT));
  if (envelope <= 0.001) return;
  const silver = `rgba(${MOONLIGHT_RGB.join(",")},${envelope.toFixed(3)})`;

  for (const shape of stage.structures) {
    if (
      shape.kind !== "statueFragment" &&
      shape.kind !== "glasshouseArch" &&
      shape.kind !== "brokenColumn" &&
      shape.kind !== "ruinArch"
    ) {
      continue;
    }
    const base = worldToScreen(camera, { x: shape.x, y: shape.y });
    const u = 90 * shape.scale * camera.scale;
    ctx.save();
    ctx.translate(base.x, base.y);
    if (shape.flip) ctx.scale(-1, 1);
    // Always drawn upright, even where the current ruin is tilted or
    // sunken -- this is showing what used to be here, not its current pose.
    withRimLight(ctx, envelope * 0.75, () => {
      switch (shape.kind) {
        case "statueFragment":
          drawKeeperStatueMotif(ctx, u);
          break;
        case "glasshouseArch":
          drawGlasshouseArchMotif(ctx, u);
          break;
        case "ruinArch":
          drawRuinArchMotif(ctx, u, silver);
          break;
        case "brokenColumn":
          // No intact motif exists for this one -- stand in with a taller,
          // ungapped outline in the same footprint as the broken column.
          ctx.lineWidth = Math.max(1, u * 0.05);
          ctx.beginPath();
          ctx.moveTo(-u * 0.3, u * 0.9);
          ctx.lineTo(-u * 0.3, -u * 0.95);
          ctx.lineTo(u * 0.3, -u * 0.95);
          ctx.lineTo(u * 0.3, u * 0.9);
          ctx.closePath();
          ctx.stroke();
          break;
      }
    });
    ctx.restore();
  }

  const hero = stage.heroLandmark;
  const heroScreen = worldToScreen(camera, { x: hero.x, y: hero.y });
  const heroSize = 90 * hero.scale * camera.scale;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, heroScreen, heroSize * 0.9, `rgba(${MOONLIGHT_RGB.join(",")},${(envelope * 0.4).toFixed(3)})`);
  ctx.restore();

  const mothScreen = worldToScreen(camera, mothPos);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, mothScreen, 26 * camera.scale, `rgba(${MOONLIGHT_RGB.join(",")},${(envelope * 0.5).toFixed(3)})`);
  ctx.restore();

  // The final fragment's "visual answer": once every fragment on a stage
  // with a real goal flower has been collected, briefly draw the whole
  // route -- moth, the place that held light, and the flower it returns
  // to -- as one connected line.
  if (stage.flower.isGoal && awakenT >= 0.999) {
    const flowerScreen = worldToScreen(camera, stage.flower.pos);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(${MOONLIGHT_RGB.join(",")},${(envelope * 0.55).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, 2 * camera.scale);
    ctx.beginPath();
    ctx.moveTo(mothScreen.x, mothScreen.y);
    ctx.lineTo(heroScreen.x, heroScreen.y);
    ctx.lineTo(flowerScreen.x, flowerScreen.y);
    ctx.stroke();
    ctx.restore();
  }
}

// The Marsh's water band: everything glowing above the waterline gets a
// dim, alpha-reduced, vertically-mirrored echo below it, plus a few
// deterministic ripple rings under the moth's own reflection.
function drawWaterReflection(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stage: RenderStage,
  mothPos: Vec2,
  lightPos: Vec2 | null,
  timeSec: number,
  viewWidth: number,
  viewHeight: number,
) {
  const topLeft = worldToScreen(camera, { x: 0, y: HORIZON_WORLD_Y });
  const bottomRight = worldToScreen(camera, { x: WORLD.width, y: WORLD.height });
  const reflect = (v: Vec2): Vec2 => ({ x: v.x, y: 2 * HORIZON_WORLD_Y - v.y });

  ctx.save();
  ctx.beginPath();
  ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.clip();

  const tint = ctx.createLinearGradient(0, topLeft.y, 0, bottomRight.y);
  tint.addColorStop(0, "rgba(120,180,200,0.10)");
  tint.addColorStop(1, "rgba(30,55,70,0.28)");
  ctx.fillStyle = tint;
  ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.4;
  glow(ctx, worldToScreen(camera, reflect(mothPos)), 42 * camera.scale, "rgba(210,205,235,0.5)");
  if (lightPos) glow(ctx, worldToScreen(camera, reflect(lightPos)), 90 * camera.scale, "rgba(200,225,255,0.6)");
  for (const hazard of stage.hazards) {
    glow(ctx, worldToScreen(camera, reflect(hazard.pos)), hazard.radius * 2.4 * camera.scale, "rgba(150,255,210,0.4)");
  }
  glow(
    ctx,
    worldToScreen(camera, reflect(stage.flower.pos)),
    stage.flower.radius * 2.2 * camera.scale,
    "rgba(255,214,150,0.4)",
  );
  // The Marsh's own first sight of the moon (see moonScreenPos/item 7) gets
  // a soft mirrored glow across the water, same position math as the sky's
  // own disc — a real reflection, not a second hand-placed light.
  const moon = moonScreenPos(viewWidth, viewHeight, stage.art);
  if (moon) {
    const reflectedY = 2 * topLeft.y - moon.y;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, { x: moon.x, y: reflectedY }, moon.r * 2.2, "rgba(220,230,255,0.22)");
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  const rp = worldToScreen(camera, reflect(mothPos));
  for (let i = 0; i < 3; i++) {
    const cycle = 2.6;
    const t = ((((timeSec + (i * cycle) / 3) % cycle) + cycle) % cycle) / cycle;
    const r = t * 140 * camera.scale;
    ctx.strokeStyle = `rgba(200,230,255,${(0.16 * (1 - t)).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, 1.2 * camera.scale);
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hazards --- reskinned per HazardConfig.kind so danger reads as a world
// object reacting (a lantern's flame surging, a wisp's tendrils curling
// tighter), never as a debug circle appearing.
// ---------------------------------------------------------------------------

// Interpolates two RGB triples and returns the "r,g,b" fragment for an rgba()
// string — used to fade a hazard's own color toward the same pale moonlight
// tone the player's light carries, so the ending reads as light reuniting
// with light, not a color simply dimming to black.
function blendChannels(a: readonly [number, number, number], b: readonly [number, number, number], t: number) {
  const k = Math.min(1, Math.max(0, t));
  const r = a[0] + (b[0] - a[0]) * k;
  const g = a[1] + (b[1] - a[1]) * k;
  const bl = a[2] + (b[2] - a[2]) * k;
  return `${r.toFixed(0)},${g.toFixed(0)},${bl.toFixed(0)}`;
}

const MOONLIGHT_RGB: readonly [number, number, number] = [210, 222, 255];

function drawHazards(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stage: RenderStage,
  mothPos: Vec2,
  extras: RenderExtras,
  extinguish: number,
) {
  for (const hazard of stage.hazards) {
    const isCause =
      extras.deathHazardPos !== null &&
      hazard.pos.x === extras.deathHazardPos.x &&
      hazard.pos.y === extras.deathHazardPos.y;
    // A brief surge on the specific hazard that just caught the moth, on top
    // of its constant low-level "danger" pulse.
    const deathSurge = isCause ? 1 + Math.max(0, 1 - extras.phaseTimer / 0.4) * 0.9 : 1;

    // A gentler, standing surge while the moth sits inside the hazard's
    // actual pull range --- so the moment moth.ts starts tugging on the moth
    // is the same moment the hazard visibly reacts to it, with no separate
    // ring drawn. During the ending, hazards visibly extinguish instead.
    const proximityT = hazardProximity(mothPos, hazard);
    const surge = deathSurge * (1 + proximityT * 0.6) * (1 - extinguish * 0.85);

    if (hazard.kind === "lantern")
      drawLantern(ctx, camera, hazard.pos, hazard.radius, extras.timeSec, surge, extinguish);
    else drawWillOWisp(ctx, camera, hazard.pos, hazard.radius, extras.timeSec, surge, extinguish);
  }
}

// A broken garden lantern: a dark cage frame on a short post, with a
// flickering warm flame inside — reads as an object in the world, not an
// abstract marker. During the ending, `extinguish` fades the flame toward
// the same pale moonlight tone the player's own light carries — the hoarded
// light finally rejoining the light it was taken from, not just going out.
function drawLantern(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  worldPos: Vec2,
  worldRadius: number,
  timeSec: number,
  surge: number,
  extinguish: number,
) {
  const p = worldToScreen(camera, worldPos);
  const r = worldRadius * camera.scale;
  const flicker = 0.75 + 0.25 * Math.sin(timeSec * 6.5) + 0.08 * Math.sin(timeSec * 17.3);
  const glowRgb = blendChannels([255, 180, 90], MOONLIGHT_RGB, extinguish);
  const coreRgb = blendChannels([255, 235, 190], MOONLIGHT_RGB, extinguish);
  const midRgb = blendChannels([255, 160, 70], MOONLIGHT_RGB, extinguish);

  ctx.strokeStyle = "rgba(40,28,18,0.9)";
  ctx.lineWidth = Math.max(1, 2 * camera.scale);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - r * 2.4);
  ctx.lineTo(p.x, p.y - r * 1.1);
  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, r * 3.2 * surge, `rgba(${glowRgb},${(0.45 * surge * flicker).toFixed(3)})`);
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = "rgba(40,28,18,0.95)";
  ctx.lineWidth = Math.max(1, 1.6 * camera.scale);
  const cw = r * 1.1;
  const ch = r * 1.5;
  ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
  ctx.beginPath();
  ctx.moveTo(-cw / 2, 0);
  ctx.lineTo(cw / 2, 0);
  ctx.stroke();
  ctx.save();
  ctx.translate(0, -ch * 0.32);
  drawCrescentMark(ctx, r * 0.16, 0.22);
  ctx.restore();

  const flame = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.7 * flicker);
  flame.addColorStop(0, `rgba(${coreRgb},${(0.95 * surge).toFixed(3)})`);
  flame.addColorStop(0.6, `rgba(${midRgb},${(0.85 * surge).toFixed(3)})`);
  flame.addColorStop(1, "rgba(200,70,20,0.1)");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.32 * flicker, r * 0.5 * flicker, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A will-o'-the-wisp: a soft drifting blob in cool pale green with curling
// tendrils — the marsh's ghost lights, carried through as the game's
// recurring danger motif all the way to the finale. During the ending,
// `extinguish` fades its glow toward the player's own pale moonlight —
// unhoused light finally settling, rather than being snuffed out.
function drawWillOWisp(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  worldPos: Vec2,
  worldRadius: number,
  timeSec: number,
  surge: number,
  extinguish: number,
) {
  const p = worldToScreen(camera, worldPos);
  const r = worldRadius * camera.scale;
  const pulse = 0.8 + 0.2 * Math.sin(timeSec * 3.2);
  const glowRgb = blendChannels([150, 255, 210], MOONLIGHT_RGB, extinguish);
  const tendrilRgb = blendChannels([170, 255, 220], MOONLIGHT_RGB, extinguish);
  const coreRgb = blendChannels([230, 255, 245], MOONLIGHT_RGB, extinguish);
  const midRgb = blendChannels([150, 255, 210], MOONLIGHT_RGB, extinguish);

  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, r * 3.6 * surge * pulse, `rgba(${glowRgb},${(0.4 * surge).toFixed(3)})`);

  ctx.strokeStyle = `rgba(${tendrilRgb},${(0.35 * surge).toFixed(3)})`;
  ctx.lineWidth = Math.max(1, 1.4 * camera.scale);
  for (let i = 0; i < 3; i++) {
    const baseAngle = (i / 3) * Math.PI * 2 + timeSec * 0.5;
    const c1x = p.x + Math.cos(baseAngle) * r * 1.6;
    const c1y = p.y + Math.sin(baseAngle) * r * 1.6 + Math.sin(timeSec * 2 + i) * r * 0.4;
    const endX = p.x + Math.cos(baseAngle + 0.6) * r * 2.4;
    const endY = p.y + Math.sin(baseAngle + 0.6) * r * 2.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(c1x, c1y, endX, endY);
    ctx.stroke();
  }

  const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * pulse);
  core.addColorStop(0, `rgba(${coreRgb},${(0.95 * surge).toFixed(3)})`);
  core.addColorStop(0.6, `rgba(${midRgb},${(0.75 * surge).toFixed(3)})`);
  core.addColorStop(1, "rgba(90,200,170,0.1)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.6 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// Replaces the old debug influence-ring: a faint heat-shimmer around the
// moth itself, its wobble and opacity scaling with how deep the moth is
// inside a hazard's pull range — danger as an atmospheric distortion around
// the thing in danger, not a circle around the thing causing it.
function drawDangerShimmer(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  mothPos: Vec2,
  timeSec: number,
  intensity: number,
) {
  if (intensity <= 0.02) return;
  const p = worldToScreen(camera, mothPos);
  const baseR = MOTH_RADIUS * 2.4 * camera.scale;
  const points = 20;
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wobble = 1 + 0.14 * intensity * Math.sin(timeSec * 16 + i * 1.3);
    const r = baseR * wobble;
    const x = p.x + Math.cos(a) * r;
    const y = p.y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(255,140,90,${(0.12 + 0.38 * intensity).toFixed(3)})`;
  ctx.lineWidth = Math.max(1, 1.4 * camera.scale);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Moon fragments and the flower
// ---------------------------------------------------------------------------

// A moon fragment: a small pulsing, rotating crescent of cool moonlight —
// built from two overlapping circles (FRAGMENT_PATH), never confusable with
// the warm/hot hazards.
function drawFragment(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  fragment: FragmentConfig,
  timeSec: number,
  index: number,
) {
  const p = worldToScreen(camera, fragment.pos);
  const r = fragment.radius * camera.scale;
  const pulse = 0.85 + 0.15 * Math.sin(timeSec * 3 + index * 1.7);

  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, r * 3 * pulse, "rgba(210,225,255,0.5)");
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(timeSec * 0.5 + index);
  ctx.scale(r * 0.6 * pulse, r * 0.6 * pulse);
  ctx.fillStyle = "rgba(235,242,255,0.95)";
  ctx.fill(FRAGMENT_PATH, "evenodd");
  ctx.restore();

  for (let i = 0; i < 2; i++) {
    const angle = timeSec * 1.4 + index * 2 + i * Math.PI;
    const fx = p.x + Math.cos(angle) * r * 1.5;
    const fy = p.y + Math.sin(angle) * r * 1.5;
    ctx.fillStyle = "rgba(230,240,255,0.8)";
    ctx.beginPath();
    ctx.arc(fx, fy, Math.max(0.6, r * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
}

// The safe target reads as an actual flower rooted to the ground (a stem
// and two leaves for every non-goal flower) rather than a floating icon —
// petals are built from PETAL_PATH teardrops, not ellipses. From The Ruins
// on, a flower with fragments still owed renders as a visibly tighter,
// dimmer bud with one pip per fragment lighting up as each is collected; it
// only opens to its full bloom once every pip is lit. The final stage's
// flower (isGoal) swaps the usual warm amber for a cool blue-white "moon"
// palette, gains a second inner layer of petals and radiating moon-vein
// lines once bloomed, and its bloom eases open over `openT` (0→1) instead
// of snapping, for the ending.
//
// Outer petals are scaled so their tip reaches exactly `r*1.22*closedShrink`
// from center — matching the ratio FLOWER_VISUAL_OVERSHOOT (see state.ts) is
// tuned against, so this redesign doesn't silently perturb win detection.
function drawFlower(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stage: RenderStage,
  extras: RenderExtras,
  openT: number,
) {
  const p = worldToScreen(camera, stage.flower.pos);
  const isGoal = stage.flower.isGoal;
  const bloom = stage.flower.bloomed;
  const required = stage.fragments.length;
  const collectedCount = extras.fragmentsCollected.filter(Boolean).length;
  const ready = required === 0 || collectedCount >= required;
  const closedShrink = ready ? 1 : 0.72;
  const r = stage.flower.radius * camera.scale * (1 + openT * 0.2);

  if (!isGoal) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "rgba(60,90,55,0.55)";
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.3);
    ctx.lineTo(0, r * 1.6);
    ctx.stroke();
    ctx.fillStyle = "rgba(70,100,60,0.5)";
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(0, r * 1.1);
      ctx.rotate(side * 0.9);
      ctx.scale(r * 0.35, r * 0.6);
      ctx.fill(LEAF_PATH);
      ctx.restore();
    }
    ctx.restore();
  }

  ctx.globalCompositeOperation = "lighter";
  const glowColor = isGoal
    ? bloom
      ? "rgba(225,238,255,0.8)"
      : "rgba(200,220,255,0.4)"
    : bloom
      ? "rgba(255,235,190,0.7)"
      : "rgba(255,205,140,0.32)";
  glow(ctx, p, r * (isGoal ? 4.2 : 3.2) * closedShrink, glowColor);
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(p.x, p.y);
  // The moon flower's sway is tuned ~13% faster than every other flower's
  // (0.6) after playtest feedback that the final stage's target read as too
  // static -- its own idle animation is the only "movement" a fixed-position
  // flower has, so that's the one knob to turn up here.
  ctx.rotate(Math.sin(extras.timeSec * (isGoal ? 0.68 : 0.6)) * 0.06);

  const outerPetals = isGoal ? 10 : 6;
  const petalColor = isGoal
    ? bloom
      ? "rgba(240,246,255,0.95)"
      : "rgba(190,205,235,0.55)"
    : bloom
      ? "rgba(255,246,220,0.95)"
      : "rgba(230,190,140,0.55)";
  for (let i = 0; i < outerPetals; i++) {
    ctx.save();
    ctx.rotate((i / outerPetals) * Math.PI * 2);
    ctx.fillStyle = petalColor;
    ctx.save();
    ctx.scale(r * 0.42 * closedShrink, r * 1.22 * closedShrink);
    ctx.fill(PETAL_PATH);
    ctx.restore();
    ctx.restore();
  }

  if (isGoal && bloom) {
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i / 8) * Math.PI * 2 + Math.PI / 8);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.save();
      ctx.scale(r * 0.22 * closedShrink, r * 0.55 * closedShrink);
      ctx.fill(PETAL_PATH);
      ctx.restore();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(220,230,255,0.5)";
    ctx.lineWidth = Math.max(1, r * 0.015);
    for (let i = 0; i < outerPetals; i++) {
      const angle = (i / outerPetals) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(angle) * r * 0.55, -Math.cos(angle) * r * 0.55);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(220,230,255,0.25)";
    ctx.lineWidth = Math.max(1, r * 0.02);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = isGoal ? (bloom ? "#ffffff" : "#dbe6ff") : bloom ? "#fff7e3" : "#e0b878";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (required > 0 && !ready) {
    for (let i = 0; i < required; i++) {
      const angle = -Math.PI / 2 + (i / required) * Math.PI * 2;
      const px = p.x + Math.cos(angle) * r * 1.7;
      const py = p.y + Math.sin(angle) * r * 1.7;
      const lit = extras.fragmentsCollected[i];
      if (lit) {
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, { x: px, y: py }, 10 * camera.scale, "rgba(220,235,255,0.8)");
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.fillStyle = lit ? "#eaf3ff" : "rgba(180,200,230,0.35)";
      ctx.beginPath();
      ctx.arc(px, py, 4 * camera.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// The ending's chain bloom: small flowers/plants scattered across the
// environment light up in a staggered wave keyed off `wash`, instead of
// only the flower center reacting — the whole world visibly wakes up.
function drawEmberBlooms(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  positions: Vec2[],
  wash: number,
  timeSec: number,
) {
  if (wash <= 0) return;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < positions.length; i++) {
    const localT = Math.max(0, Math.min(1, wash * 2 - (i % 5) * 0.15));
    if (localT <= 0) continue;
    const p = worldToScreen(camera, positions[i]);
    const twinkle = 0.7 + 0.3 * Math.sin(timeSec * 2 + i);
    glow(ctx, p, 14 * camera.scale * localT * twinkle, `rgba(255,225,180,${(0.35 * localT).toFixed(3)})`);
    ctx.strokeStyle = `rgba(255,240,210,${(0.5 * localT).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, camera.scale * 0.8);
    const s = 6 * camera.scale * localT;
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y);
    ctx.lineTo(p.x + s, p.y);
    ctx.moveTo(p.x, p.y - s);
    ctx.lineTo(p.x, p.y + s);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

// A short deterministic burst of rising light motes for the ending — a pure
// function of the "won" phase timer and each mote's fixed index, same idiom
// as hazard drift. Rises from several points across the environment (the
// flower plus nearby structures), not just one center, so the light reads
// as coming from the whole place waking up.
function drawLightMotes(ctx: CanvasRenderingContext2D, camera: Camera, sources: Vec2[], phaseTimer: number) {
  const t = phaseTimer - 3;
  if (t <= 0 || sources.length === 0) return;
  const count = 14;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const age = t - i * 0.08;
    if (age <= 0 || age > 3) continue;
    const center = sources[i % sources.length];
    const angle = (i / count) * Math.PI * 2 + i * 0.4;
    const drift = 30 + (i % 3) * 18;
    const x = center.x + Math.cos(angle) * drift * (0.3 + age * 0.4);
    const y = center.y - age * 90 + Math.sin(angle) * 10;
    const p = worldToScreen(camera, { x, y });
    const alpha = Math.max(0, 1 - age / 3);
    glow(ctx, p, 10 * camera.scale * (0.6 + alpha), `rgba(230,240,255,${(alpha * 0.8).toFixed(3)})`);
  }
  ctx.globalCompositeOperation = "source-over";
}

// The ending's "light flows back": for each hazard, a handful of motes
// travel deterministically from that hazard's own position toward the
// flower/altar over the ending's timeline — the danger visibly emptying out
// toward the source it was hoarded from. Runs alongside (never replacing)
// the existing blendChannels color-cool already fading each hazard's own
// glow toward moonlight in drawHazards.
function drawLightReturn(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  hazardPositions: Vec2[],
  flowerPos: Vec2,
  phaseTimer: number,
) {
  const start = 2.6;
  const span = 3.2;
  const t = (phaseTimer - start) / span;
  if (t <= 0 || t >= 1.3 || hazardPositions.length === 0) return;

  const perHazard = 4;
  ctx.globalCompositeOperation = "lighter";
  for (let h = 0; h < hazardPositions.length; h++) {
    const from = hazardPositions[h];
    for (let i = 0; i < perHazard; i++) {
      const stagger = i * 0.1 + h * 0.05;
      const localT = Math.min(1, Math.max(0, (t - stagger) / Math.max(0.2, 1 - stagger)));
      if (localT <= 0) continue;
      const eased = localT * localT * (3 - 2 * localT);
      const wobble = Math.sin((t + i * 1.7 + h * 2.3) * 6) * 12 * (1 - eased);
      const x = from.x + (flowerPos.x - from.x) * eased + wobble;
      const y = from.y + (flowerPos.y - from.y) * eased + wobble * 0.6;
      const p = worldToScreen(camera, { x, y });
      const fadeIn = Math.min(1, eased / 0.15);
      const fadeOut = Math.min(1, (1 - eased) / 0.15);
      const alpha = Math.min(fadeIn, fadeOut);
      if (alpha <= 0.01) continue;
      glow(ctx, p, 9 * camera.scale, `rgba(220,235,255,${(alpha * 0.9).toFixed(3)})`);
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

// ---------------------------------------------------------------------------
// The player's light and the moth
// ---------------------------------------------------------------------------

// The player's own light: a clean, round, cool-white glow with a slow, calm
// breathing pulse — the visual opposite of a hazard's hot, jittery flare.
// Drawn additively over the environment layers already on screen, so nearby
// foliage/fog visibly brightens near the light with no extra code needed.
function drawLight(ctx: CanvasRenderingContext2D, camera: Camera, lightPos: Vec2, timeSec: number) {
  const p = worldToScreen(camera, lightPos);
  const breathe = 0.95 + 0.05 * Math.sin(timeSec * 1.3);
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, p, 46 * camera.scale * breathe, "rgba(225,238,255,0.95)");
  glow(ctx, p, 150 * camera.scale * breathe, "rgba(160,200,255,0.25)");
  ctx.globalCompositeOperation = "source-over";
}

// A fixed-length trail of recent moth positions (see main.ts), rendered as a
// fading soft polyline of glows behind the moth — a short luminescent trail,
// brighter and larger toward the newest (last) entry. `glowBoost` scales
// both with fragments collected, so the trail visibly brightens across a
// stage's progress.
function drawMothTrail(ctx: CanvasRenderingContext2D, camera: Camera, trail: Vec2[], glowBoost: number) {
  if (trail.length < 2) return;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < trail.length; i++) {
    const t = i / (trail.length - 1);
    const p = worldToScreen(camera, trail[i]);
    const r = (2 + t * 3) * camera.scale * glowBoost;
    glow(ctx, p, r * 2.4, `rgba(200,195,230,${((0.05 + t * 0.12) * glowBoost).toFixed(3)})`);
  }
  ctx.globalCompositeOperation = "source-over";
}

// The moth itself: a body + two flapping wings + antennae, drawn as a muted
// silhouette (not a glowing orb) so it never reads as another light source.
// Its wing pattern (veins + eye-spots) is nearly invisible at first and
// grows in with `patternT`, driven by fragments collected and by the
// ending's `moonlit` state — the moth visibly carries more moonlight the
// further it's traveled.
function drawMoth(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: GameState,
  timeSec: number,
  fragmentGlowBoost: number,
  moonlit: boolean,
) {
  const p = worldToScreen(camera, state.moth.pos);
  const scale = camera.scale;
  const angle = Math.atan2(state.moth.heading.y, state.moth.heading.x);
  const bob = Math.sin(timeSec * 3) * 1.5 * scale;
  const flap = (Math.sin(timeSec * 9) * 0.5 + 0.5) * 0.4;
  const unit = MOTH_RADIUS * scale;
  const glowBoost = 1 + fragmentGlowBoost * 0.35;
  const patternT = moonlit ? 1 : Math.min(1, 0.15 + fragmentGlowBoost * 0.28);

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(angle);

  ctx.globalCompositeOperation = "lighter";
  const auraColor = moonlit ? "rgba(210,225,255,0.3)" : "rgba(210,205,235,0.16)";
  glow(ctx, { x: 0, y: 0 }, unit * 2 * glowBoost, auraColor);
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = moonlit ? "rgba(220,230,255,0.7)" : "rgba(180,175,205,0.6)";
  ctx.lineWidth = Math.max(1, unit * 0.05);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(unit * 0.6, side * unit * 0.1);
    ctx.quadraticCurveTo(unit * 0.95, side * unit * 0.5, unit * 0.75, side * unit * 0.75);
    ctx.stroke();
  }

  const wingColor = moonlit ? "rgba(220,230,255,0.92)" : "rgba(198,192,224,0.88)";
  drawWing(ctx, 1, flap, unit, wingColor, patternT, moonlit);
  drawWing(ctx, -1, flap, unit, wingColor, patternT, moonlit);

  ctx.fillStyle = moonlit ? "#4a4d6e" : "#332e48";
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
  patternT: number,
  moonlit: boolean,
) {
  ctx.save();
  ctx.translate(-unit * 0.15, 0);
  ctx.rotate(side * (0.6 - flap));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(unit * 0.85, 0, unit * 1.05, unit * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  if (patternT > 0.02) {
    ctx.globalAlpha = patternT;
    ctx.strokeStyle = moonlit ? "rgba(140,160,220,0.7)" : "rgba(90,80,110,0.5)";
    ctx.lineWidth = Math.max(1, unit * 0.04);
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      ctx.beginPath();
      ctx.moveTo(unit * 0.1, 0);
      ctx.quadraticCurveTo(unit * (0.5 + t * 0.3), -unit * 0.3 * t, unit * (0.6 + t * 0.9), unit * 0.1 * t);
      ctx.stroke();
    }
    // The wing's eye-spot, cut to the same crescent silhouette as a moon
    // fragment and the game's carved architecture — the marking the moth is
    // wearing is the same shape it's out there collecting.
    ctx.fillStyle = moonlit ? "rgba(200,215,255,0.8)" : "rgba(120,110,140,0.55)";
    ctx.save();
    ctx.translate(unit * 1.1, 0);
    ctx.scale(unit * 0.16, unit * 0.16);
    ctx.fill(FRAGMENT_PATH, "evenodd");
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Screen-space foreground framing
// ---------------------------------------------------------------------------

// A screen-space (not world-locked) foreground layer, drawn last among world
// content so it always frames the shot — corner foliage, a hanging vine, a
// reed fringe along the bottom edge, or broken stone, keyed on the stage's
// `art.frame`. Fixed viewport-relative positions so it scales across
// viewport sizes.
function drawForegroundFrame(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  frameKind: FrameKind | undefined,
  color: string,
  timeSec: number,
) {
  if (!frameKind) return;
  const sway = Math.sin(timeSec * 0.3) * 0.03;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;

  if (frameKind === "glasshouseLeaves") {
    drawCornerFoliage(ctx, 0, viewHeight, -0.3, Math.min(viewWidth, viewHeight) * 0.5, sway);
    drawCornerFoliage(ctx, viewWidth, viewHeight, Math.PI + 0.3, Math.min(viewWidth, viewHeight) * 0.42, -sway);
  } else if (frameKind === "hangingVines") {
    drawHangingVine(ctx, viewWidth * 0.12, 0, viewHeight * 0.38, sway);
    drawHangingVine(ctx, viewWidth * 0.88, 0, viewHeight * 0.3, -sway);
  } else if (frameKind === "reedFringe") {
    for (let i = 0; i < 7; i++) {
      const x = (i / 6) * viewWidth;
      const h = viewHeight * (0.08 + (i % 3) * 0.03);
      const lean = Math.sin(timeSec * 0.6 + i) * 10;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, viewHeight);
      ctx.quadraticCurveTo(x + lean, viewHeight - h * 0.6, x + lean * 1.5, viewHeight - h);
      ctx.stroke();
    }
  } else if (frameKind === "ruinBranches") {
    drawHangingVine(ctx, viewWidth * 0.08, 0, viewHeight * 0.32, sway);
    drawCornerStoneEdge(ctx, 0, viewHeight, 1, viewWidth * 0.22, viewHeight * 0.14);
  } else if (frameKind === "sanctuaryBoughs") {
    drawHangingVine(ctx, viewWidth * 0.15, 0, viewHeight * 0.4, sway);
    drawHangingVine(ctx, viewWidth * 0.85, 0, viewHeight * 0.34, -sway);
    drawCornerStoneEdge(ctx, viewWidth, viewHeight, -1, viewWidth * 0.2, viewHeight * 0.16);
  }

  ctx.restore();
}

// Three giant leaves fanned from a screen corner — the glasshouse's own
// foliage framing the shot from inside.
function drawCornerFoliage(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angleBase: number,
  size: number,
  sway: number,
) {
  for (let i = 0; i < 3; i++) {
    const angle = angleBase + (i - 1) * 0.35 + sway;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(size * (0.5 + i * 0.15), size * (0.7 + i * 0.1));
    ctx.fill(LEAF_PATH);
    ctx.restore();
  }
}

// A vine hanging from the top edge, with a few leaf nodes climbing it,
// swaying gently.
function drawHangingVine(ctx: CanvasRenderingContext2D, x: number, yTop: number, length: number, sway: number) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  const midX = x + length * 0.15 + sway * 40;
  const midY = yTop + length * 0.5;
  ctx.quadraticCurveTo(midX, midY, x + sway * 60, yTop + length);
  ctx.stroke();
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const lx = x + Math.sin(t * Math.PI) * length * 0.15 + sway * 40 * t;
    const ly = yTop + length * t;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate((i % 2 === 0 ? 1 : -1) * 0.6);
    ctx.scale(length * 0.09, length * 0.15);
    ctx.fill(LEAF_PATH);
    ctx.restore();
  }
  ctx.restore();
}

// A dark broken-stone silhouette wedge in a bottom screen corner.
function drawCornerStoneEdge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: 1 | -1,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dir * w, cy - h * 0.2);
  ctx.lineTo(cx + dir * w * 0.7, cy - h * 0.6);
  ctx.lineTo(cx + dir * w * 0.9, cy - h);
  ctx.lineTo(cx, cy - h * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// A full-screen cosmetic pass for main.ts's fixed pause between two stages —
// the literal cause the player watches happen before the next stage's effect
// appears underfoot. `t` is 0..1 progress through that pause; every shape
// here is a pure function of `t`, matching the rest of the codebase's
// no-stored-mutable-state animation idiom.
function drawTransitionEffect(
  ctx: CanvasRenderingContext2D,
  viewWidth: number,
  viewHeight: number,
  transition: { t: number; effect: "ignite" | "flood" | "drain" | "reveal" },
  camera: Camera,
  stage: RenderStage,
) {
  const { t, effect } = transition;
  ctx.save();
  if (effect === "ignite") {
    // Lanterns across the frame visibly flare on, brightest at the
    // transition's midpoint.
    const flare = Math.sin(Math.min(1, t) * Math.PI);
    ctx.globalCompositeOperation = "lighter";
    const points = [
      { x: 0.2, y: 0.35 },
      { x: 0.5, y: 0.55 },
      { x: 0.78, y: 0.4 },
    ];
    for (const pt of points) {
      glow(
        ctx,
        { x: pt.x * viewWidth, y: pt.y * viewHeight },
        Math.min(viewWidth, viewHeight) * 0.22 * flare,
        `rgba(255,190,110,${(flare * 0.4).toFixed(3)})`,
      );
    }
  } else if (effect === "flood") {
    // The literal answer to "how did the marsh get here" — three beats in
    // one continuous cause-and-effect: the pump's crack widening and
    // flaring first, then the water actually rising, and, right in the
    // middle of the rise, the one lantern's own cage cracking as its
    // trapped light escapes upward and cools green — the exact instant a
    // wisp is born, tied to the flood that causes it rather than a
    // separate unexplained cutscene.
    const pump = stage.structures.find((s) => s.kind === "irrigationPump");
    if (pump && t < 0.35) {
      const crackT = Math.min(1, t / 0.18);
      const p = worldToScreen(camera, { x: pump.x, y: pump.y });
      const shake = Math.sin(t * 90) * 3 * (1 - crackT);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, { x: p.x + shake, y: p.y }, 30 * camera.scale * crackT, `rgba(255,190,110,${(0.5 * crackT).toFixed(3)})`);
      ctx.strokeStyle = `rgba(230,225,235,${(0.6 * crackT).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 2 * camera.scale);
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y - 20 * camera.scale);
      ctx.lineTo(p.x + 6 + shake, p.y);
      ctx.lineTo(p.x - 3, p.y + 18 * camera.scale);
      ctx.stroke();
      ctx.restore();
    }

    const riseT = Math.min(1, t / 0.65);
    const waterY = viewHeight * (1 - riseT * 0.62);
    const tint = ctx.createLinearGradient(0, waterY, 0, viewHeight);
    tint.addColorStop(0, "rgba(120,180,200,0.05)");
    tint.addColorStop(1, "rgba(30,55,70,0.55)");
    ctx.fillStyle = tint;
    ctx.fillRect(0, waterY, viewWidth, viewHeight - waterY);
    ctx.strokeStyle = "rgba(200,225,235,0.35)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const wobble = Math.sin(t * 14 + i * 2) * (4 - i);
      ctx.beginPath();
      ctx.moveTo(0, waterY + wobble - i * 5);
      ctx.lineTo(viewWidth, waterY - wobble - i * 5);
      ctx.stroke();
    }

    const lantern = stage.hazards.find((h) => h.kind === "lantern");
    if (lantern) {
      const escT = Math.min(1, Math.max(0, (t - 0.35) / 0.35));
      const p = worldToScreen(camera, lantern.pos);
      if (escT > 0 && escT < 1) {
        const riseY = p.y - escT * 70 * camera.scale;
        const rgb = blendChannels([255, 170, 90], [150, 255, 210], escT);
        const alpha = 0.7 * (1 - Math.abs(escT - 0.5) * 1.4);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, { x: p.x, y: riseY }, 22 * camera.scale * (0.5 + escT * 0.5), `rgba(${rgb},${Math.max(0, alpha).toFixed(3)})`);
        ctx.restore();
      } else if (escT >= 1) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        glow(ctx, { x: p.x, y: p.y - 70 * camera.scale }, 20 * camera.scale, "rgba(150,255,210,0.5)");
        ctx.restore();
      }
    }
  } else if (effect === "drain") {
    // The flood's mirror: the water wash receding back down and away as
    // The Marsh hands off to The Ruins.
    const drainT = Math.min(1, t / 0.85);
    const waterY = viewHeight * (0.38 + drainT * 0.62);
    const tint = ctx.createLinearGradient(0, waterY, 0, viewHeight);
    tint.addColorStop(0, "rgba(120,180,200,0.05)");
    tint.addColorStop(1, "rgba(30,55,70,0.4)");
    ctx.fillStyle = tint;
    ctx.fillRect(0, waterY, viewWidth, viewHeight - waterY);
  } else if (effect === "reveal") {
    // The ruin's broken landmark silhouette parts and the moon brightens
    // early — foreshadowing the sanctuary the next stage centers on.
    const revealT = Math.min(1, t);
    ctx.globalCompositeOperation = "lighter";
    glow(
      ctx,
      { x: viewWidth * 0.78, y: viewHeight * 0.18 },
      Math.min(viewWidth, viewHeight) * 0.3 * (0.4 + revealT * 0.6),
      `rgba(225,235,255,${(0.3 * revealT).toFixed(3)})`,
    );
    const partX = viewWidth * 0.5;
    const gap = viewWidth * 0.05 * revealT;
    ctx.fillStyle = `rgba(10,10,16,${(0.18 * (1 - revealT)).toFixed(3)})`;
    ctx.fillRect(partX - gap - 2, 0, 4, viewHeight * 0.4);
    ctx.fillRect(partX + gap - 2, 0, 4, viewHeight * 0.4);
  }
  ctx.restore();
}

// A short memory-return across the ending: the four earlier stages' own
// hero landmarks, briefly whole again, in a row along the top of frame —
// "restored" readings of real stage data (their own sky colors, their own
// landmark motif), not new bespoke art. Each panel fades in and back out on
// its own slice of a fixed window before the final text appears.
const ENDING_MONTAGE_START = 4.4;
const ENDING_MONTAGE_PANEL_DURATION = 0.65;

function drawEndingMontage(ctx: CanvasRenderingContext2D, viewWidth: number, viewHeight: number, phaseTimer: number, timeSec: number) {
  const panelSize = Math.min(viewWidth, viewHeight) * 0.13;
  const gap = panelSize * 0.35;
  const totalWidth = panelSize * 4 + gap * 3;
  const startX = viewWidth / 2 - totalWidth / 2;
  const y = viewHeight * 0.12;

  for (let i = 0; i < 4; i++) {
    const panelStart = ENDING_MONTAGE_START + i * ENDING_MONTAGE_PANEL_DURATION;
    const localT = (phaseTimer - panelStart) / ENDING_MONTAGE_PANEL_DURATION;
    if (localT < 0 || localT > 1) continue;
    const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, localT)));
    if (envelope <= 0.01) continue;

    const stage = STAGES[i];
    const x = startX + i * (panelSize + gap);
    ctx.save();
    ctx.globalAlpha = envelope;
    ctx.beginPath();
    ctx.rect(x, y, panelSize, panelSize);
    ctx.clip();

    const bg = ctx.createLinearGradient(0, y, 0, y + panelSize);
    bg.addColorStop(0, stage.art.skyTop);
    bg.addColorStop(1, stage.art.skyBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, panelSize, panelSize);

    ctx.translate(x + panelSize / 2, y + panelSize * 0.62);
    const u = panelSize * 0.34;
    ctx.fillStyle = "rgba(220,232,255,0.92)";
    ctx.strokeStyle = "rgba(220,232,255,0.92)";
    switch (stage.heroLandmark.kind) {
      case "heroDomeIntact":
      case "heroDomeSunken":
        // Restored reading: the whole dome, never the submerged variant —
        // this is "what it looked like," not "what happened to it."
        drawHeroDomeMotif(ctx, u, timeSec, {});
        if (i === 0) {
          ctx.globalCompositeOperation = "lighter";
          glow(ctx, { x: 0, y: u * 0.5 }, u * 0.5, "rgba(230,240,255,0.6)");
        }
        break;
      case "heroLanternGantry":
        drawHeroLanternGantryMotif(ctx, u, timeSec);
        break;
      case "heroMural":
        drawHeroMuralMotif(ctx, u, timeSec, 1);
        break;
      default:
        break;
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = envelope * 0.5;
    ctx.strokeStyle = "rgba(220,232,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, panelSize - 1, panelSize - 1);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Phase overlays
// ---------------------------------------------------------------------------

// A quick red flash on the instant of death, settling into a held dark-red
// tint for the rest of the pause before the stage resets — so "you lost" is
// unambiguous even though nothing on screen says it.
function drawDeathOverlay(ctx: CanvasRenderingContext2D, viewWidth: number, viewHeight: number, phaseTimer: number) {
  const flash = Math.max(0, 1 - phaseTimer / 0.35);
  const hold = Math.min(0.5, phaseTimer / 0.5);
  ctx.fillStyle = `rgba(90,0,0,${hold})`;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,70,60,${flash * 0.55})`;
    ctx.fillRect(0, 0, viewWidth, viewHeight);
  }
}

// A slow, calm wash to the opposite mood of the death flash: reaching the
// moon flower stops the player's own light from drawing (see render()) and
// gently brightens the whole screen instead, so "the game is over" reads
// distinctly from "you reached a flower and it's about to advance" even
// though neither state uses any text.
function drawWinOverlay(ctx: CanvasRenderingContext2D, viewWidth: number, viewHeight: number, phaseTimer: number) {
  const t = Math.min(1, phaseTimer / 1.8);
  ctx.fillStyle = `rgba(225,238,255,${(0.16 * t).toFixed(3)})`;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
}

// ---------------------------------------------------------------------------
// Prologue — a fixed, unskippable ~6.5s visual beat, pure function of
// `prologueTime`, shown before the real game loop starts at all. Not a
// tutorial: it names nothing and asks nothing, it just shows what the
// sanctuary looked like whole, then what changed, using The Garden's own
// art/motifs rather than bespoke art. The held orb past 5.6s doubles as the
// explicit click target main.ts routes the first `audio.ensureStarted()`
// call through, satisfying the browser's real-user-gesture requirement.
// ---------------------------------------------------------------------------

const PROLOGUE_GANTRY_AT = 2.6;
const PROLOGUE_CLOSE_AT = 4.0;
const PROLOGUE_FADE_AT = 5.0;
const PROLOGUE_HOLD_AT = 5.6;

export function renderPrologue(ctx: CanvasRenderingContext2D, viewWidth: number, viewHeight: number, prologueTime: number) {
  const t = prologueTime;
  ctx.save();
  ctx.fillStyle = "#050507";
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  if (t >= PROLOGUE_HOLD_AT) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 1.6);
    const p = { x: viewWidth / 2, y: viewHeight / 2 };
    const unit = Math.min(viewWidth, viewHeight);
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, p, unit * 0.16 * pulse, "rgba(200,220,255,0.35)");
    glow(ctx, p, unit * 0.06 * pulse, "rgba(225,235,255,0.9)");
    ctx.restore();
    return;
  }

  const art = STAGES[0].art;
  const fadeIn = Math.min(1, t / 1.2);
  const closeT = Math.min(1, Math.max(0, (t - PROLOGUE_CLOSE_AT) / 1.0));
  const gantryT = Math.min(1, Math.max(0, (t - PROLOGUE_GANTRY_AT) / 1.0));
  const toBlack = Math.min(1, Math.max(0, (t - PROLOGUE_FADE_AT) / (PROLOGUE_HOLD_AT - PROLOGUE_FADE_AT)));
  const overallAlpha = fadeIn * (1 - toBlack);

  ctx.globalAlpha = overallAlpha;
  const bg = ctx.createLinearGradient(0, 0, 0, viewHeight);
  bg.addColorStop(0, art.skyTop);
  bg.addColorStop(1, art.skyBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  const domeX = viewWidth * 0.5;
  const domeY = viewHeight * 0.62;
  const domeU = Math.min(viewWidth, viewHeight) * 0.16;
  const gantryX = viewWidth * 0.78;
  const gantryY = domeY;

  ctx.save();
  ctx.translate(domeX, domeY);
  ctx.fillStyle = art.silhouette;
  ctx.strokeStyle = art.silhouette;
  drawHeroDomeMotif(ctx, domeU, t, {});
  ctx.restore();

  // Three drifting moth silhouettes near the intact dome — the only living
  // things in frame, watching the cycle work before anything breaks.
  for (let i = 0; i < 3; i++) {
    const phase = t * 0.5 + i * 2.1;
    const mx = domeX + Math.sin(phase) * domeU * 1.3;
    const my = domeY - domeU * 0.4 + Math.cos(phase * 0.7) * domeU * 0.3;
    ctx.save();
    ctx.globalAlpha = overallAlpha * 0.6;
    ctx.fillStyle = art.silhouette;
    ctx.beginPath();
    ctx.ellipse(mx, my, 4, 2.4, phase, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The flower itself, closing over 4.0-5.0s as the light stops returning.
  const flowerX = domeX;
  const flowerY = domeY - domeU * 0.15;
  const flowerR = domeU * 0.22 * (1 - closeT * 0.85);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, { x: flowerX, y: flowerY }, flowerR * 2.2, `rgba(230,240,255,${(0.5 * (1 - closeT)).toFixed(3)})`);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(235,245,255,${(0.85 * (1 - closeT * 0.6)).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(flowerX, flowerY, Math.max(1, flowerR), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The lantern gantry, fading in from 2.6s — the human infrastructure that
  // starts intercepting the moonlight the motes below are carrying.
  if (gantryT > 0) {
    ctx.save();
    ctx.globalAlpha = overallAlpha * gantryT;
    ctx.translate(gantryX, gantryY);
    ctx.fillStyle = art.silhouette;
    ctx.strokeStyle = art.silhouette;
    drawHeroLanternGantryMotif(ctx, domeU * 0.6, t);
    ctx.restore();

    const amberT = Math.max(gantryT, closeT);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, { x: gantryX, y: gantryY - domeU * 0.1 }, domeU * 0.42, `rgba(255,180,110,${(0.35 * amberT * overallAlpha).toFixed(3)})`);
    ctx.restore();
  }

  // Moonlight motes traveling flower -> dome, one bending amber toward the
  // gantry's cage once it exists -- silver turning to trapped light, right
  // in front of the player, before a single frame of real gameplay.
  if (t >= 1.2 && t < PROLOGUE_CLOSE_AT + 0.6) {
    const moteCount = 4;
    const cycle = 2.2;
    for (let i = 0; i < moteCount; i++) {
      const bend = gantryT > 0 && i === moteCount - 1;
      const phase = (((t - 1.2) + (i * cycle) / moteCount) % cycle) / cycle;
      const targetX = bend ? gantryX : domeX;
      const targetY = bend ? gantryY : domeY - domeU * 0.9;
      const arcHeight = domeU * 0.5;
      const x = flowerX + (targetX - flowerX) * phase;
      const y = flowerY + (targetY - flowerY) * phase - Math.sin(Math.PI * phase) * arcHeight;
      const rgb = blendChannels(MOONLIGHT_RGB, [255, 170, 90], bend ? phase : 0);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = overallAlpha;
      glow(ctx, { x, y }, 6, `rgba(${rgb},0.8)`);
      ctx.restore();
    }
  }

  // A single crack-flash right as the fade to black begins.
  const flashT = Math.min(1, Math.max(0, (t - PROLOGUE_FADE_AT) / 0.3));
  if (flashT > 0 && flashT < 1) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.sin(Math.PI * flashT) * 0.7;
    ctx.fillStyle = "rgba(220,230,255,1)";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.restore();
  }

  ctx.restore();

  if (toBlack > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(5,5,7,${toBlack.toFixed(3)})`;
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.restore();
  }
}
