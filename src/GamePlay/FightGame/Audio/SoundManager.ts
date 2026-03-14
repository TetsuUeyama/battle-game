/**
 * Sound effects manager for the fighting game.
 * Uses Web Audio API for low-latency playback.
 * Gracefully degrades if audio context is unavailable.
 */

type SoundEvent = 'hit_light' | 'hit_heavy' | 'block' | 'guard_break' | 'ko' | 'round_start' | 'fight';

interface SynthConfig {
  frequency: number;
  type: OscillatorType;
  duration: number;
  volume: number;
  /** Optional second oscillator for richer sounds */
  freq2?: number;
  type2?: OscillatorType;
  /** Noise burst duration (0 = no noise) */
  noiseDuration?: number;
  noiseVolume?: number;
}

const SOUND_CONFIGS: Record<SoundEvent, SynthConfig> = {
  hit_light: {
    frequency: 200,
    type: 'square',
    duration: 0.08,
    volume: 0.25,
    noiseDuration: 0.05,
    noiseVolume: 0.15,
  },
  hit_heavy: {
    frequency: 120,
    type: 'sawtooth',
    duration: 0.15,
    volume: 0.35,
    freq2: 80,
    type2: 'square',
    noiseDuration: 0.1,
    noiseVolume: 0.25,
  },
  block: {
    frequency: 400,
    type: 'triangle',
    duration: 0.06,
    volume: 0.2,
    freq2: 600,
    type2: 'triangle',
  },
  guard_break: {
    frequency: 150,
    type: 'sawtooth',
    duration: 0.25,
    volume: 0.4,
    freq2: 100,
    type2: 'square',
    noiseDuration: 0.15,
    noiseVolume: 0.3,
  },
  ko: {
    frequency: 300,
    type: 'square',
    duration: 0.5,
    volume: 0.3,
    freq2: 200,
    type2: 'sawtooth',
    noiseDuration: 0.2,
    noiseVolume: 0.2,
  },
  round_start: {
    frequency: 440,
    type: 'sine',
    duration: 0.3,
    volume: 0.15,
    freq2: 660,
    type2: 'sine',
  },
  fight: {
    frequency: 523,
    type: 'square',
    duration: 0.2,
    volume: 0.2,
    freq2: 784,
    type2: 'square',
  },
};

export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _muted = false;

  constructor() {
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
    } catch {
      // Audio not available
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 0.5;
    }
  }

  play(event: SoundEvent): void {
    if (!this.ctx || !this.masterGain || this._muted) return;

    // Resume context if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const config = SOUND_CONFIGS[event];
    const now = this.ctx.currentTime;

    // Main oscillator
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = config.type;
    osc.frequency.value = config.frequency;
    gain.gain.setValueAtTime(config.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + config.duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + config.duration + 0.01);

    // Optional second oscillator
    if (config.freq2 && config.type2) {
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = config.type2;
      osc2.frequency.value = config.freq2;
      gain2.gain.setValueAtTime(config.volume * 0.6, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + config.duration);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(now);
      osc2.stop(now + config.duration + 0.01);
    }

    // Optional noise burst (for impact sounds)
    if (config.noiseDuration && config.noiseDuration > 0) {
      const bufferSize = Math.floor(this.ctx.sampleRate * config.noiseDuration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(config.noiseVolume ?? 0.2, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + config.noiseDuration);
      noise.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + config.noiseDuration + 0.01);
    }
  }

  dispose(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
