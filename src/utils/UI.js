/** Tiny DOM helper: create element with class, styles, children, events. */
export function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Builds a full-screen modal panel; returns { root, body, close }. */
export function makeModal(id, title) {
  const root = el('div', 'modal hidden');
  root.id = id;
  const panel = el('div', 'modal-panel');
  const head = el('div', 'modal-head');
  head.appendChild(el('div', 'modal-title', title));
  const close = el('button', 'btn-icon modal-close', '✕');
  head.appendChild(close);
  panel.appendChild(head);
  const body = el('div', 'modal-body');
  panel.appendChild(body);
  root.appendChild(panel);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeFn(); });
  function closeFn() { root.classList.add('hidden'); }
  close.addEventListener('click', closeFn);
  return { root, body, close: closeFn, head };
}

/** Progress bar element that can be updated cheaply. */
export function makeBar(label, colorClass) {
  const wrap = el('div', 'stat-row');
  wrap.appendChild(el('div', 'stat-label', label));
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill ' + (colorClass || ''));
  track.appendChild(fill);
  wrap.appendChild(track);
  return {
    root: wrap, fill,
    set(v) { fill.style.width = (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%'; }
  };
}
