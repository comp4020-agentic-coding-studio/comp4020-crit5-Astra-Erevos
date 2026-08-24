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
};

export type AudioController = {
  ensureStarted: () => void;
  update: (params: AudioUpdateParams) => void;
  onFragmentCollected: () => void;
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

  function ensureStarted(): void {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : restingVolume;
    master.connect(ctx.destination);

    // Player light: a faint continuous hum, silent until a light exists.
    const humOsc = ctx.createOscillator();
    humOsc.type = "sine";
    humOsc.frequency.value = 220;
    humGain = ctx.createGain();
    humGain.gain.value = 0;
    humOsc.connect(humGain).connect(master);
    humOsc.start();

    // Hazard proximity: a low, filtered, slightly harsh oscillator that
    // only becomes audible — and rises in pitch — as the moth gets close.
    hazardOsc = ctx.createOscillator();
    hazardOsc.type = "sawtooth";
    hazardOsc.frequency.value = 55;
    const hazardFilter = ctx.createBiquadFilter();
    hazardFilter.type = "lowpass";
    hazardFilter.frequency.value = 220;
    hazardGain = ctx.createGain();
    hazardGain.gain.value = 0;
    hazardOsc.connect(hazardFilter).connect(hazardGain).connect(master);
    hazardOsc.start();
  }

  function update(params: AudioUpdateParams): void {
    if (!ctx || !humGain || !hazardGain || !hazardOsc) return;
    const now = ctx.currentTime;
    humGain.gain.setTargetAtTime(params.lightActive ? 0.045 : 0, now, 0.3);
    hazardGain.gain.setTargetAtTime(params.maxProximity * 0.09, now, 0.15);
    hazardOsc.frequency.setTargetAtTime(50 + params.maxProximity * 45, now, 0.2);

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

  // Fragment collected: a short bright chime — two notes, quick decay.
  function onFragmentCollected(): void {
    playChime([880, 1320], 0.5, 0.7);
  }

  // Flower bloom: a soft harmonic chime — three-note chord, gentle decay.
  function onBloom(): void {
    playChime([440, 660, 880], 1.4, 1);
  }

  // Final bloom: the same chord technique, richer and slower — a full
  // harmonic swell for the ending.
  function onFinalBloom(): void {
    playChime([220, 330, 440, 660, 880], 3.2, 1.3);
  }

  function toggleMute(): boolean {
    muted = !muted;
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : restingVolume, ctx.currentTime, 0.05);
    return muted;
  }

  function isMuted(): boolean {
    return muted;
  }

  return { ensureStarted, update, onFragmentCollected, onBloom, onFinalBloom, toggleMute, isMuted };
}
