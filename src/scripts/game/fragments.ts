import type { FragmentConfig, Vec2 } from "./state";

// Pure pickup check, same circle-distance idiom as checkOutcome. Idempotent —
// an entry already true never flips back — so calling this every frame with
// the previous attempt's array is always safe, and a fragment is absorbed
// purely by the moth passing through it, with no new input.
export function collectFragments(
  mothPos: Vec2,
  fragments: FragmentConfig[],
  collected: boolean[],
  mothRadius: number,
): boolean[] {
  return fragments.map((fragment, i) => {
    if (collected[i]) return true;
    const dist = Math.hypot(mothPos.x - fragment.pos.x, mothPos.y - fragment.pos.y);
    return dist <= fragment.radius + mothRadius;
  });
}
