// Short sounds for a finished run, made with the Web Audio API so nothing has to be shipped or licensed:
// a rising two-note chime when everything went through, a low double buzz when something failed.
// Settings › General decides when they play (never, failures only, always).

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One note: `freq` Hz for `ms` from `at` seconds on the context's clock, with a soft attack and release. */
function note(c: AudioContext, at: number, freq: number, ms: number, type: OscillatorType, volume: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + ms / 1000 + 0.02);
}

export type FinishSound = 'ok' | 'error';

/** Plays the sound for how a run ended; silently does nothing where audio is not available (a browser without a gesture yet). */
export function playFinishSound(kind: FinishSound): void {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + 0.01;
  if (kind === 'ok') {
    note(c, t0, 659.25, 140, 'sine', 0.18); // E5
    note(c, t0 + 0.13, 880, 220, 'sine', 0.18); // A5
  } else {
    note(c, t0, 196, 170, 'triangle', 0.22); // G3
    note(c, t0 + 0.22, 164.81, 260, 'triangle', 0.22); // E3
  }
}
