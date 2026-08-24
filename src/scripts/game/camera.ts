import { WORLD, type Vec2 } from "./state";

export type Camera = { scale: number; offsetX: number; offsetY: number };

// Fits the fixed WORLD square into whatever viewport it's shown in, centered
// and letterboxed. The letterbox is invisible because the whole canvas is
// painted the same background color as the world, so a 1920x1080 desktop and
// a 390x844 phone show the identical layout, just scaled to fit.
export function computeCamera(viewWidth: number, viewHeight: number): Camera {
  const scale = Math.min(viewWidth / WORLD.width, viewHeight / WORLD.height);
  const offsetX = (viewWidth - WORLD.width * scale) / 2;
  const offsetY = (viewHeight - WORLD.height * scale) / 2;
  return { scale, offsetX, offsetY };
}

export function worldToScreen(camera: Camera, v: Vec2): Vec2 {
  return { x: v.x * camera.scale + camera.offsetX, y: v.y * camera.scale + camera.offsetY };
}

export function screenToWorld(camera: Camera, v: Vec2): Vec2 {
  return { x: (v.x - camera.offsetX) / camera.scale, y: (v.y - camera.offsetY) / camera.scale };
}
