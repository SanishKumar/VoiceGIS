/**
 * WaveformRenderer.js
 * Real-time audio waveform visualization on a <canvas> element.
 *
 * Supports three visual styles:
 *   - 'waveform': Classic oscilloscope wave
 *   - 'bars': Frequency spectrum bars
 *   - 'circle': Circular radial visualizer
 *
 * @module audio/WaveformRenderer
 */

export class WaveformRenderer {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element to render onto
   * @param {AnalyserNode} [analyserNode] - Web Audio AnalyserNode (can be set later)
   */
  constructor(canvas, analyserNode = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyserNode = analyserNode;

    this._animFrameId = null;
    this._isRunning = false;
    this._displayWidth = canvas.clientWidth || canvas.width;
    this._displayHeight = canvas.clientHeight || canvas.height;

    // Style configuration
    this._style = {
      color: '#3b82f6',       // Primary blue
      secondaryColor: '#10b981', // Emerald accent
      lineWidth: 2,
      style: 'waveform',     // 'waveform' | 'bars' | 'circle'
      backgroundColor: 'transparent',
      glow: true,
      barGap: 2,
      barWidth: 3,
      mirrorWave: true,
    };

    // Handle canvas resize
    this._resizeObserver = null;
    this._setupResize();
  }

  /**
   * Set the AnalyserNode (e.g., from AudioCapture.getAnalyserNode()).
   * @param {AnalyserNode} node
   */
  setAnalyserNode(node) {
    this.analyserNode = node;
  }

  /**
   * Update visual style configuration.
   * @param {object} opts
   * @param {string} [opts.color] - Primary waveform color
   * @param {string} [opts.secondaryColor] - Secondary / gradient end color
   * @param {number} [opts.lineWidth] - Line width for waveform style
   * @param {string} [opts.style] - 'waveform' | 'bars' | 'circle'
   * @param {string} [opts.backgroundColor] - Canvas background
   * @param {boolean} [opts.glow] - Enable glow effect
   * @param {boolean} [opts.mirrorWave] - Mirror waveform vertically
   */
  setStyle(opts = {}) {
    Object.assign(this._style, opts);
  }

  /**
   * Start the render loop.
   */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._render();
  }

  /**
   * Stop the render loop.
   */
  stop() {
    this._isRunning = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  /**
   * Destroy the renderer and clean up.
   */
  destroy() {
    this.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  /**
   * Draw a single frame of the idle state (flat line or subtle animation).
   */
  drawIdle() {
    const { width, height } = this._getDisplaySize();
    const ctx = this.ctx;

    this._clearCanvas();

    ctx.strokeStyle = this._style.color;
    ctx.lineWidth = this._style.lineWidth;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Internal: render loop
  // ---------------------------------------------------------------------------

  _render() {
    if (!this._isRunning) return;

    this._animFrameId = requestAnimationFrame(() => this._render());

    if (!this.analyserNode) {
      this.drawIdle();
      return;
    }

    switch (this._style.style) {
      case 'bars':
        this._renderBars();
        break;
      case 'circle':
        this._renderCircle();
        break;
      default:
        this._renderWaveform();
        break;
    }
  }

  _renderWaveform() {
    const analyser = this.analyserNode;
    const bufferLength = analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(dataArray);

    const { width, height } = this._getDisplaySize();
    const ctx = this.ctx;

    this._clearCanvas();

    // Glow effect
    if (this._style.glow) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = this._style.color;
    }

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, this._style.color);
    gradient.addColorStop(1, this._style.secondaryColor);

    ctx.lineWidth = this._style.lineWidth;
    ctx.strokeStyle = gradient;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      // Map -1..1 to 0..height
      const v = dataArray[i];
      const y = (v + 1) / 2 * height;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.stroke();

    // Mirror effect
    if (this._style.mirrorWave) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i];
        const y = height - ((v + 1) / 2 * height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Reset shadow
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  _renderBars() {
    const analyser = this.analyserNode;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const { width, height } = this._getDisplaySize();
    const ctx = this.ctx;

    this._clearCanvas();

    const barWidth = this._style.barWidth;
    const barGap = this._style.barGap;
    const totalBarWidth = barWidth + barGap;
    const barCount = Math.floor(width / totalBarWidth);
    const step = Math.floor(bufferLength / barCount);

    if (this._style.glow) {
      ctx.shadowBlur = 6;
      ctx.shadowColor = this._style.color;
    }

    for (let i = 0; i < barCount; i++) {
      const dataIndex = i * step;
      const value = dataArray[dataIndex] / 255;
      const barHeight = value * height * 0.9;

      // Gradient per bar
      const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
      gradient.addColorStop(0, this._style.color);
      gradient.addColorStop(1, this._style.secondaryColor);

      ctx.fillStyle = gradient;

      const x = i * totalBarWidth;
      const y = height - barHeight;

      // Rounded bar top
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2, barWidth / 2, 0, 0]);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  _renderCircle() {
    const analyser = this.analyserNode;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const { width, height } = this._getDisplaySize();
    const ctx = this.ctx;

    this._clearCanvas();

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.3;

    if (this._style.glow) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = this._style.color;
    }

    ctx.lineWidth = this._style.lineWidth;

    const points = 64;
    const step = Math.floor(bufferLength / points);

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const dataIndex = (i % points) * step;
      const value = dataArray[dataIndex] / 255;
      const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
      const r = radius + value * radius * 0.8;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2);
    gradient.addColorStop(0, this._style.secondaryColor);
    gradient.addColorStop(1, this._style.color);

    ctx.strokeStyle = gradient;
    ctx.stroke();

    // Inner circle
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = this._style.color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _clearCanvas() {
    const { width, height } = this._getDisplaySize();
    if (this._style.backgroundColor && this._style.backgroundColor !== 'transparent') {
      this.ctx.fillStyle = this._style.backgroundColor;
      this.ctx.fillRect(0, 0, width, height);
    } else {
      this.ctx.clearRect(0, 0, width, height);
    }
  }

  _setupResize() {
    if (typeof ResizeObserver === 'undefined') return;

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        this._displayWidth = width;
        this._displayHeight = height;
        this.canvas.width = Math.max(1, Math.round(width * dpr));
        this.canvas.height = Math.max(1, Math.round(height * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });

    this._resizeObserver.observe(this.canvas);
  }

  _getDisplaySize() {
    return {
      width: this._displayWidth || this.canvas.width,
      height: this._displayHeight || this.canvas.height,
    };
  }
}
