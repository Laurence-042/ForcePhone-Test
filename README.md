# ForcePhone Lab

ForcePhone 原理的浏览器实验版。通过本机扬声器播放 18–22 kHz、25 ms 的扫频信号（每 50 ms 一次），用麦克风录音做匹配滤波，并观察主峰之前约 20 个采样点处的相关强度变化。

## 本地运行

在本目录启动静态 HTTP 服务器（如 `npx serve dist`），通过 `http://localhost` 或 HTTPS 打开。手机测试需要 HTTPS 地址。启动后允许麦克风，放稳设备且双手离开，再校准空载基线。

页面请求关闭 `echoCancellation`、`noiseSuppression` 和 `autoGainControl`，并用 `MediaStreamTrack.getSettings()` 展示浏览器实际报告的状态。浏览器或操作系统仍可能在其他层处理音频。

## 局限

- 结果是声学衰减百分比，不是绝对压力。论文中的克数估计使用外部力传感器和多位置设备校准。
- 浏览器不能指定手机内部的扬声器与麦克风组合；耳机或蓝牙设备会使实验失效。
- 扬声器、麦克风、系统滤波和使用者位置都会影响结果。若听到不适的声音，请停止实验。
- 音频仅在浏览器本机处理，不上传或保存。

原论文：Yu-Chih Tung 和 Kang G. Shin，*Expansion of Human–Phone Interface By Sensing Structure-Borne Sound Propagation*，MobiSys 2016。
