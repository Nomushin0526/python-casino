// Webカメラで QR を読み取る（jsQR をローカル同梱で使用）
/* global jsQR */

export class QrScanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.running = false;
    this.last = { text: null, at: 0 };
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
  }

  async start() {
    if (!QrScanner.supported()) {
      throw new Error(window.isSecureContext === false
        ? 'この接続（http）ではカメラが使えません。README の「別PCでカメラを使う設定」を確認してください'
        : 'このブラウザではカメラが使えません');
    }
    const deviceId = new URLSearchParams(location.search).get('camera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.running = true;
    this.loop();
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const scale = Math.min(1, 640 / v.videoWidth);
      const w = Math.floor(v.videoWidth * scale);
      const h = Math.floor(v.videoHeight * scale);
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(v, 0, 0, w, h);
      const img = this.ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) {
        const now = Date.now();
        if (code.data !== this.last.text || now - this.last.at > 4000) {
          this.last = { text: code.data, at: now };
          this.onCode(code.data);
        }
      }
    }
    this.timer = setTimeout(() => requestAnimationFrame(() => this.loop()), 120);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
  }
}
