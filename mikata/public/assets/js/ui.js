// 画面を組み立てるための小道具。
//
// 文字列は必ずテキストとして入れる（innerHTML を使わない）ので、
// 人が書いたメッセージがそのまま HTML として動いてしまうことがない。

export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  apply(n, props);
  add(n, kids);
  return n;
}

export function svg(tag, props, ...kids) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k === 'className' ? 'class' : k, v);
  }
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
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
export const mount = (n, ...kids) => { clear(n); add(n, kids); return n; };

// ---- 表示のきまりごと ---------------------------------------------------

export const STATUS = {
  todo:   { label: '未着手', color: 'var(--todo)' },
  doing:  { label: '進行中',   color: 'var(--doing)' },
  review: { label: '確認待ち', color: 'var(--review)' },
  done:   { label: '完了',     color: 'var(--done)' },
};

export const PRIORITY = { high: '高', mid: '中', low: '低' };

export const ROLLUP = {
  tasks:      'タスクの実績値を合計',
  done_count: '完了したタスクの数',
  children:   '配下の個人目標を合計',
  manual:     '手で入力',
};

export const initials = (name) => (name || '？').trim().slice(0, 2);

export function avatar(user, size) {
  return el('div', {
    class: `avatar${size ? ' ' + size : ''}`,
    style: { background: user?.color || '#94a3b8' },
    title: user?.name || '担当なし',
  }, user ? initials(user.name) : '—');
}

/** 1234.5 → "1,234.5"、小数の 0 は消す。 */
export function num(v, digits = 1) {
  if (v === null || v === undefined) return '—';
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return r.toLocaleString('ja-JP', { maximumFractionDigits: digits });
}

export const pct = (rate, digits = 0) =>
  rate === null || rate === undefined ? '—' : `${(rate * 100).toFixed(digits)}%`;

/**
 * 納期の見え方。日数で色と言い回しを変える。
 * 完了タスクは「遅れ」として赤くしない（もう追いかける必要がないため）。
 */
export function dueLook(due, today, done = false) {
  if (!due) return { text: '納期なし', cls: '', days: null };
  const days = Math.round((Date.parse(due + 'T00:00:00') - Date.parse(today + 'T00:00:00')) / 86400000);
  const md = `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}`;
  if (done)       return { text: md, cls: '', days };
  if (days < 0)   return { text: `${md}（${-days}日遅れ）`, cls: 'overdue', days };
  if (days === 0) return { text: `${md}（今日）`,             cls: 'soon',    days };
  if (days <= 3)  return { text: `${md}（あと${days}日）`,     cls: 'soon',    days };
  return { text: md, cls: '', days };
}

export function when(ts) {
  const d = new Date(ts.replace(' ', 'T'));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function dayLabel(ymd, today) {
  if (ymd === today) return '今日';
  const y = new Date(Date.parse(today + 'T00:00:00') - 86400000).toISOString().slice(0, 10);
  if (ymd === y) return '昨日';
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(ymd + 'T00:00:00').getDay()];
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日(${w})`;
}

// ---- 出したり消したりするもの -------------------------------------------

export function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

/**
 * 中央に出す小さな窓。閉じるときは close() を呼ぶ。
 * @param {{title:string, body:Node, actions?:Node[]}} opts
 */
export function modal({ title, body, actions }) {
  const close = () => { scrim.remove(); box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const scrim = el('div', { class: 'scrim', onclick: close });
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-h' },
      el('h2', {}, title),
      el('button', { class: 'btn ghost sm', onclick: close, 'aria-label': '閉じる' }, '✕')),
    el('div', { class: 'modal-b' }, body),
    actions?.length ? el('div', { class: 'modal-f' }, actions) : null,
  );

  document.body.append(scrim, box);
  document.addEventListener('keydown', onKey);
  box.querySelector('input, select, textarea')?.focus();
  return close;
}

/** 入力欄つきのラベル。 */
export function field(label, input, hint) {
  return el('label', { class: 'field' },
    el('span', {}, label),
    input,
    hint ? el('p', { class: 'hint' }, hint) : null);
}

export function select(options, value, props) {
  const s = el('select', { class: 'input', ...props });
  for (const o of options) {
    s.append(el('option', { value: o.value, selected: String(o.value) === String(value) }, o.label));
  }
  return s;
}

export function statusTag(status) {
  return el('span', { class: `tag ${status}` }, STATUS[status].label);
}
