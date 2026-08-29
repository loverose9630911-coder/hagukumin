// グラフ。外部のライブラリは使わず、SVG を自分で組み立てている。
//
// どのグラフも「数字の配列を渡すと SVG が返ってくる」だけの関数にしてあるので、
// 画面側は置き場所を決めるだけでよい。

import { svg, el, num, pct } from './ui.js';

/**
 * ドーナツ。真ん中に大きな数字を出す。
 * @param {{value:number,color:string,label:string}[]} segments
 */
export function donut(segments, { size = 132, thickness = 15, center, caption } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;

  const ring = svg('g', { transform: `rotate(-90 ${mid} ${mid})` },
    svg('circle', {
      cx: mid, cy: mid, r, fill: 'none',
      stroke: 'var(--line-soft)', 'stroke-width': thickness,
    }));

  let offset = 0;
  for (const s of segments) {
    if (s.value <= 0 || total <= 0) continue;
    const len = (s.value / total) * c;
    ring.append(svg('circle', {
      cx: mid, cy: mid, r, fill: 'none',
      stroke: s.color, 'stroke-width': thickness,
      'stroke-dasharray': `${len} ${c - len}`,
      'stroke-dashoffset': -offset,
      'stroke-linecap': len < c - 0.5 ? 'butt' : 'round',
    }, svg('title', {}, `${s.label} ${s.value}件`)));
    offset += len;
  }

  const label = segments.map((s) => `${s.label}${s.value}`).join('、');

  return svg('svg', {
    width: size, height: size, viewBox: `0 0 ${size} ${size}`,
    role: 'img', 'aria-label': `${caption || '内訳'}: ${total === 0 ? 'データなし' : label}`,
  },
    ring,
    center !== undefined
      ? svg('text', {
          x: mid, y: mid - 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 24, 'font-weight': 700, fill: 'var(--ink)',
        }, center)
      : null,
    caption
      ? svg('text', {
          x: mid, y: mid + 20, 'text-anchor': 'middle',
          'font-size': 11, fill: 'var(--ink-3)',
        }, caption)
      : null,
  );
}

/** 小さな折れ線（1日ごとの完了数など）。 */
export function sparkline(values, { w = 96, h = 26, color = 'var(--accent)' } = {}) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pt = (v, i) => [i * step, h - 2 - (v / max) * (h - 5)];
  const line = values.map(pt).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;

  return svg('svg', {
    width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'img',
    'aria-label': `直近${values.length}日の完了数 ${values.join('、')}`,
  },
    svg('path', { d: area, fill: color, opacity: .13 }),
    svg('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
  );
}

/**
 * 「増えた」と「終わった」の日ごとの棒グラフ。
 * 完了の棒が増えた棒に追いついていなければ、仕事はたまり続けている。
 */
export function trendBars(rows, { h = 132 } = {}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.created, r.done)));
  const padB = 18;
  const slot = 26;
  const w = rows.length * slot;
  const bw = 8;
  const barH = (v) => (v / max) * (h - padB - 6);

  const g = svg('g', {});
  rows.forEach((r, i) => {
    const x = i * slot + (slot - bw * 2 - 3) / 2;
    const yc = h - padB - barH(r.created);
    const yd = h - padB - barH(r.done);

    g.append(
      svg('rect', {
        x, y: yc, width: bw, height: Math.max(barH(r.created), r.created ? 2 : 0),
        rx: 2, fill: 'var(--todo)', opacity: .55,
      }, svg('title', {}, `${r.day} 発生 ${r.created}件`)),
      svg('rect', {
        x: x + bw + 3, y: yd, width: bw, height: Math.max(barH(r.done), r.done ? 2 : 0),
        rx: 2, fill: 'var(--done)',
      }, svg('title', {}, `${r.day} 完了 ${r.done}件`)),
    );

    if (i % 3 === 0 || i === rows.length - 1) {
      g.append(svg('text', {
        x: x + bw, y: h - 5, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--ink-3)',
      }, `${Number(r.day.slice(5, 7))}/${Number(r.day.slice(8, 10))}`));
    }
  });

  const totalC = rows.reduce((s, r) => s + r.created, 0);
  const totalD = rows.reduce((s, r) => s + r.done, 0);

  return svg('svg', {
    viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `直近${rows.length}日で 発生タスク${totalC}件、完了タスク${totalD}件`,
    style: 'max-width:100%',
  },
    svg('line', { x1: 0, y1: h - padB, x2: w, y2: h - padB, stroke: 'var(--line)', 'stroke-width': 1 }),
    g,
  );
}

/**
 * 目標の進捗の帯。
 * 「いま何％まで進んでいるべきか（pace）」を縦線で重ねるので、
 * 早いのか遅れているのかがひと目でわかる。
 */
export function gauge({ title, current, target, unit, rate, pace, color = 'var(--accent)', meta }) {
  const width = Math.min(100, (rate || 0) * 100);
  const state = pace?.state;
  const fill = state === 'overdue' || state === 'behind' ? 'var(--danger)'
    : state === 'achieved' ? 'var(--ok)'
    : color;

  return el('div', { class: 'gauge' },
    el('div', { class: 'ttl' }, title),
    el('div', { class: 'amount num' },
      `${num(current, 1)} / ${num(target, 1)}`,
      el('span', { class: 'muted' }, unit ? ` ${unit}` : '')),
    el('div', { class: 'track', role: 'img', 'aria-label': `${title} ${pct(rate)}達成` },
      el('i', { class: 'fill', style: { width: `${width}%`, background: fill } }),
      pace?.known && pace.expected !== null
        ? el('i', { class: 'pace', style: { left: `${Math.min(100, pace.expected * 100)}%` },
                    title: `現時点で ${pct(pace.expected)} まで進んでいる予定` })
        : null),
    el('div', { class: 'meta' },
      el('b', { style: { color: fill } }, pct(rate)),
      paceTag(pace),
      meta ? el('span', {}, meta) : null),
  );
}

function paceTag(pace) {
  if (!pace?.known) return el('span', { class: 'muted' }, '期限なし');
  const left = pace.days_left;
  const when = left < 0 ? `期限を${-left}日すぎています`
    : left === 0 ? '期限は今日'
    : `残り${left}日`;

  const map = {
    achieved: ['ok', '達成済み'],
    ahead:    ['ok', '予定より早い'],
    ontrack:  ['', '予定通り'],
    behind:   ['overdue', '予定より遅れ'],
    overdue:  ['overdue', '期限切れ'],
  };
  const [cls, text] = map[pace.state] || ['', ''];

  return el('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } },
    el('span', { class: `tag ${cls}` }, text),
    el('span', {}, when));
}

/** 横棒（メンバーごとの負荷など）。100% の位置に目印を出す。 */
export function loadBar(rate, color) {
  const over = rate !== null && rate > 1;
  const width = rate === null ? 0 : Math.min(100, rate * 100);
  // 100% を超えたら赤。バーは 100% で頭打ちにして、色で「あふれ」を伝える。
  return el('div', { class: 'bar-track' },
    el('div', {
      class: 'bar-fill',
      style: { width: `${width}%`, background: over ? 'var(--danger)' : (color || 'var(--doing)') },
    }),
    el('div', { class: 'bar-mark', style: { left: '100%' } }));
}
