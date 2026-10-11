// The worklet emits the same chirp. Keep these constants in sync with
// public/probe-processor.js if the probe waveform changes.
export function createSignalAnalyzer(rate) {
  const count = Math.round(rate * 0.025)
  const period = Math.round(rate * 0.05)
  const wave = new Float32Array(count)
  const duration = count / rate
  const upper = Math.min(22000, rate * 0.46)
  const fade = Math.floor(count / 4)
  let energy = 0

  for (let i = 0; i < count; i++) {
    const t = i / rate
    const edge = Math.min(i, count - 1 - i)
    const window = edge < fade ? 0.5 - 0.5 * Math.cos(Math.PI * edge / fade) : 1
    const sample = Math.sin(2 * Math.PI * (18000 * t + (upper - 18000) * t * t / (2 * duration))) * window
    wave[i] = sample
    energy += sample * sample
  }

  function correlation(data, offset) {
    let sum = 0
    for (let i = 0; i < wave.length; i++) sum += data[(offset + i) % data.length] * wave[i]
    return sum
  }

  return function inspect(data) {
    if (!(data instanceof Float32Array) || data.length !== period) return null
    let best = 0
    let bestOffset = 0
    let noiseSum = 0
    let checks = 0

    // Periodicity lets us search a full 50 ms window despite unknown I/O latency.
    for (let offset = 0; offset < data.length; offset += 4) {
      const value = Math.abs(correlation(data, offset))
      noiseSum += value
      checks++
      if (value > best) { best = value; bestOffset = offset }
    }
    for (let d = -3; d <= 3; d++) {
      const offset = (bestOffset + d + data.length) % data.length
      const value = Math.abs(correlation(data, offset))
      if (value > best) { best = value; bestOffset = offset }
    }

    // The paper uses a sample about 20 frames ahead of the air-path peak.
    const earlyOffset = (bestOffset - 20 + data.length) % data.length
    const early = Math.abs(correlation(data, earlyOffset))
    return {
      signal: early / energy,
      quality: best / Math.max(noiseSum / checks, 1e-9),
    }
  }
}
