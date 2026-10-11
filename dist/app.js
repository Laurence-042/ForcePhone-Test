const $ = id => document.getElementById(id);
const startButton = $('startButton');
const stopButton = $('stopButton');
const calibrateButton = $('calibrateButton');
const canvas = $('chart');
const ctx2d = canvas.getContext('2d');
const history = [];
const calibration = [];
let stream = null;
let audioContext = null;
let source = null;
let probe = null;
let template = null;
let baseline = null;
let calibrating = false;
let calibrationTimer = null;
let smoothing = 0;
let lastQuality = 0;

function status(message) { $('status').textContent = message; }
function badge(name, className) { $('stateBadge').className = `badge ${className}`; $('stateBadge').innerHTML = `<i></i>${name}`; }

function makeTemplate(rate) {
  const count = Math.round(rate * 0.025);
  const values = new Float32Array(count);
  const duration = count / rate;
  const upper = Math.min(22000, rate * 0.46);
  const fade = Math.floor(count / 4);
  let energy = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const edge = Math.min(i, count - 1 - i);
    const window = edge < fade ? 0.5 - 0.5 * Math.cos(Math.PI * edge / fade) : 1;
    const sample = Math.sin(2 * Math.PI * (18000 * t + (upper - 18000) * t * t / (2 * duration))) * window;
    values[i] = sample;
    energy += sample * sample;
  }
  return { values, energy };
}

function correlation(data, offset) {
  let sum = 0;
  const n = data.length;
  const wave = template.values;
  for (let i = 0; i < wave.length; i++) sum += data[(offset + i) % n] * wave[i];
  return sum;
}

function inspect(data) {
  let best = 0;
  let bestOffset = 0;
  let noiseSum = 0;
  let checks = 0;
  // A periodic signal makes the unknown browser input/output latency a phase offset.
  // Scan one full period, then refine around the strongest matched-filter response.
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = Math.abs(correlation(data, offset));
    noiseSum += value;
    checks++;
    if (value > best) { best = value; bestOffset = offset; }
  }
  for (let d = -3; d <= 3; d++) {
    const offset = (bestOffset + d + data.length) % data.length;
    const value = Math.abs(correlation(data, offset));
    if (value > best) { best = value; bestOffset = offset; }
  }
  const earlyOffset = (bestOffset - 20 + data.length) % data.length;
  const early = Math.abs(correlation(data, earlyOffset));
  const quality = best / Math.max(noiseSum / checks, 1e-9);
  return { signal: early / template.energy, quality, peak: best / template.energy };
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
  }
  ctx2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx2d.clearRect(0, 0, width, height);
  ctx2d.strokeStyle = '#ffffff14'; ctx2d.lineWidth = 1;
  for (let row = 1; row < 4; row++) { const y = height * row / 4; ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(width, y); ctx2d.stroke(); }
  if (!history.length) return;
  const visible = history.slice(-100);
  const scale = Math.max(...visible, baseline || 0, 0.001) * 1.25;
  ctx2d.beginPath(); ctx2d.strokeStyle = '#70e1bd'; ctx2d.lineWidth = 2;
  visible.forEach((value, i) => {
    const x = visible.length === 1 ? 0 : i / (visible.length - 1) * width;
    const y = height - Math.min(1, value / scale) * (height - 18) - 9;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  });
  ctx2d.stroke();
  if (baseline) {
    const y = height - Math.min(1, baseline / scale) * (height - 18) - 9;
    ctx2d.strokeStyle = '#ffffff60'; ctx2d.setLineDash([4, 5]); ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(width, y); ctx2d.stroke(); ctx2d.setLineDash([]);
  }
}

function update(result) {
  if (!Number.isFinite(result.signal)) return;
  lastQuality = result.quality;
  history.push(result.signal);
  if (history.length > 120) history.shift();
  if (calibrating && result.quality >= 2) calibration.push(result.signal);
  const qualityLabel = result.quality >= 5 ? '良好' : result.quality >= 2 ? '偏弱' : '未检测到稳定回波';
  $('qualityText').textContent = `信号质量 ${qualityLabel}`;
  if (baseline) {
    const raw = Math.max(0, Math.min(100, (baseline - result.signal) / baseline * 100));
    smoothing = smoothing * 0.6 + raw * 0.4;
    $('pressureValue').innerHTML = `${Math.round(smoothing)}<small>%</small>`;
    $('pressureLabel').textContent = smoothing >= 22 ? '明显变化' : smoothing >= 7 ? '轻微变化' : '接近空载';
    $('orb').style.setProperty('--orb-scale', String(1 + Math.min(smoothing / 140, 0.5)));
  }
  draw();
}

function showSetting(id, value) {
  const node = $(id);
  node.textContent = value === false ? '已关闭 ✓' : value === true ? '仍在开启 ⚠' : '浏览器未报告';
  node.className = value === false ? 'good' : value === true ? 'warn' : '';
}

async function start() {
  startButton.disabled = true;
  status('正在请求麦克风权限…');
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('请使用支持 AudioWorklet 的浏览器，并通过 HTTPS 或 localhost 打开。');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    showSetting('echoSetting', settings.echoCancellation);
    showSetting('noiseSetting', settings.noiseSuppression);
    showSetting('gainSetting', settings.autoGainControl);
    audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    if (audioContext.sampleRate < 42000) throw new Error(`实际采样率 ${audioContext.sampleRate} Hz，无法可靠播放 18–22 kHz 信号。`);
    template = makeTemplate(audioContext.sampleRate);
    await audioContext.audioWorklet.addModule('./probe-processor.js');
    probe = new AudioWorkletNode(audioContext, 'probe-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    source = audioContext.createMediaStreamSource(stream);
    source.connect(probe);
    probe.connect(audioContext.destination);
    probe.port.onmessage = event => update(inspect(event.data));
    await audioContext.resume();
    $('sampleRate').textContent = `${(audioContext.sampleRate / 1000).toFixed(1)} kHz`;
    badge('运行中', 'running');
    stopButton.disabled = false;
    calibrateButton.disabled = false;
    status('探测已启动。请放下手机、离开设备，然后校准空载基线。');
    if ([settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl].some(v => v === true)) status('探测已启动，但至少一项音频处理仍在开启。信号可能被浏览器消除。');
  } catch (error) {
    stop();
    badge('无法启动', 'error');
    status(error.name === 'NotAllowedError' ? '麦克风权限被拒绝。请在浏览器地址栏允许后重试。' : error.message || String(error));
  }
}

function calibrate() {
  if (!probe || calibrating) return;
  calibrating = true;
  calibration.length = 0;
  calibrateButton.disabled = true;
  status('正在采集空载信号，请保持手机静止且不要触碰…');
  calibrationTimer = setTimeout(() => {
    calibrating = false;
    calibrateButton.disabled = false;
    if (calibration.length < 15 || lastQuality < 2) {
      status('信号太弱，无法校准。检查是否在手机本机播放、关闭耳机，并调高媒体音量后重试。');
      return;
    }
    const sorted = [...calibration].sort((a, b) => a - b);
    baseline = sorted[Math.floor(sorted.length / 2)];
    smoothing = 0;
    $('baselineText').textContent = '已校准';
    status('校准完成。轻按屏幕或捏住机身，观察相对衰减。');
    draw();
  }, 2000);
}

function stop() {
  clearTimeout(calibrationTimer);
  calibrating = false;
  probe?.port.postMessage({ type: 'stop' });
  source?.disconnect();
  probe?.disconnect();
  stream?.getTracks().forEach(track => track.stop());
  audioContext?.close().catch(() => {});
  source = null; probe = null; stream = null; audioContext = null;
  baseline = null; smoothing = 0; history.length = 0;
  startButton.disabled = false; stopButton.disabled = true; calibrateButton.disabled = true;
  $('pressureValue').innerHTML = '--<small>%</small>';
  $('pressureLabel').textContent = '等待检测';
  $('baselineText').textContent = '未校准';
  $('sampleRate').textContent = '--';
  $('qualityText').textContent = '信号质量 --';
  $('orb').style.setProperty('--orb-scale', '1');
  badge('未启动', 'idle');
  draw();
}

startButton.addEventListener('click', start);
stopButton.addEventListener('click', () => { stop(); status('实验已停止，麦克风已释放。'); });
calibrateButton.addEventListener('click', calibrate);
window.addEventListener('pagehide', stop);
window.addEventListener('resize', draw);
draw();
