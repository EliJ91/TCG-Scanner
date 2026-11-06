export class ScannerAudio {
  private context?: AudioContext;
  public volume = 0.6;
  public muted = false;
  async unlock() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context ??= new Ctx(); await this.context.resume();
      const source = this.context.createBufferSource(); source.buffer = this.context.createBuffer(1, 1, 22050);
      source.connect(this.context.destination); source.start();
      return this.context.state === 'running';
    } catch { return false; }
  }
  private tone(freq: number, at: number, duration: number, type: OscillatorType = 'sine') {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const t = this.context.currentTime + at, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(this.volume * 0.22, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.context.destination); osc.start(t); osc.stop(t + duration + 0.01);
  }
  success() { this.tone(1174.66, 0, 0.14); this.tone(1567.98, 0.04, 0.2); }
  complete() { this.tone(392, 0.3, 0.18, 'triangle'); this.tone(294, 0.53, 0.18, 'triangle'); this.tone(196, 0.76, 0.42, 'triangle'); }
}
