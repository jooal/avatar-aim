// Sound effects for buddy sign on/off
// Uses classic AIM door sounds

import buddyInSound from '../assets/sounds/BuddyIn.mp3';
import buddyOutSound from '../assets/sounds/BuddyOut.mp3';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playAudioFile(src: string): void {
  try {
    const audio = new Audio(src);
    audio.volume = 0.6;
    audio.play().catch((e) => console.log('Could not play sound:', e));
  } catch (e) {
    console.log('Could not play sound:', e);
  }
}

// Classic AIM buddy sign-on sound (door opening)
export function playSignOnSound(): void {
  playAudioFile(buddyInSound);
}

// Classic AIM buddy sign-off sound (door closing)
export function playSignOffSound(): void {
  playAudioFile(buddyOutSound);
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
