class ProbeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.period = Math.round(sampleRate * 0.05);
    this.chirpLength = Math.round(sampleRate * 0.025);
    this.position = 0;
    this.capture = new Float32Array(this.period);
    this.volume = 0.07;
    this.enabled = true;
    this.phase = new Float32Array(this.chirpLength);
    const f0 = 18000;
    const f1 = Math.min(22000, sampleRate * 0.46);
    const duration = this.chirpLength / sampleRate;
    const fade = Math.floor(this.chirpLength / 4);
    for (let i = 0; i < this.chirpLength; i++) {
      const t = i / sampleRate;
      const edge = Math.min(i, this.chirpLength - 1 - i);
      const window = edge < fade ? 0.5 - 0.5 * Math.cos(Math.PI * edge / fade) : 1;
      this.phase[i] = Math.sin(2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * duration))) * window;
    }
    this.port.onmessage = event => {
      if (event.data.type === 'stop') this.enabled = false;
      if (event.data.type === 'volume') this.volume = Math.max(0, Math.min(0.2, event.data.value));
    };
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    for (let i = 0; i < output.length; i++) {
      const p = this.position;
      output[i] = this.enabled && p < this.chirpLength ? this.phase[p] * this.volume : 0;
      this.capture[p] = input?.[i] ?? 0;
      this.position++;
      if (this.position === this.period) {
        if (this.enabled) this.port.postMessage(this.capture, [this.capture.buffer]);
        this.capture = new Float32Array(this.period);
        this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('probe-processor', ProbeProcessor);
