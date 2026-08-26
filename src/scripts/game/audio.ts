// All sound is procedural Web Audio — oscillators, filters, gain envelopes.
// No audio files, no separate mixing pipeline. The AudioContext is only ever
// constructed from `ensureStarted()`, which main.ts calls from inside its
// existing pointer handler — i.e. only after a real user gesture, satisfying
// browser autoplay policy with no extra prompt of our own.
export type AudioUpdateParams = {
  lightActive: boolean; // whether state.light is currently set
  mothSpeedT: number; // moth speed normalized to roughly 0..1
  timeSec: number;
  maxProximity: number; // 0..1, see hazards.ts's maxHazardProximity
  // Which kind of hazard is currently closest — purely a timbre choice (see
  // update()'s wisp wobble below), never read for gameplay.
  nearestHazardKind?: "lantern" | "wisp";
  // Which of STAGES[] is current — drives the ambient bed's slow crossfade
  // below. Purely a mood choice, same as nearestHazardKind, never read for
  // gameplay.
  stageIndex: number;
};

// The ambient bed underneath every stage, all voices drawn from the same
// A-rooted harmonic family the hum/hazard/chime tones already use (220 = A3
// is the hum's root; the chimes are the 4th/6th/8th/10th/12th harmonics of
// that same 55Hz series). Each stage only turns a subset of these voices up
// or down — nothing here is stage-exclusive gear, it's one instrument whose
// balance drifts as the story does. `color` (550, the 10th harmonic's lower
// octave — the major third the hum/hazard pair never states) stays silent
// until Stage 4, so its arrival there reads as the harmony finally
// completing rather than a new sound appearing from nowhere.
const STAGE_MIX: { padA2: number; padA3: number; padE4: number; sparkle: number; unstable: number; wind: number; weight: number; color: number }[] = [
  // 0 The Garden — quiet, mysterious, a touch of moonlight.
  { padA2: 0.025, padA3: 0.05, padE4: 0.02, sparkle: 0.018, unstable: 0, wind: 0, weight: 0, color: 0 },
  // 1 The Lanterns — the same bed, now with an unstable artificial-light timbre.
  { padA2: 0.025, padA3: 0.035, padE4: 0.02, sparkle: 0.01, unstable: 0.045, wind: 0, weight: 0, color: 0 },
  // 2 The Marsh — wetter, colder, emptier: pad thins out, wind arrives.
  { padA2: 0.02, padA3: 0.015, padE4: 0.012, sparkle: 0.006, unstable: 0.025, wind: 0.05, weight: 0.012, color: 0 },
  // 3 The Ruins — heavier, more ruin-like: sub weight dominates, pad thinnest.
  { padA2: 0.03, padA3: 0.012, padE4: 0.008, sparkle: 0.004, unstable: 0.015, wind: 0.035, weight: 0.06, color: 0 },
  // 4 The Moon Flower — every earlier voice returns, and `color` completes
  // the chord for the first time; onFinalBloom() pushes this further still.
  { padA2: 0.025, padA3: 0.055, padE4: 0.04, sparkle: 0.022, unstable: 0.01, wind: 0.015, weight: 0.015, color: 0.025 },
];
// How slowly the ambient bed drifts between two stages' mixes — a weather
// change, not a switch, since STAGE_MIX targets get set every frame in
// update() regardless of whether stageIndex actually changed this frame.
const STAGE_MIX_TIME_CONSTANT = 2.2;

export type AudioController = {
  ensureStarted: () => void;
  update: (params: AudioUpdateParams) => void;
  onFragmentCollected: () => void;
  onMemoryEcho: () => void;
  onBloom: () => void;
  onFinalBloom: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
};

export function createAudio(): AudioController {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  const restingVolume = 0.5;

  let humGain: GainNode | null = null;
  let hazardOsc: OscillatorNode | null = null;
  let hazardGain: GainNode | null = null;
  let lastFlutterBeat = -1;

  // The ambient stage bed — see STAGE_MIX above. Each named gain is the one
  // update() retargets every frame; every other node here is either the
  // voice feeding it or an LFO shaping it, and never touched again once
  // ensureStarted() wires it up.
  let padA2Gain: GainNode | null = null;
  let padA3Gain: GainNode | null = null;
  let padE4Gain: GainNode | null = null;
  let sparkleGain: GainNode | null = null;
  let unstableGain: GainNode | null = null;
  let windGain: GainNode | null = null;
  let weightGain: GainNode | null = null;
  let colorGain: GainNode | null = null;

  function ensureStarted(): void {
    if (ctx) {
      // A context can come back suspended after e.g. a tab backgrounding —
      // any later gesture that calls this should still be able to revive it,
      // not just the very first one.
      if (ctx.state === "suspended") void ctx.resume();
      return;
    }
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : restingVolume;
    master.connect(ctx.destination);

    // Player light: a faint continuous hum, silent until a light exists.
    // This is the game's "real moonlight" timbre: clean sine, no detune —
    // every trapped/unstable tone below is defined relative to it.
    const humOsc = ctx.createOscillator();
    humOsc.type = "sine";
    humOsc.frequency.value = 220;
    humGain = ctx.createGain();
    humGain.gain.value = 0;
    humOsc.connect(humGain).connect(master);
    humOsc.start();

    // Hazard proximity: a low, filtered, slightly harsh oscillator that
    // only becomes audible — and rises in pitch — as the moth gets close.
    // Its sawtooth timbre is deliberately "the same light, gone unstable":
    // related in register to the clean hum above, but detuned and beating.
    hazardOsc = ctx.createOscillator();
    hazardOsc.type = "sawtooth";
    hazardOsc.frequency.value = 55;
    hazardOsc.detune.value = 0;
    const hazardFilter = ctx.createBiquadFilter();
    hazardFilter.type = "lowpass";
    hazardFilter.frequency.value = 220;
    hazardGain = ctx.createGain();
    hazardGain.gain.value = 0;
    hazardOsc.connect(hazardFilter).connect(hazardGain).connect(master);
    hazardOsc.start();

    // Ambient bed, all rooted on the same A the hum/hazard/chime tones are
    // (see STAGE_MIX) — starts silent, update() fades voices in per stage.
    const padA2Osc = ctx.createOscillator();
    padA2Osc.type = "sine";
    padA2Osc.frequency.value = 110;
    padA2Gain = ctx.createGain();
    padA2Gain.gain.value = 0;
    padA2Osc.connect(padA2Gain).connect(master);
    padA2Osc.start();

    const padA3Osc = ctx.createOscillator();
    padA3Osc.type = "triangle";
    padA3Osc.frequency.value = 220;
    padA3Gain = ctx.createGain();
    padA3Gain.gain.value = 0;
    padA3Osc.connect(padA3Gain).connect(master);
    padA3Osc.start();

    const padE4Osc = ctx.createOscillator();
    padE4Osc.type = "sine";
    padE4Osc.frequency.value = 330;
    padE4Gain = ctx.createGain();
    padE4Gain.gain.value = 0;
    padE4Osc.connect(padE4Gain).connect(master);
    padE4Osc.start();

    // Moonlight glint: a slow tremolo (not a steady tone) so Stage 1/4's
    // sparkle reads as light catching something, not a held pitch.
    const sparkleOsc = ctx.createOscillator();
    sparkleOsc.type = "sine";
    sparkleOsc.frequency.value = 880;
    sparkleGain = ctx.createGain();
    sparkleGain.gain.value = 0;
    sparkleOsc.connect(sparkleGain).connect(master);
    sparkleOsc.start();
    const sparkleLfo = ctx.createOscillator();
    sparkleLfo.type = "sine";
    sparkleLfo.frequency.value = 0.11;
    const sparkleLfoDepth = ctx.createGain();
    sparkleLfoDepth.gain.value = 0.006;
    sparkleLfo.connect(sparkleLfoDepth).connect(sparkleGain.gain);
    sparkleLfo.start();

    // Unstable artificial light (Stage 1's caged-conduit ambience): two
    // sawtooths a few cents apart, same family as hazardOsc but held as a
    // bed rather than triggered by proximity, with a slow LFO widening and
    // narrowing the beat between them so it never settles into one pitch.
    const unstableOscA = ctx.createOscillator();
    unstableOscA.type = "sawtooth";
    unstableOscA.frequency.value = 110;
    const unstableOscB = ctx.createOscillator();
    unstableOscB.type = "sawtooth";
    unstableOscB.frequency.value = 110;
    unstableOscB.detune.value = 6;
    const unstableFilter = ctx.createBiquadFilter();
    unstableFilter.type = "lowpass";
    unstableFilter.frequency.value = 500;
    unstableGain = ctx.createGain();
    unstableGain.gain.value = 0;
    unstableOscA.connect(unstableFilter);
    unstableOscB.connect(unstableFilter);
    unstableFilter.connect(unstableGain).connect(master);
    unstableOscA.start();
    unstableOscB.start();
    const unstableLfo = ctx.createOscillator();
    unstableLfo.type = "sine";
    unstableLfo.frequency.value = 0.6;
    const unstableLfoDepth = ctx.createGain();
    unstableLfoDepth.gain.value = 12;
    unstableLfo.connect(unstableLfoDepth).connect(unstableOscB.detune);
    unstableLfo.start();

    // Wind/water (Stage 2's wet, cold, empty air): two close triangles
    // through a bandpass whose center slowly drifts, so it reads as moving
    // air rather than a pitched note.
    const windOscA = ctx.createOscillator();
    windOscA.type = "triangle";
    windOscA.frequency.value = 146;
    const windOscB = ctx.createOscillator();
    windOscB.type = "triangle";
    windOscB.frequency.value = 174;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 220;
    windFilter.Q.value = 1.2;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windOscA.connect(windFilter);
    windOscB.connect(windFilter);
    windFilter.connect(windGain).connect(master);
    windOscA.start();
    windOscB.start();
    const windLfo = ctx.createOscillator();
    windLfo.type = "sine";
    windLfo.frequency.value = 0.05;
    const windLfoDepth = ctx.createGain();
    windLfoDepth.gain.value = 80;
    windLfo.connect(windLfoDepth).connect(windFilter.frequency);
    windLfo.start();

    // Ruin weight (Stage 3): the hazard/hum root an octave down (55, same
    // pitch class as hazardOsc's base), with a slow breathing pulse.
    const weightOsc = ctx.createOscillator();
    weightOsc.type = "sine";
    weightOsc.frequency.value = 55;
    const weightFilter = ctx.createBiquadFilter();
    weightFilter.type = "lowpass";
    weightFilter.frequency.value = 300;
    weightGain = ctx.createGain();
    weightGain.gain.value = 0;
    weightOsc.connect(weightFilter).connect(weightGain).connect(master);
    weightOsc.start();
    const weightLfo = ctx.createOscillator();
    weightLfo.type = "sine";
    weightLfo.frequency.value = 0.15;
    const weightLfoDepth = ctx.createGain();
    weightLfoDepth.gain.value = 0.015;
    weightLfo.connect(weightLfoDepth).connect(weightGain.gain);
    weightLfo.start();

    // The major third (550 = the 10th harmonic's lower octave) — silent
    // until Stage 4, see STAGE_MIX.
    const colorOsc = ctx.createOscillator();
    colorOsc.type = "sine";
    colorOsc.frequency.value = 550;
    colorGain = ctx.createGain();
    colorGain.gain.value = 0;
    colorOsc.connect(colorGain).connect(master);
    colorOsc.start();

    if (ctx.state === "suspended") void ctx.resume();
  }

  function update(params: AudioUpdateParams): void {
    if (!ctx || !humGain || !hazardGain || !hazardOsc) return;
    const now = ctx.currentTime;

    if (padA2Gain && padA3Gain && padE4Gain && sparkleGain && unstableGain && windGain && weightGain && colorGain) {
      const mix = STAGE_MIX[params.stageIndex] ?? STAGE_MIX[0];
      padA2Gain.gain.setTargetAtTime(mix.padA2, now, STAGE_MIX_TIME_CONSTANT);
      padA3Gain.gain.setTargetAtTime(mix.padA3, now, STAGE_MIX_TIME_CONSTANT);
      padE4Gain.gain.setTargetAtTime(mix.padE4, now, STAGE_MIX_TIME_CONSTANT);
      sparkleGain.gain.setTargetAtTime(mix.sparkle, now, STAGE_MIX_TIME_CONSTANT);
      unstableGain.gain.setTargetAtTime(mix.unstable, now, STAGE_MIX_TIME_CONSTANT);
      windGain.gain.setTargetAtTime(mix.wind, now, STAGE_MIX_TIME_CONSTANT);
      weightGain.gain.setTargetAtTime(mix.weight, now, STAGE_MIX_TIME_CONSTANT);
      colorGain.gain.setTargetAtTime(mix.color, now, STAGE_MIX_TIME_CONSTANT);
    }

    humGain.gain.setTargetAtTime(params.lightActive ? 0.045 : 0, now, 0.3);
    hazardGain.gain.setTargetAtTime(params.maxProximity * 0.09, now, 0.15);
    hazardOsc.frequency.setTargetAtTime(50 + params.maxProximity * 45, now, 0.2);
    // A wisp is trapped light that has already drifted loose from its
    // lantern — same family as the lantern drone, but with an added slow
    // pitch wobble so it reads as more adrift/unstable than a still-caged
    // lantern's steadier (if still detuned) tone.
    const wobble = params.nearestHazardKind === "wisp" ? Math.sin(params.timeSec * 3.1) * 18 : 0;
    hazardOsc.detune.setTargetAtTime(wobble, now, 0.05);

    // Moth flutter: a soft tick retriggered once per wingbeat, only while
    // the moth is actually moving — reuses the exact flap phase render.ts
    // animates the wings with, so the sound and the visible flap agree.
    const beat = Math.floor((params.timeSec * 9) / (Math.PI * 2));
    if (beat !== lastFlutterBeat && params.mothSpeedT > 0.05) {
      lastFlutterBeat = beat;
      playFlutterTick(params.mothSpeedT);
    }
  }

  function playFlutterTick(strength: number): void {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 340;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.022 * Math.min(1, strength), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  function playChime(freqs: number[], duration: number, gainScale: number): void {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.06 * gainScale, now + duration * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    }
  }

  // Fragment collected: a short bright chime — two notes, quick decay. Pure
  // moonlight timbre, same family as the ending's full chord.
  function onFragmentCollected(): void {
    playChime([880, 1320], 0.5, 0.7);
  }

  // Memory Echo: the fragment chime, extended and filled out with the notes
  // either side of it — a brief glimpse of the full harmonic layer that
  // exists once the flower blooms, immediately folding back down.
  function onMemoryEcho(): void {
    playChime([660, 880, 1100, 1320], 0.85, 0.85);
  }

  // Flower bloom: a soft harmonic chime — three-note chord, gentle decay.
  function onBloom(): void {
    playChime([440, 660, 880], 1.4, 1);
  }

  // Final bloom: the same chord technique, richer and slower — a full
  // harmonic swell for the ending. The ambient bed resolves with it: every
  // texture the earlier stages introduced (unstable/wind/weight) settles
  // toward silence while `color` — held back since Stage 0 — swells past
  // its normal Stage 4 level, so the whole soundtrack, not just this one
  // chime, lands on the finished chord.
  function onFinalBloom(): void {
    playChime([220, 330, 440, 660, 880], 3.2, 1.3);
    if (!ctx) return;
    const now = ctx.currentTime;
    unstableGain?.gain.setTargetAtTime(0, now, 2.5);
    windGain?.gain.setTargetAtTime(0, now, 2.5);
    weightGain?.gain.setTargetAtTime(0, now, 2.5);
    colorGain?.gain.setTargetAtTime(0.045, now, 2.0);
    padA3Gain?.gain.setTargetAtTime(0.07, now, 2.0);
    sparkleGain?.gain.setTargetAtTime(0.03, now, 2.0);
  }

  function toggleMute(): boolean {
    muted = !muted;
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : restingVolume, ctx.currentTime, 0.05);
    return muted;
  }

  function isMuted(): boolean {
    return muted;
  }

  return { ensureStarted, update, onFragmentCollected, onMemoryEcho, onBloom, onFinalBloom, toggleMute, isMuted };
}
