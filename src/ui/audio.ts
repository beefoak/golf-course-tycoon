import type { Game } from '../sim/game';

export type Sfx = 'strike' | 'putt' | 'cash' | 'info' | 'warn' | 'bad' | 'build';

const MUTE_KEY = 'gct.muted';
const loadMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };

/**
 * Small synthesized sound effects (WebAudio, no files). The context starts on the first user
 * gesture (browsers block audio before one); everything is silent while muted.
 */
export class Sfxr {
  muted = loadMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mower: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lastAt = new Map<Sfx, number>();

  /** Create the audio graph (call from a click or key handler). */
  unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* storage blocked: session only */ }
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private noise(seconds: number): AudioBuffer {
    const c = this.ctx!;
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
    const d = b.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = (seed / 4294967296) * 2 - 1; }
    return b;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const c = this.ctx!;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    gn.gain.setValueAtTime(0.0001, start);
    gn.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(gn).connect(this.master!);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private click(start: number, dur: number, freq: number, vol: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise(dur);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const gn = c.createGain();
    gn.gain.setValueAtTime(vol, start);
    gn.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(gn).connect(this.master!);
    src.start(start);
  }

  play(kind: Sfx): void {
    if (this.muted || !this.ctx || !this.master) return;
    // the same sound at most every 120 ms (a burst of notifications stays one blip)
    const now = performance.now();
    if (now - (this.lastAt.get(kind) ?? -1e9) < 120) return;
    this.lastAt.set(kind, now);
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'strike': this.click(t, 0.09, 2400, 0.9); this.tone(900, t, 0.08, 'triangle', 0.15, 500); break;
      case 'putt': this.click(t, 0.05, 1200, 0.5); this.tone(600, t, 0.06, 'sine', 0.12); break;
      case 'cash': this.tone(1318, t, 0.12, 'square', 0.06); this.tone(1760, t + 0.08, 0.25, 'square', 0.06); break;
      case 'build': this.click(t, 0.12, 300, 0.6); this.tone(140, t, 0.15, 'sine', 0.2, 90); break;
      case 'info': this.tone(880, t, 0.12, 'sine', 0.08); break;
      case 'warn': this.tone(660, t, 0.1, 'triangle', 0.1); this.tone(520, t + 0.1, 0.14, 'triangle', 0.1); break;
      case 'bad': this.tone(330, t, 0.25, 'sawtooth', 0.06, 220); break;
    }
  }

  /** A soft mower drone while the dawn crew is out (and the clock is running). */
  setMowing(on: boolean): void {
    if (!this.ctx || !this.master) return;
    if (on && !this.mower) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise(2);
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 220;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 1.5);
      src.connect(f).connect(gain).connect(this.master);
      src.start();
      this.mower = { src, gain };
    } else if (!on && this.mower) {
      const m = this.mower;
      this.mower = null;
      m.gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 1);
      m.src.stop(this.ctx.currentTime + 1.1);
    }
  }
}

/** Dawn: between 05:00 and 07:30 the crew mows before the first tee times. */
export function mowerHour(minuteOfDay: number): boolean {
  return minuteOfDay >= 300 && minuteOfDay < 450;
}

/** Wire the game's events to sounds: money spent or earned on a command, notifications, dawn mowing. */
export function attachAudio(g: Game, sfx: Sfxr, speed: () => number): void {
  g.events.on('command', ({ cmd, ok }) => {
    if (!ok) return;
    if (cmd.t === 'takeLoan' || cmd.t === 'sellParcel' || cmd.t === 'sellEquipment') sfx.play('cash');
    else if (['paint', 'terrain', 'penHole', 'bunker', 'digWater', 'fillWater', 'path', 'bridge', 'placeBuilding', 'placeStructure', 'shapeGreen', 'plantTrees', 'removeTrees', 'buyParcel'].includes(cmd.t)) sfx.play('build');
  });
  g.events.on('notify', n => sfx.play(n.kind));
  g.events.on('minute', () => {
    const working = g.staff.all.some(s => s.equipmentId !== null);
    sfx.setMowing(speed() > 0 && working && mowerHour(g.clock.minuteOfDay));
  });
}
