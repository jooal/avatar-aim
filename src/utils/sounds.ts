// Sound effects for buddy sign on/off
// Uses Web Audio API to synthesize pleasant notification sounds

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Door opening sound - creaky door with latch click
export function playSignOnSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Door creak - low frequency sweep
    const creakOsc = ctx.createOscillator();
    const creakGain = ctx.createGain();
    creakOsc.connect(creakGain);
    creakGain.connect(ctx.destination);
    creakOsc.type = 'sawtooth';
    creakOsc.frequency.setValueAtTime(80, now);
    creakOsc.frequency.linearRampToValueAtTime(120, now + 0.15);
    creakOsc.frequency.linearRampToValueAtTime(90, now + 0.3);
    creakGain.gain.setValueAtTime(0, now);
    creakGain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    creakGain.gain.linearRampToValueAtTime(0.05, now + 0.2);
    creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    creakOsc.start(now);
    creakOsc.stop(now + 0.4);

    // Latch click - short high frequency burst
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(1200, now + 0.05);
    clickGain.gain.setValueAtTime(0, now + 0.05);
    clickGain.gain.linearRampToValueAtTime(0.15, now + 0.052);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    clickOsc.start(now + 0.05);
    clickOsc.stop(now + 0.12);

    // Welcoming chime
    const chimeFreqs = [523.25, 659.25]; // C5, E5
    chimeFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + 0.15 + i * 0.1);
      gain.gain.setValueAtTime(0, now + 0.15 + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.15 + i * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + i * 0.1 + 0.3);
      osc.start(now + 0.15 + i * 0.1);
      osc.stop(now + 0.15 + i * 0.1 + 0.35);
    });
  } catch (e) {
    console.log('Could not play sign on sound:', e);
  }
}

// Door closing sound - thud with latch
export function playSignOffSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Door swing creak (shorter, closing)
    const creakOsc = ctx.createOscillator();
    const creakGain = ctx.createGain();
    creakOsc.connect(creakGain);
    creakGain.connect(ctx.destination);
    creakOsc.type = 'sawtooth';
    creakOsc.frequency.setValueAtTime(100, now);
    creakOsc.frequency.linearRampToValueAtTime(70, now + 0.1);
    creakGain.gain.setValueAtTime(0, now);
    creakGain.gain.linearRampToValueAtTime(0.05, now + 0.01);
    creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    creakOsc.start(now);
    creakOsc.stop(now + 0.15);

    // Door thud - low frequency impact
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(60, now + 0.1);
    thudOsc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
    thudGain.gain.setValueAtTime(0, now + 0.1);
    thudGain.gain.linearRampToValueAtTime(0.25, now + 0.105);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thudOsc.start(now + 0.1);
    thudOsc.stop(now + 0.35);

    // Latch click
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(800, now + 0.15);
    clickGain.gain.setValueAtTime(0, now + 0.15);
    clickGain.gain.linearRampToValueAtTime(0.1, now + 0.152);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    clickOsc.start(now + 0.15);
    clickOsc.stop(now + 0.22);
  } catch (e) {
    console.log('Could not play sign off sound:', e);
  }
}

// Message received sound - quick blip
export function playMessageSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now); // A5
    oscillator.frequency.setValueAtTime(1108.73, now + 0.05); // C#6

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    oscillator.start(now);
    oscillator.stop(now + 0.2);
  } catch (e) {
    console.log('Could not play message sound:', e);
  }
}
