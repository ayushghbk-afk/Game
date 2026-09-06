// Toasts — transient notification stack (mission complete, achievements…).
import { el } from '../utils/UI.js';

export class Toasts {
  constructor(root) {
    this.container = el('div', 'toast-container');
    root.appendChild(this.container);
  }

  show(title, sub = '', kind = 'info', ms = 4200) {
    const t = el('div', `toast toast-${kind}`);
    t.appendChild(el('div', 'toast-title', title));
    if (sub) t.appendChild(el('div', 'toast-sub', sub));
    this.container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 350);
    }, ms);
  }
}
