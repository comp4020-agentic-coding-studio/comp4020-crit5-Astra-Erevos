# Process overview

A reading-guide to how the work came together — a map to your process, not an
essay about it.

## What I built

A five-stage Canvas 2D game, *Moth*: the player moves a light with the
pointer, and an autonomous moth is drawn toward whatever attracts it most
strongly — the light, or a hazard. There are no gameplay instructions: the
first pointer move teaches the core interaction, while short narrative titles
and result-state controls appear only as story or feedback rather than
explaining how to play. The whole rule set (light attracts, hazards attract
and kill, flowers end a stage) has to be learned by watching the moth react.
The five stages (Garden → Lanterns → Marsh → Ruins →
Moon Flower) escalate purely through geometry and hazard behaviour — moving
hazards, moon-fragment collection gating the last two flowers, and a final
stage that only makes sense once every earlier rule has been internalised.

## The moments that mattered

1. **Stage 1–2 vertical slice**
   [`27662dc`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/27662dc93f112e1cecfa83a781e312bd1d62a956)
   - **What happened:** starting from nothing, the first question was whether
     "move a light, watch an autonomous entity react to it" could carry a game
     with zero on-screen instruction at all.
   - **What I decided:** keep the very first build minimal on purpose — one
     open flower, one stationary hazard — so the core attraction mechanic
     could be judged on its own, before any art or narrative layer existed to
     mask whether it actually read as a rule.
   - **What changed:** `moth.ts`'s `stepMoth` (turn-rate-clamped heading toward
     a strength/distance-weighted sum of light and hazards) and `outcome.ts`'s
     pure `checkOutcome` became the stable core that every later stage builds
     on without modification.
   - **How it was verified:** `spec/outcome.test.ts` from this commit covers
     boundary-inclusive win/loss radii and multi-hazard precedence; the rest
     — whether the mechanic reads as a rule at all — could only be judged by
     actually playing it, which is what the next two moments are about.

2. **Playtest surfaced unreadable entities and a punishing death loop**
   [`702c2ec`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/702c2ec18154c4d537d1a1f5da75347e44bca327)
   - **What happened:** playing the vertical slice, moth vs. light and flower
     vs. hazard were all simple abstract shapes — visually ambiguous, and
     losing gave no feedback beyond the moth just stopping.
   - **What I decided:** rather than add explanatory UI (which the no-tutorial
     constraint rules out), the fix had to be entirely in what each entity
     looks like and how it behaves at the moment of death — shape and motion
     doing the job text would otherwise do.
   - **What changed:** redrew all four entities as distinct silhouettes (moth
     body+wings, breathing light, blooming flower, jittering spike-burst
     hazard with a danger pulse), and gave loss a choreographed sequence — the
     killing hazard surges, the moth is visibly dragged in over ~0.3s, a red
     flash settles into a held tint, then the stage auto-resets.
   - **How it was verified:** `checkOutcome`/`stepMoth`/state were untouched
     and the existing test suite stayed green; the actual readability and
     death-feedback judgement came from playing it myself, not from a diff
     review.

3. **Hazard pull was global — a mistake was unrecoverable, not risky**
   [`3be882e`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/3be882e06eb264d10f8f33e126839b28eff566a3)
   - **What happened:** Stage 2's hazard was pulling the moth across the
     *entire* stage, so once a player drifted toward it they could lose
     control completely rather than make a mistake they could still recover
     from — closer to instant-loss than to stakes.
   - **What I decided:** hazards should only compete with the player's light
     once the moth is already close to one — a local `influenceRadius`
     ramping from a faint tug at its edge to full strength at the core — while
     the light stays the dominant, always-on force from any distance. I also
     removed the auto-restart-after-death loop in favour of a manual Retry, so
     a death is a deliberate pause the player chooses to end, not something
     that silently resets under them.
   - **What changed:** `moth.ts` gained the localized pull, `state.ts` moved
     Stage 2's hazard to give the direct start-to-flower path a safety margin
     outside that radius, and a faint influence ring plus proximity pulse now
     visibly track the exact range that drives the pull.
   - **How it was verified:** by playing it — confirming a hazard is now a
     recoverable risk near its core rather than a stage-wide trap, and that
     Retry fully reinitializes moth/light/death state.

4. **Root-caused an orbiting bug instead of patching around it**
   [`d0bd18d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/d0bd18d2cd6ec6276318945501c94775f2d4a410)
   - **What happened:** the moth would endlessly circle the light instead of
     arriving at it. The superficial fix would have been to just increase the
     turn rate until orbiting became invisible; I traced it instead to the
     actual cause — `stepMoth` held a fixed follow speed all the way to the
     target, and its clamped turn rate gives a fixed minimum turning radius at
     that speed, too wide to converge on a point.
   - **What I decided:** add `arrivalSpeedCap`, a hard (non-eased) speed
     ceiling driven only by distance to the light, layered on top of the
     existing eased acceleration — and specifically recompute it fresh every
     frame, after a first attempt with an *eased* cap still orbited (at a
     smaller radius) because actual speed lagged the shrinking target.
   - **What changed:** `moth.ts` gained the same-frame arrival cap; separately
     fixed `checkOutcome`'s flower win-check, whose raw radius sum
     under-counted what was visually a touch, via a `FLOWER_VISUAL_OVERSHOOT`
     applied only at the flower call site.
   - **How it was verified:** added `spec/moth.test.ts` — full speed while
     far, a lower cap once close, slowing to a stop, converging and *holding*
     over a simulated 10s (not just slowing), hazard bias not blocking
     arrival, smooth re-acceleration once the light moves away. This is the
     project's clearest example of a game rule backed by a focused automated
     test rather than just a visual check. (Noted in the commit itself: the
     feel/controllability judgement was still reserved for a real playtest —
     the test proves the rule, not the experience.)

5. **Expanded to five stages with fragment-gated progression**
   [`69df843`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/69df843de74460fc122a172585c703d3cc4f0c7f),
   [`b9f1216`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/b9f121675e61bb3a22575e9cf3c240b6f8f21847)
   - **What happened:** the validated Stage 1–2 core needed to become a full
     arc — moving hazards, more stages, and a real ending — without touching
     the already-proven `stepMoth`/`checkOutcome`.
   - **What I decided:** keep moving hazards a pure function of elapsed stage
     time (anchor + amplitude·(cos, sin) of `stageTime`, no stored velocity),
     specifically so resetting a stage is free — `resetStage`/`advanceStage`
     just zero `stageTime` — and so the existing `Attractor` type, `stepMoth`,
     and `checkOutcome` need zero changes for moving hazards to work at all.
   - **What changed:** Stages 3–5 added (drifting single hazard, two
     out-of-phase hazards, three staggered hazards plus the larger "moon"
     flower), a new `resolveHazards()` in `hazards.ts`, and moon-fragment
     collection gating the last two flowers.
   - **How it was verified:** `spec/hazards.test.ts` and `spec/fragments.test.ts`
     plus a throwaway (uncommitted) simulation that drove real
     `stepMoth`/`checkOutcome`/`resolveHazards` through all five stages every
     time — it caught a real bug (Stage 5's original hazard placement let its
     influence radius brush the direct start-to-flower line, causing
     near-instant losses under passive play) before it ever reached a human
     playtest.

6. **Playtest-tuned pacing, then rebuilt narrative/environmental storytelling
   across two more passes**
   [`d6e4139`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/d6e4139a6f57d11a4d4561fbc077744ae7469d26),
   [`92956df`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/92956df59d3d70b9be440999bf614ec97d646c75)
   - **What happened:** a real five-stage playthrough confirmed the mechanic
     and progression held up, but Stage 3–5's hazard drift felt too slow to
     hold attention and the Moon Flower's idle sway made the final stage feel
     static — this is the change that came from actually playing the finished
     progression, not from re-reading the diff. Separately, the story lived
     in the design write-up, not on screen, and the game was silent until the
     first death (nothing before that reliably counted as the
     AudioContext-unlocking gesture).
   - **What I decided:** for pacing, a narrow numeric tune (hazard
     `angularSpeed` +16–19%, Moon Flower sway +13%) rather than touching
     positions, strength, or route structure, keeping every already-validated
     safety margin intact. For the silent/hidden-story problem, add a fixed
     visual prologue ending on an unambiguous click that doubles as the audio
     unlock gesture, rather than any read-elsewhere lore.
   - **What changed:** `d6e4139` retuned drift/sway only. `92956df` added the
     prologue, a Memory Echo on fragment collection, an ambient beat in Stage
     2, a lantern-to-wisp beat in the Stage 2–3 flood transition, a Stage 4
     mural payoff, tuned moon visibility across all five stages, and an ending
     memory montage.
   - **How it was verified:** the pacing tune re-ran the same throwaway
     five-stage simulation to confirm nothing broke mechanically, then relied
     on a second real playthrough to judge the pacing itself — the thing a
     simulation can't tell you. `pnpm check` stayed green throughout (37/37
     tests at the time).

7. **Two rebuild passes on rendering realism and performance**
   [`2b908e3`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/2b908e3202f1eca14015b07aa7fcbe5d14c7d738),
   [`7545cf1`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/7545cf1671c4401535718643861e01da5c26c61b)
   - **What happened:** with the mechanic, progression, and narrative beats
     all in place, the remaining gap was that the world still read as a
     mechanic prototype rather than a place — flat material shading, and
     geometry that didn't hold up as "structure" under close inspection.
   - **What I decided:** isolate the rendering work from the already-verified
     gameplay logic — no changes to `moth.ts`, `outcome.ts`, `hazards.ts`, or
     `state.ts` in either commit, everything confined to `render.ts` (plus a
     small `audio.ts` pass in the first) — so visual changes could be tested
     without changing the core game rules.
   - **What changed:** a full material-shading pass, then a structural
     geometry rebuild of the game world.
   - **How it was verified:** `pnpm check`'s full suite staying green across
     both commits is the direct evidence that no gameplay logic moved even
     though ~1900 and ~570 lines of `render.ts` changed respectively; visual
     quality itself was judged by looking at the rendered page, not by tests.

8. **Final playtest: stale light, hazard-colour inconsistency, and an
   unclear goal flower**
   [`16701a7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Astra-Erevos/commit/16701a730edcae5b8fbb89f4e14c8a74d143c4a7)
   - **What happened:** a full playthrough turned up three separate problems
     no amount of code review would have caught: (a) `advanceStage()` (unlike
     `resetStage()`) never cleared `state.light`, so a stale mouse-light
     position could carry into the next stage and kill the moth on entry; (b)
     the lantern hazard (warm amber) and wisp hazard (white-green) didn't read
     as the same kind of danger across stages; (c) the win-condition flower
     didn't stand out enough from the surrounding scene to read as "touch this
     to win" at a glance.
   - **What I decided:** fix the state bug at its root (add the missing reset,
     matching `resetStage()`'s existing behaviour) rather than working around
     symptoms; unify every hazard onto one warning-red palette so "this kills
     you" means one consistent colour everywhere; and make every stage's
     target flower a vivid orange while unbloomed, reserving the Moon
     Flower's distinct cool blue-white bloom for the brief win/ending reveal
     only (it's never visible mid-play, since `bloomed` only flips true at
     the instant of winning) — so the new "orange = win" rule and the
     existing ending payoff don't contradict each other.
   - **What changed:** `advanceStage()` now sets `state.light = null`; the
     lantern and wisp hazards share one red palette (plus a pulsing warning
     ring and rising embers); `drawFlower()` keys its colour off `!bloom`
     first; moon fragments got a clearer double-layer glow and sonar ping;
     flood/drain transitions gained a rippling waterline and particles; the
     ending montage's timing was reworked to fade-in/hold/fade-out instead of
     a blink-per-panel.
   - **How it was verified:** `pnpm check` green (typecheck, build, full test
     suite) after the change, plus a second real playthrough at both
     1920×1080 and 390×844 confirming hazards and the goal flower are now
     visually unambiguous and the stale-light death no longer occurs on
     stage transitions.

## Testing note

The spec asks for at least one game rule backed by a focused automated test:
`spec/moth.test.ts` (moment 4) is the clearest case — it locks down the
arrival-speed-cap rule itself (converge-and-hold, not just slow down) rather
than testing rendering or feel. `spec/outcome.test.ts`, `spec/hazards.test.ts`,
`spec/fragments.test.ts`, `spec/progression.test.ts`, and
`spec/invariants.test.ts` cover the rest of the rule set (51 tests total,
all green as of `16701a7`).

The spec also asks for one change that came from actual playtesting rather
than code review: moments 6 and 8 both are — the drift/sway pacing tune and
the final colour/state fixes were only found by playing the finished game,
not by reading a diff.
