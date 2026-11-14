import type * as THREE from 'three';
import type { SeasonState, SpeciesId, TimeState } from '../types';
import { getRiverCenterX } from '../world/TerrainMath';

export class Soundscape {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private riverGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private cricketGain: GainNode | null = null;

  public enabled = false;
  private initialized = false;
  private cricketTimer = 0;
  private birdTimer = 0;
  private lastCallAt = 0;

  public toggle(): boolean {
    if (!this.initialized) {
      this.init();
    }
    this.enabled = !this.enabled;
    if (this.ctx && this.masterGain) {
      if (this.enabled && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      this.masterGain.gain.setTargetAtTime(
        this.enabled ? 0.55 : 0.0,
        this.ctx.currentTime,
        0.25
      );
    }
    return this.enabled;
  }

  private init(): void {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.ctx.destination);

    // Create 2-second reusable pink/brown noise buffer
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.03 * white) / 1.03;
      lastOut = data[i];
      data[i] *= 2.8;
    }

    // Wind layer
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = noiseBuffer;
    windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 340;
    windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.14;
    windSrc.connect(windFilter).connect(this.windGain).connect(this.masterGain);
    windSrc.start();

    // River current layer
    const riverSrc = this.ctx.createBufferSource();
    riverSrc.buffer = noiseBuffer;
    riverSrc.loop = true;
    const riverFilter = this.ctx.createBiquadFilter();
    riverFilter.type = 'bandpass';
    riverFilter.frequency.value = 950;
    riverFilter.Q.value = 0.55;
    this.riverGain = this.ctx.createGain();
    this.riverGain.gain.value = 0.05;
    riverSrc.connect(riverFilter).connect(this.riverGain).connect(this.masterGain);
    riverSrc.start();

    // Rain layer
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer;
    rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1400;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0.0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.masterGain);
    rainSrc.start();

    // Night crickets gain bus
    this.cricketGain = this.ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricketGain.connect(this.masterGain);

    this.initialized = true;
  }

  public update(
    realDt: number,
    timeState: TimeState,
    season: SeasonState,
    cameraPos: THREE.Vector3,
    cameraTarget: THREE.Vector3
  ): void {
    if (!this.enabled || !this.ctx || !this.initialized) return;

    const now = this.ctx.currentTime;
    const distFromRiver = Math.abs(cameraTarget.x - getRiverCenterX(cameraTarget.z));
    const camAlt = Math.max(4, cameraPos.y);
    const riverProx = Math.max(0, 1 - distFromRiver / 52) * Math.max(0.2, 1 - camAlt / 95);

    this.riverGain?.gain.setTargetAtTime(0.02 + riverProx * 0.24 * (0.6 + season.wetness * 0.4), now, 0.25);
    this.windGain?.gain.setTargetAtTime(0.11 + Math.min(0.16, camAlt * 0.002), now, 0.3);
    this.rainGain?.gain.setTargetAtTime(season.rainIntensity * 0.35, now, 0.3);

    const isNight = timeState.hour < 5.5 || timeState.hour > 19;
    const isDay = timeState.hour >= 6 && timeState.hour <= 18.5;

    if (this.cricketGain) {
      this.cricketGain.gain.setTargetAtTime(isNight ? 0.14 * (1 - season.rainIntensity * 0.7) : 0, now, 0.5);
    }

    // Periodic crickets at night
    if (isNight && season.rainIntensity < 0.5) {
      this.cricketTimer -= realDt;
      if (this.cricketTimer <= 0) {
        this.cricketTimer = 0.45 + Math.random() * 0.85;
        this.playCricketChirp();
      }
    }

    // Periodic distant birds during daytime
    if (isDay && season.rainIntensity < 0.4) {
      this.birdTimer -= realDt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 2.6 + Math.random() * 4.5;
        this.playBirdChirp();
      }
    }
  }

  private playCricketChirp(): void {
    if (!this.ctx || !this.cricketGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    const baseFreq = 3900 + Math.random() * 600;
    osc.frequency.setValueAtTime(baseFreq, now);
    g.gain.setValueAtTime(0, now);
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.045;
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.linearRampToValueAtTime(0.0, t + 0.032);
    }
    osc.connect(g).connect(this.cricketGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  private playBirdChirp(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    const f = 1800 + Math.random() * 1400;
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * (1.2 + Math.random() * 0.35), now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(f * 0.88, now + 0.18);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.045, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playAnimalCall(
    species: SpeciesId,
    worldPos: THREE.Vector3,
    cameraTarget: THREE.Vector3
  ): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const dist = worldPos.distanceTo(cameraTarget);
    if (dist > 110) return;
    const now = this.ctx.currentTime;
    if (now - this.lastCallAt < 1.1) return;
    this.lastCallAt = now;

    const vol = Math.max(0.04, 1 - dist / 110) * 0.36;

    if (species === 'lion') {
      this.synthRoar(now, 88, 56, 1.35, vol);
    } else if (species === 'tiger') {
      this.synthRoar(now, 108, 68, 0.95, vol * 0.9);
    } else if (species === 'elephant') {
      this.synthTrumpet(now, vol * 0.9);
    } else if (species === 'hippo') {
      this.synthHippoGrunt(now, vol * 0.85);
    }
  }

  public playSplash(worldPos: THREE.Vector3, cameraTarget: THREE.Vector3): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const dist = worldPos.distanceTo(cameraTarget);
    if (dist > 75) return;
    const vol = Math.max(0.03, 1 - dist / 75) * 0.2;

    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.22);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(this.masterGain);
    src.start(now);
  }

  private synthRoar(
    now: number,
    startF: number,
    endF: number,
    dur: number,
    vol: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(endF, now + dur);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.linearRampToValueAtTime(190, now + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.18);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(filter).connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  private synthTrumpet(now: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.18);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.72);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 680;
    filter.Q.value = 1.6;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

    osc.connect(filter).connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.82);
  }

  private synthHippoGrunt(now: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.22;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(75 - i * 10, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.16);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g).connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }
}
