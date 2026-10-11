<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createSignalAnalyzer } from './signal.js'

const chart = ref(null)
const phase = ref('idle')
const status = ref('需要 HTTPS 或 localhost，以及麦克风权限。')
const sampleRate = ref('--')
const quality = ref(null)
const baseline = ref(null)
const pressure = ref(null)
const settings = ref({ echoCancellation: null, noiseSuppression: null, autoGainControl: null })
const calibrating = ref(false)
const history = []
const calibration = []
let stream = null
let audioContext = null
let source = null
let probe = null
let calibrationTimer = null
let smoothing = 0

const running = computed(() => phase.value === 'running')
const badgeText = computed(() => ({ idle: '未启动', starting: '正在启动', running: '运行中', error: '无法启动' })[phase.value])
const qualityText = computed(() => quality.value == null ? '信号质量 --' : quality.value >= 5 ? '信号质量 良好' : quality.value >= 2 ? '信号质量 偏弱' : '信号质量 未检测到稳定回波')
const pressureText = computed(() => pressure.value == null ? '--' : String(Math.round(pressure.value)))
const pressureLabel = computed(() => pressure.value == null ? '等待检测' : pressure.value >= 22 ? '明显变化' : pressure.value >= 7 ? '轻微变化' : '接近空载')
const orbStyle = computed(() => ({ '--orb-scale': 1 + Math.min((pressure.value || 0) / 140, 0.5) }))

function settingText(value) {
  return value === false ? '已关闭 ✓' : value === true ? '仍在开启 ⚠' : running.value ? '浏览器未报告' : '待启动'
}
function settingClass(value) { return value === false ? 'good' : value === true ? 'warn' : '' }

function draw() {
  const canvas = chart.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const ratio = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.strokeStyle = '#ffffff14'
  context.lineWidth = 1
  for (let row = 1; row < 4; row++) {
    const y = height * row / 4
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
  }
  if (!history.length) return
  const visible = history.slice(-100)
  const scale = Math.max(...visible, baseline.value || 0, 0.001) * 1.25
  context.beginPath()
  context.strokeStyle = '#70e1bd'
  context.lineWidth = 2
  visible.forEach((value, i) => {
    const x = visible.length === 1 ? 0 : i / (visible.length - 1) * width
    const y = height - Math.min(1, value / scale) * (height - 18) - 9
    if (i === 0) context.moveTo(x, y); else context.lineTo(x, y)
  })
  context.stroke()
  if (baseline.value) {
    const y = height - Math.min(1, baseline.value / scale) * (height - 18) - 9
    context.strokeStyle = '#ffffff60'
    context.setLineDash([4, 5])
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
    context.setLineDash([])
  }
}

function update(result) {
  if (!result || !Number.isFinite(result.signal)) return
  quality.value = result.quality
  history.push(result.signal)
  if (history.length > 120) history.shift()
  if (calibrating.value && result.quality >= 2) calibration.push(result.signal)
  if (baseline.value) {
    const raw = Math.max(0, Math.min(100, (baseline.value - result.signal) / baseline.value * 100))
    smoothing = smoothing * 0.6 + raw * 0.4
    pressure.value = smoothing
  }
  draw()
}

async function start() {
  phase.value = 'starting'
  status.value = '正在请求麦克风权限…'
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      throw new Error('请使用支持 AudioWorklet 的浏览器，并通过 HTTPS 或 localhost 打开。')
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    })
    settings.value = stream.getAudioTracks()[0].getSettings()
    audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    if (audioContext.sampleRate < 42000) throw new Error(`实际采样率 ${audioContext.sampleRate} Hz，无法可靠播放 18–22 kHz 信号。`)
    const inspect = createSignalAnalyzer(audioContext.sampleRate)
    await audioContext.audioWorklet.addModule('/probe-processor.js')
    probe = new AudioWorkletNode(audioContext, 'probe-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    source = audioContext.createMediaStreamSource(stream)
    source.connect(probe)
    probe.connect(audioContext.destination)
    probe.port.onmessage = event => update(inspect(event.data))
    await audioContext.resume()
    sampleRate.value = `${(audioContext.sampleRate / 1000).toFixed(1)} kHz`
    phase.value = 'running'
    status.value = '探测已启动。请放下手机、离开设备，然后校准空载基线。'
    if (['echoCancellation', 'noiseSuppression', 'autoGainControl'].some(key => settings.value[key] === true)) {
      status.value = '探测已启动，但至少一项音频处理仍在开启。信号可能被浏览器消除。'
    }
  } catch (error) {
    stop()
    phase.value = 'error'
    status.value = error.name === 'NotAllowedError' ? '麦克风权限被拒绝。请在浏览器地址栏允许后重试。' : error.message || String(error)
  }
}

function calibrate() {
  if (!running.value || calibrating.value) return
  calibrating.value = true
  calibration.length = 0
  status.value = '正在采集空载信号，请保持手机静止且不要触碰…'
  calibrationTimer = setTimeout(() => {
    calibrating.value = false
    if (calibration.length < 15 || quality.value < 2) {
      status.value = '信号太弱，无法校准。检查是否在手机本机播放、关闭耳机，并调高媒体音量后重试。'
      return
    }
    const sorted = [...calibration].sort((a, b) => a - b)
    baseline.value = sorted[Math.floor(sorted.length / 2)]
    pressure.value = 0
    smoothing = 0
    status.value = '校准完成。轻按屏幕或捏住机身，观察相对衰减。'
    draw()
  }, 2000)
}

function stop() {
  clearTimeout(calibrationTimer)
  calibrating.value = false
  probe?.port.postMessage({ type: 'stop' })
  source?.disconnect()
  probe?.disconnect()
  stream?.getTracks().forEach(track => track.stop())
  audioContext?.close().catch(() => {})
  source = null; probe = null; stream = null; audioContext = null
  baseline.value = null; pressure.value = null; quality.value = null; sampleRate.value = '--'
  settings.value = { echoCancellation: null, noiseSuppression: null, autoGainControl: null }
  smoothing = 0; history.length = 0
  phase.value = 'idle'
  draw()
}

function stopByUser() { stop(); status.value = '实验已停止，麦克风已释放。' }
onMounted(() => { draw(); window.addEventListener('resize', draw); window.addEventListener('pagehide', stop) })
onUnmounted(() => { stop(); window.removeEventListener('resize', draw); window.removeEventListener('pagehide', stop) })
</script>

<template>
  <main class="shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">◉</span><span>FORCEPHONE <b>LAB</b></span></div><span class="lab-tag">浏览器声学实验 · v0.2</span></header>
    <section class="intro"><p class="eyebrow">STRUCTURE-BORNE SOUND / 结构传声</p><h1>让手机听见<br><em>你的力度。</em></h1><p class="lead">扬声器发出短促高频信号，麦克风观察机身振动传播的变化。按压或轻捏手机，看看曲线是否响应。</p></section>
    <section class="workspace">
      <div class="panel monitor">
        <div class="panel-heading"><div><p class="eyebrow">LIVE SIGNAL</p><h2>实时感应</h2></div><span class="badge" :class="phase"><i></i>{{ badgeText }}</span></div>
        <div class="meter"><div class="meter-copy"><span>相对信号衰减</span><strong>{{ pressureText }}<small>%</small></strong><span class="meter-label">{{ pressureLabel }}</span></div><div class="orb-wrap"><div class="orb" :style="orbStyle"><div class="orb-core"></div></div></div></div>
        <div class="graph-heading"><span>匹配信号强度</span><span>{{ qualityText }}</span></div><canvas ref="chart" aria-label="实时声学信号强度图" role="img"></canvas>
        <div class="stats"><div><span>采样率</span><strong>{{ sampleRate }}</strong></div><div><span>每秒探测</span><strong>20 次</strong></div><div><span>基线</span><strong>{{ baseline == null ? '未校准' : '已校准' }}</strong></div></div>
      </div>
      <div class="side">
        <section class="panel controls"><p class="eyebrow">01 / START</p><h2>开始实验</h2><p>请在手机本机打开，保持扬声器和麦克风无遮挡。不要连接耳机或蓝牙音箱。</p><button class="primary" type="button" :disabled="phase === 'starting' || running" @click="start">允许麦克风并开始 <span>↗</span></button><button class="secondary" type="button" :disabled="!running" @click="stopByUser">停止实验</button><div class="status" role="status" aria-live="polite">{{ status }}</div></section>
        <section class="panel calibrate"><p class="eyebrow">02 / CALIBRATE</p><h2>校准空载基线</h2><p>启动后把手机放在稳定桌面上，双手离开设备，再点校准。等待约 2 秒。</p><button class="secondary full" type="button" :disabled="!running || calibrating" @click="calibrate">{{ calibrating ? '正在校准…' : '重新校准基线' }} <span>↻</span></button><p class="tiny">数字代表相对于空载基线的声学变化，不是牛顿或克。</p></section>
      </div>
    </section>
    <section class="details"><div class="detail"><span class="detail-num">03 / AUDIO PATH</span><h2>录音链路检查</h2><p>已请求关闭会抹除回放信号的三项处理；以下显示麦克风轨道实际报告的设置。</p><div class="settings"><div><span>回声消除</span><strong :class="settingClass(settings.echoCancellation)">{{ settingText(settings.echoCancellation) }}</strong></div><div><span>噪声抑制</span><strong :class="settingClass(settings.noiseSuppression)">{{ settingText(settings.noiseSuppression) }}</strong></div><div><span>自动增益</span><strong :class="settingClass(settings.autoGainControl)">{{ settingText(settings.autoGainControl) }}</strong></div></div></div><div class="detail"><span class="detail-num">04 / METHOD</span><h2>如何读取结果</h2><p>每 50 ms 播放一次 25 ms 的 18–22 kHz 扫频信号。对麦克风数据做匹配滤波，并比较主峰提前约 20 个采样点处的信号与空载基线。</p><p>这是论文思路的网页实验版。浏览器无法指定内部扬声器或麦克风，也不能保证操作系统关闭额外音频处理；不同设备可能完全收不到高频信号。</p><a href="https://rtcl.eecs.umich.edu/rtclweb/assets/publications/2016/paper-mobisys-final_refined_by_apple.pdf" target="_blank" rel="noopener noreferrer">阅读 ForcePhone 原论文 ↗</a></div></section>
    <footer>ForcePhone Lab · 本地处理音频，不上传录音。音量从低档开始；如果听到刺耳声音，立即停止。</footer>
  </main>
</template>
