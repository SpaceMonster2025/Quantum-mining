
export class AudioController {
  ctx: AudioContext | null = null;
  masterGain: GainNode | null = null;

  // Loops
  thrustOsc: OscillatorNode | null = null;
  thrustGain: GainNode | null = null;
  laserOsc: OscillatorNode | null = null;
  laserGain: GainNode | null = null;
  tractorOsc: OscillatorNode | null = null;
  tractorGain: GainNode | null = null;

  isThrusting: boolean = false;
  isFiring: boolean = false;
  isTractoring: boolean = false;

  init() {
    if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
    }
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.25; // Keep it from clipping
    this.masterGain.connect(this.ctx.destination);
  }

  // --- ONE SHOT SOUNDS ---

  playTone(freq: number, type: OscillatorType, duration: number, vol: number = 1, slideTo?: number) {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    }
    
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(t + duration);
  }

  playPickup() {
    this.playTone(1200, 'sine', 0.1, 0.3, 2000);
    this.playTone(1800, 'sine', 0.1, 0.1, 2500);
  }

  playExplosion(size: 'small' | 'large' = 'small') {
     if (!this.ctx || !this.masterGain) return;
     const t = this.ctx.currentTime;
     const duration = size === 'large' ? 1.0 : 0.4;
     
     const bufferSize = this.ctx.sampleRate * duration;
     const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
     const data = buffer.getChannelData(0);
     for (let i = 0; i < bufferSize; i++) {
       data[i] = Math.random() * 2 - 1;
     }

     const noise = this.ctx.createBufferSource();
     noise.buffer = buffer;

     const filter = this.ctx.createBiquadFilter();
     filter.type = 'lowpass';
     filter.frequency.setValueAtTime(size === 'large' ? 800 : 1500, t);
     filter.frequency.exponentialRampToValueAtTime(10, t + duration);

     const gain = this.ctx.createGain();
     gain.gain.setValueAtTime(size === 'large' ? 0.8 : 0.4, t);
     gain.gain.exponentialRampToValueAtTime(0.01, t + duration);

     noise.connect(filter);
     filter.connect(gain);
     gain.connect(this.masterGain);
     noise.start();
  }

  playMineArmed() {
      this.playTone(800, 'square', 0.1, 0.2);
      setTimeout(() => this.playTone(1200, 'square', 0.1, 0.2), 100);
  }

  playMinePucker() {
      if (!this.ctx || !this.masterGain) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.frequency.setValueAtTime(100, t);
      osc.frequency.linearRampToValueAtTime(800, t + 1.0); // 1 sec rising tone
      
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 1.0);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(t + 1.0);
  }

  playUI(type: 'click' | 'buy' | 'error' | 'hover') {
      if (!this.ctx) this.init(); // Try init
      if (type === 'click') this.playTone(600, 'sine', 0.05, 0.1);
      if (type === 'hover') this.playTone(300, 'sine', 0.02, 0.05);
      if (type === 'buy') {
          this.playTone(440, 'sine', 0.1, 0.2);
          setTimeout(() => this.playTone(880, 'sine', 0.2, 0.2), 100);
      }
      if (type === 'error') {
          this.playTone(150, 'sawtooth', 0.2, 0.2);
          setTimeout(() => this.playTone(100, 'sawtooth', 0.2, 0.2), 150);
      }
  }

  // --- LOOPS ---

  setThrust(active: boolean) {
      if (!this.ctx || !this.masterGain) return;
      if (active && !this.isThrusting) {
          this.isThrusting = true;
          // Noise Loop
          const bufferSize = this.ctx.sampleRate * 1.0;
          const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          
          const noise = this.ctx.createBufferSource();
          noise.buffer = buffer;
          noise.loop = true;
          
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 400;

          this.thrustGain = this.ctx.createGain();
          this.thrustGain.gain.value = 0;
          this.thrustGain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.1);

          noise.connect(filter);
          filter.connect(this.thrustGain);
          this.thrustGain.connect(this.masterGain);
          noise.start();
          (this as any).thrustNode = noise;
      } else if (!active && this.isThrusting) {
          this.isThrusting = false;
          if (this.thrustGain) {
              this.thrustGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
              setTimeout(() => {
                  (this as any).thrustNode?.stop();
                  this.thrustGain?.disconnect();
              }, 150);
          }
      }
  }

  setLaser(active: boolean) {
      if (!this.ctx || !this.masterGain) return;
      if (active && !this.isFiring) {
          this.isFiring = true;
          this.laserOsc = this.ctx.createOscillator();
          this.laserOsc.type = 'sawtooth';
          this.laserOsc.frequency.setValueAtTime(200, this.ctx.currentTime); // Low hum
          
          // LFO for modulation
          const lfo = this.ctx.createOscillator();
          lfo.frequency.value = 20; // 20hz buzz
          const lfoGain = this.ctx.createGain();
          lfoGain.gain.value = 100;
          lfo.connect(lfoGain);
          lfoGain.connect(this.laserOsc.frequency);
          lfo.start();

          this.laserGain = this.ctx.createGain();
          this.laserGain.gain.value = 0;
          this.laserGain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.05);

          this.laserOsc.connect(this.laserGain);
          this.laserGain.connect(this.masterGain);
          this.laserOsc.start();
          (this as any).laserLFO = lfo;
      } else if (!active && this.isFiring) {
          this.isFiring = false;
          if (this.laserGain) {
              this.laserGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05);
              setTimeout(() => {
                  this.laserOsc?.stop();
                  (this as any).laserLFO?.stop();
                  this.laserGain?.disconnect();
              }, 100);
          }
      }
  }

  setTractor(active: boolean) {
      if (!this.ctx || !this.masterGain) return;
      if (active && !this.isTractoring) {
          this.isTractoring = true;
          this.tractorOsc = this.ctx.createOscillator();
          this.tractorOsc.type = 'sine';
          this.tractorOsc.frequency.setValueAtTime(100, this.ctx.currentTime);
          
          this.tractorGain = this.ctx.createGain();
          this.tractorGain.gain.value = 0;
          this.tractorGain.gain.linearRampToValueAtTime(0.2, this.ctx.currentTime + 0.1);

          this.tractorOsc.connect(this.tractorGain);
          this.tractorGain.connect(this.masterGain);
          this.tractorOsc.start();
          
          // Pitch slide up
          this.tractorOsc.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 1);
      } else if (!active && this.isTractoring) {
          this.isTractoring = false;
          if (this.tractorGain) {
              this.tractorGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
              setTimeout(() => {
                  this.tractorOsc?.stop();
                  this.tractorGain?.disconnect();
              }, 150);
          }
      }
  }
}

export const audio = new AudioController();
