# ForcePhone Lab

基于 Vue 3 + Vite 的 ForcePhone 原理实验。通过本机扬声器播放 18–22 kHz、25 ms 的扫频信号（每 50 ms 一次），用麦克风录音做匹配滤波，并观察主峰之前约 20 个采样点处的相关强度变化。

## 本地开发

需要 Node.js 20.19+ 或 22.12+。在项目根目录运行：

```sh
npm install
npm run dev
```

打开 Vite 输出的 `http://localhost:5173`。localhost 属于安全上下文，可以使用麦克风；修改 `src/` 下的文件会热更新。

手机与电脑在同一局域网时，使用 HTTPS 开发服务器：

```sh
npm run dev:https
```

Vite 会列出局域网地址（通常是 `https://<电脑局域网 IP>:5173`）。此模式使用 `@vitejs/plugin-basic-ssl` 生成自签名证书；手机必须信任该证书，或改用自己信任的 HTTPS 证书/隧道，否则浏览器可能拦截页面或麦克风。请勿将开发服务器暴露到公网。

构建与预览：

```sh
npm run build
npm run preview
```

`dist/` 是构建产物，不需要手工编辑。源码入口是 `src/App.vue`，信号分析在 `src/signal.js`，音频工作线程在 `public/probe-processor.js`。部署继续读取 `.openai/hosting.json` 中的 `dist` 目录。

## 实验步骤

启动后允许麦克风，放稳设备且双手离开，再校准空载基线。页面请求关闭 `echoCancellation`、`noiseSuppression` 和 `autoGainControl`，并用 `MediaStreamTrack.getSettings()` 展示浏览器实际报告的状态。浏览器或操作系统仍可能在其他层处理音频。

结果是声学衰减百分比，不是绝对压力。论文中的克数估计使用外部力传感器和多位置设备校准。浏览器也不能指定手机内部的扬声器与麦克风组合；耳机或蓝牙设备会使实验失效。音频仅在浏览器本机处理，不上传或保存。如果听到不适的声音，请停止实验。

原论文：Yu-Chih Tung 和 Kang G. Shin，*Expansion of Human–Phone Interface By Sensing Structure-Borne Sound Propagation*，MobiSys 2016。
