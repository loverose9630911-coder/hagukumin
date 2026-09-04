// 画面を組み立てるための小道具。
//
// 文字は必ずテキストとして入れる（innerHTML を使わない）ので、
// 人が入れた文字がそのまま HTML として動いてしまうことがない。

export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  apply(n, props);
  add(n, kids);
  return n;
}

function apply(n, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
}

function add(n, kids) {
  for (const kid of kids.flat(5)) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
export const mount = (n, ...kids) => { clear(n); add(n, kids); return n; };

// ---- よく使う部品 ---------------------------------------------------------

export const btn = (label, props = {}) =>
  el('button', { type: 'button', class: 'btn', ...props }, label);

export const icon = (glyph, label, props = {}) =>
  el('button', {
    type: 'button', class: 'icon-btn', title: label, 'aria-label': label, ...props,
  }, glyph);

export function field(label, input, help) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    input,
    help ? el('span', { class: 'field-help' }, help) : null);
}

export function section(title, ...kids) {
  return el('div', { class: 'sec' },
    title ? el('div', { class: 'sec-title' }, title) : null,
    ...kids);
}

export function num(value, onchange, opt = {}) {
  return el('input', {
    type: 'number', class: 'inp num', value: fmt(value),
    step: opt.step ?? 1, min: opt.min, max: opt.max,
    onchange: (e) => onchange(Number(e.target.value)),
  });
}

export const fmt = (v) => (Math.round(v * 100) / 100).toString();

export function select(value, options, onchange, props = {}) {
  const s = el('select', {
    class: 'inp', ...props,
    onchange: (e) => onchange(e.target.value),
  }, options.map((o) => el('option', { value: o.value, selected: o.value === value }, o.label)));
  s.value = value;
  return s;
}

export function swatch(color, onclick, active = false) {
  return el('button', {
    type: 'button',
    class: 'swatch' + (active ? ' on' : ''),
    style: { background: color || 'transparent' },
    title: color || 'なし',
    onclick,
  }, color ? null : '／');
}

// ---- お知らせ -------------------------------------------------------------

let toastBox = null;

export function toast(message, kind = 'info') {
  if (!toastBox) {
    toastBox = el('div', { class: 'toasts' });
    document.body.append(toastBox);
  }
  const t = el('div', { class: `toast ${kind}` }, message);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
  return t;
}

// ---- 小窓 -----------------------------------------------------------------

/**
 * 小窓を出す。build(close) が中身を返す。
 * Esc と背景クリックで閉じる。開いている間は下の画面を触れないようにする。
 */
export function modal(title, build, opt = {}) {
  const close = () => {
    document.removeEventListener('keydown', onKey);
    back.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  const box = el('div', { class: 'modal' + (opt.wide ? ' wide' : '') },
    el('div', { class: 'modal-h' },
      el('h2', {}, title),
      icon('✕', '閉じる', { class: 'icon-btn', onclick: close })));

  const body = el('div', { class: 'modal-b' });
  box.append(body);
  mount(body, build(close));

  const back = el('div', {
    class: 'backdrop',
    onmousedown: (e) => { if (e.target === back) close(); },
  }, box);

  document.body.append(back);
  document.addEventListener('keydown', onKey);

  // 最初の入力欄に合わせる。
  const first = box.querySelector('input, textarea, select, button.primary');
  if (first) setTimeout(() => first.focus(), 20);

  return { close, box, body };
}

/** はい／いいえ。 */
export function confirmBox(title, message, onYes, yesLabel = 'はい') {
  modal(title, (close) => el('div', {},
    el('p', { class: 'muted' }, message),
    el('div', { class: 'row end gap' },
      btn('やめる', { onclick: close }),
      btn(yesLabel, { class: 'btn danger', onclick: () => { close(); onYes(); } }))));
}

// ---- 日時 -----------------------------------------------------------------

export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;

  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (v) => String(v).padStart(2, '0');

  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const bytes = (n) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
