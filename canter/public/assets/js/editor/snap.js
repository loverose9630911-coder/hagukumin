// スマートガイド（吸着）。
//
// 動かしている図形の「左・中央・右」「上・中央・下」が、
// ほかの図形やキャンバスの同じ線に近づいたら、そこへ吸いつける。
// イラストレーターの「スマートガイド」やキャンバの整列補助にあたるもの。
//
// 吸着の判定は**画面上の距離**で行う。拡大しているときに効きすぎない／
// 縮小しているときに効かなさすぎない、を防ぐため、しきい値を zoom で割る。

const THRESHOLD_PX = 7;

/**
 * 動かした先の位置を、近くの線に合わせ直す。
 *
 * @param {object} moving  動かしている囲み {x,y,w,h}
 * @param {array}  others  ほかの図形の囲み
 * @param {object} doc     キャンバス（端と中心も吸着の相手にする）
 * @param {number} zoom
 * @returns {{dx:number, dy:number, guides:array}}
 */
export function snapMove(moving, others, doc, zoom = 1) {
  const t = THRESHOLD_PX / Math.max(zoom, 0.05);

  const xTargets = [];
  const yTargets = [];

  // キャンバスの端と中心
  xTargets.push({ v: 0, kind: 'canvas' }, { v: doc.w / 2, kind: 'canvas' }, { v: doc.w, kind: 'canvas' });
  yTargets.push({ v: 0, kind: 'canvas' }, { v: doc.h / 2, kind: 'canvas' }, { v: doc.h, kind: 'canvas' });

  for (const b of others) {
    xTargets.push({ v: b.x, kind: 'node' }, { v: b.x + b.w / 2, kind: 'node' }, { v: b.x + b.w, kind: 'node' });
    yTargets.push({ v: b.y, kind: 'node' }, { v: b.y + b.h / 2, kind: 'node' }, { v: b.y + b.h, kind: 'node' });
  }

  const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  const bestX = nearest(mx, xTargets, t);
  const bestY = nearest(my, yTargets, t);

  const guides = [];
  if (bestX) guides.push({ axis: 'x', v: bestX.target });
  if (bestY) guides.push({ axis: 'y', v: bestY.target });

  return {
    dx: bestX ? bestX.delta : 0,
    dy: bestY ? bestY.delta : 0,
    guides,
  };
}

/** 動かしている3本の線のうち、いちばん近い相手をひとつ選ぶ。 */
function nearest(values, targets, t) {
  let best = null;
  for (const v of values) {
    for (const target of targets) {
      const d = target.v - v;
      if (Math.abs(d) > t) continue;
      if (best === null || Math.abs(d) < Math.abs(best.delta)) {
        best = { delta: d, target: target.v };
      }
    }
  }
  return best;
}

/** 1つの数を、いちばん近い候補に寄せる（大きさを変えるときに使う）。 */
export function snapValue(value, targets, zoom = 1) {
  const t = THRESHOLD_PX / Math.max(zoom, 0.05);
  let best = value;
  let bestD = t;
  let hit = null;

  for (const target of targets) {
    const d = Math.abs(target - value);
    if (d < bestD) {
      bestD = d;
      best = target;
      hit = target;
    }
  }

  return { value: best, guide: hit };
}
