// LoadingScreen — progressive loader with a live progress bar.
import { el } from '../utils/UI.js';

export class LoadingScreen {
  constructor(root) {
    this.root = el('div', 'loading-screen');
    this.root.innerHTML = `
      <div class="loading-inner">
        <div class="loading-logo">SOLAR<br>ODYSSEY</div>
        <div class="loading-status">Initializing navigation systems…</div>
        <div class="loading-bar"><div class="loading-fill"></div></div>
        <div class="loading-pct">0%</div>
      </div>`;
    root.appendChild(this.root);
    this.fill = this.root.querySelector('.loading-fill');
    this.pct = this.root.querySelector('.loading-pct');
    this.status = this.root.querySelector('.loading-status');
    this._p = 0;
  }

  progress(p, text) {
    this._p = Math.max(this._p, Math.min(1, p));
    this.fill.style.width = (this._p * 100).toFixed(0) + '%';
    this.pct.textContent = (this._p * 100).toFixed(0) + '%';
    if (text) this.status.textContent = text;
  }

  done() {
    this.progress(1);
    this.root.classList.add('fade-out');
    setTimeout(() => this.root.remove(), 700);
  }
}
