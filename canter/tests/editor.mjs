// エディタの計算部分のテスト。
//
//   node tests/editor.mjs      （= make test-js）
//
// 画面を出さずに確かめられるところ（幾何・パス演算・組みかえ・履歴）を見る。
// とくにパス演算は、目で見て合っているか分かりにくいので、
// 「細かい格子で数えた面積」を正解として突き合わせている。
// アルゴリズムの中身とはまったく別のやり方で出した答えなので、
// 両方が同じ間違いをすることはない。

import {
  bbox, corners, toLocal, toCanvas, rotatePoint, area, pointInPolygon,
  pointInRings, flattenSubpath, unionBox, polyBox, distToSegment,
} from '../public/assets/js/editor/geom.js';
import { toRings, combine, ringsToNode, canCombine } from '../public/assets/js/editor/pathops.js';
import {
  makeNode, newDoc, magicResize, group, ungroup, align, distribute,
  reorder, applyPalette, applyTextStyle, findNode,
} from '../public/assets/js/editor/scene.js';
import { createHistory } from '../public/assets/js/editor/history.js';
import { snapMove } from '../public/assets/js/editor/snap.js';

let pass = 0;
const fail = [];

const ok = (what, cond, extra = '') => {
  if (cond) pass++;
  else fail.push(what + (extra ? `  (${extra})` : ''));
};

const same = (what, want, got) =>
  ok(what, JSON.stringify(want) === JSON.stringify(got),
    `ほしい ${JSON.stringify(want)} / じっさい ${JSON.stringify(got)}`);

const near = (what, want, got, tol = 0.01) =>
  ok(what, Math.abs(want - got) <= tol, `ほしい ${want} / じっさい ${got}`);

// ---- 幾何 -----------------------------------------------------------------

const box = { x: 10, y: 20, w: 100, h: 50, rot: 0 };
same('回転していない囲みはそのまま', { x: 10, y: 20, w: 100, h: 50 }, bbox(box));

const turned = bbox({ x: 0, y: 0, w: 100, h: 50, rot: 90 });
near('90度まわすと縦横が入れかわる（はば）', 50, turned.w);
near('90度まわすと縦横が入れかわる（たかさ）', 100, turned.h);
near('90度まわしても中心は動かない', 50, turned.x + turned.w / 2);

const rotated = { x: 100, y: 100, w: 80, h: 40, rot: 37 };
const back = toLocal(rotated, ...Object.values(toCanvas(rotated, 12, 7)));
near('図形の中の座標へ行って戻ると元にもどる（よこ）', 12, back.x, 0.001);
near('図形の中の座標へ行って戻ると元にもどる（たて）', 7, back.y, 0.001);

near('点をまわす', 0, rotatePoint(10, 0, 0, 0, 90).x, 0.001);
near('点をまわす（たて）', 10, rotatePoint(10, 0, 0, 0, 90).y, 0.001);

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
near('四角の面積', 100, area(square));
ok('中の点は中と分かる', pointInPolygon({ x: 5, y: 5 }, square));
ok('外の点は外と分かる', !pointInPolygon({ x: 15, y: 5 }, square));
near('線分までの距離', 5, distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 10 }));

same('いくつかの囲みをまとめる',
  { x: 0, y: 0, w: 30, h: 40 },
  unionBox([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 30, w: 10, h: 10 }]));

const line = flattenSubpath({ closed: false, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
same('まっすぐな区間は分割しない', 2, line.length);

const curve = flattenSubpath({
  closed: false,
  pts: [{ x: 0, y: 0, h2x: 5, h2y: 10 }, { x: 10, y: 0, h1x: 5, h1y: 10 }],
}, 8);
ok('曲がった区間は細かく分ける', curve.length === 9);
ok('曲線はふくらむ', curve.some((p) => p.y > 3));

// ---- パス演算 -------------------------------------------------------------
//
// 「細かい格子で数えた面積」を正解にして突き合わせる。

function gridArea(inside, area0, n = 220) {
  const sx = area0.w / n;
  const sy = area0.h / n;
  let hit = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (inside({ x: area0.x + (i + 0.5) * sx, y: area0.y + (j + 0.5) * sy })) hit++;
    }
  }
  return hit * sx * sy;
}

function checkOp(name, A, B, op) {
  const ra = toRings(A);
  const rb = toRings(B);
  const res = combine(ra, rb, op);

  const b = polyBox([...ra.flat(), ...rb.flat()]);
  const field = { x: b.x - 5, y: b.y - 5, w: b.w + 10, h: b.h + 10 };

  const inA = (p) => pointInRings(p, ra);
  const inB = (p) => pointInRings(p, rb);
  const truth = {
    union: (p) => inA(p) || inB(p),
    intersect: (p) => inA(p) && inB(p),
    subtract: (p) => inA(p) && !inB(p),
    exclude: (p) => inA(p) !== inB(p),
  }[op];

  const want = gridArea(truth, field);
  const got = gridArea((p) => pointInRings(p, res), field);
  const scale = Math.max(gridArea((p) => inA(p) || inB(p), field), 1);

  ok(`${name} の ${op}`, Math.abs(want - got) / scale < 0.01,
    `ずれ ${((Math.abs(want - got) / scale) * 100).toFixed(2)}%`);
}

const rect = (x, y, w, h, rot = 0, radius = 0) => makeNode('rect', { x, y, w, h, rot, radius });
const ell = (x, y, w, h, rot = 0) => makeNode('ellipse', { x, y, w, h, rot });

const OPS = ['union', 'intersect', 'subtract', 'exclude'];
const CASES = [
  ['重なる四角', rect(0, 0, 100, 100), rect(50, 50, 100, 100)],
  ['ぴったり同じ四角', rect(0, 0, 100, 100), rect(0, 0, 100, 100)],
  ['辺がふれあう四角', rect(0, 0, 100, 100), rect(100, 0, 100, 100)],
  ['角だけふれあう', rect(0, 0, 100, 100), rect(100, 100, 100, 100)],
  ['中に小さい四角（穴になる）', rect(0, 0, 200, 200), rect(60, 60, 80, 80)],
  ['離れている', rect(0, 0, 80, 80), rect(200, 200, 80, 80)],
  ['円と四角', ell(0, 0, 160, 160), rect(80, 20, 140, 60)],
  ['円と円', ell(0, 0, 140, 140), ell(70, 10, 140, 140)],
  ['まわした四角どうし', rect(0, 0, 120, 120, 30), rect(60, 20, 120, 120, -15)],
  ['角丸と円', rect(0, 0, 150, 100, 0, 24), ell(90, 30, 120, 120)],
];

for (const [name, A, B] of CASES) {
  for (const op of OPS) checkOp(name, A, B, op);
}

// 乱数でも確かめる（決め打ちの形だけで通っても意味がないので）
let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

for (let k = 0; k < 25; k++) {
  const mk = () => (rnd() < 0.5
    ? rect(rnd() * 100, rnd() * 100, 40 + rnd() * 120, 40 + rnd() * 120, rnd() * 90)
    : ell(rnd() * 100, rnd() * 100, 40 + rnd() * 120, 40 + rnd() * 120));
  const A = mk();
  const B = mk();
  for (const op of OPS) checkOp(`乱数#${k}`, A, B, op);
}

// 穴があくこと（型抜きの本来の使い道）
const donut = combine(toRings(ell(0, 0, 200, 200)), toRings(ell(50, 50, 100, 100)), 'subtract');
same('中の円を抜くと輪郭が2本になる（＝穴があく）', 2, donut.length);
ok('抜いたまん中は外になる', !pointInRings({ x: 100, y: 100 }, donut));
ok('ドーナツの身は中に残る', pointInRings({ x: 20, y: 100 }, donut));

const node = ringsToNode(donut, {});
same('パスに戻すと輪郭は2本のまま', 2, node.d.length);
ok('パスに戻すと点は0〜1にしまわれる',
  node.d.every((s) => s.pts.every((p) => p.x >= -0.001 && p.x <= 1.001 && p.y >= -0.001 && p.y <= 1.001)));
same('穴のある形は even-odd で塗る', 'evenodd', node.rule);

ok('文字はパス演算にかけられない', !canCombine(makeNode('text')));
ok('画像はパス演算にかけられない', !canCombine(makeNode('image')));
ok('四角はかけられる', canCombine(makeNode('rect')));

// ---- 組みかえ -------------------------------------------------------------

function sampleDoc() {
  const doc = newDoc(1000, 1000);
  doc.nodes = [
    makeNode('rect', { id: 'bg', x: 0, y: 0, w: 1000, h: 1000, fill: '#ffffff' }),
    makeNode('rect', { id: 'a', x: 100, y: 100, w: 200, h: 100, fill: '#f0508c' }),
    makeNode('ellipse', { id: 'b', x: 500, y: 300, w: 100, h: 100, fill: '#7c5cff' }),
    makeNode('text', { id: 't', x: 100, y: 600, w: 800, h: 120, fontSize: 60, text: 'あ' }),
  ];
  return doc;
}

// マジックリサイズ
{
  const doc = sampleDoc();
  const out = magicResize(doc, 1000, 2000, 'stretch');

  same('新しいキャンバスの大きさになる', [1000, 2000], [out.w, out.h]);

  const bg = findNode(out, 'bg');
  same('背景は新しい枠いっぱいに合わせ直される', [0, 0, 1000, 2000], [bg.x, bg.y, bg.w, bg.h]);

  const a = findNode(out, 'a');
  near('図形の縦横の比は変わらない', 200 / 100, a.w / a.h, 0.001);
  near('大きさは縦横まとめて同じ比（この場合は等倍）', 200, a.w, 0.001);
  near('たての位置は新しい高さに合わせて動く', (150 / 1000) * 2000, a.y + a.h / 2, 0.5);

  const t = findNode(out, 't');
  near('文字の大きさも同じ比で変わる', 60, t.fontSize, 0.001);

  const half = magicResize(sampleDoc(), 500, 500, 'stretch');
  near('半分にすると図形も半分', 100, findNode(half, 'a').w, 0.001);
  near('半分にすると字も半分', 30, findNode(half, 't').fontSize, 0.001);

  // fit は「構図をそのまま保つ」ほう。キャンバスの中心からのずれが、同じ比で保たれる。
  const fit = magicResize(sampleDoc(), 2000, 1000, 'fit');
  const fa = findNode(fit, 'a');
  near('fit は中心からのずれをそのまま保つ', 1000 + (200 - 500), fa.x + fa.w / 2, 0.5);

  const fb = findNode(fit, 'b');
  near('fit では図形どうしの間かくも変わらない',
    550 - 200, (fb.x + fb.w / 2) - (fa.x + fa.w / 2), 0.5);
}

// グループ
{
  const doc = sampleDoc();
  const g = group(doc, ['a', 'b']);
  ok('グループができる', g !== null && g.type === 'group');
  same('グループの囲みは中身をぜんぶ含む', [100, 100, 500, 300], [g.x, g.y, g.w, g.h]);
  same('元の図形はグループの中に移る', 3, doc.nodes.length);
  same('中身の座標はグループの左上からになる', [0, 0], [g.kids[0].x, g.kids[0].y]);

  g.w = 1000;   // 横に倍にのばす
  const kids = ungroup(doc, g.id);
  same('グループを解くと中身が戻る', 2, kids.length);
  near('のばしたぶんが中身にも効く', 400, kids[0].w, 0.5);
}

// ぞろえ・すきま
{
  const doc = newDoc(1000, 1000);
  doc.nodes = [
    makeNode('rect', { id: 'p', x: 0, y: 0, w: 100, h: 100 }),
    makeNode('rect', { id: 'q', x: 300, y: 50, w: 100, h: 100 }),
    makeNode('rect', { id: 'r', x: 900, y: 90, w: 100, h: 100 }),
  ];

  align(doc, ['p', 'q', 'r'], 'top');
  same('上ぞろえで、たての位置がそろう', [0, 0, 0], doc.nodes.map((n) => n.y));

  distribute(doc, ['p', 'q', 'r'], 'x');
  const xs = doc.nodes.map((n) => n.x);
  near('すきまが等しくなる', xs[1] - xs[0], xs[2] - xs[1], 0.5);

  align(doc, ['p'], 'hcenter');
  near('1つだけならキャンバスの中央へ', 500, doc.nodes[0].x + 50, 0.5);
}

// 重なり
{
  const doc = sampleDoc();
  reorder(doc, ['bg'], 'front');
  same('いちばん前に出す', 'bg', doc.nodes[doc.nodes.length - 1].id);
  reorder(doc, ['bg'], 'back');
  same('いちばん後ろに送る', 'bg', doc.nodes[0].id);
  reorder(doc, ['bg'], 'forward');
  same('1つ前へ', 1, doc.nodes.findIndex((n) => n.id === 'bg'));
}

// 配色の置きかえ
{
  const doc = sampleDoc();
  const out = applyPalette(doc, ['#111111', '#222222', '#333333']);
  ok('配色を変えると色が入れかわる', findNode(out, 'a').fill !== '#f0508c');
  ok('元のほうは変わらない', findNode(doc, 'a').fill === '#f0508c');
  ok('入れかえ先はパレットの中の色',
    ['#111111', '#222222', '#333333'].includes(findNode(out, 'a').fill));
}

// 文字のひな型
{
  const styled = applyTextStyle(makeNode('text'), { font: 'serif', weight: 700, size: 0.05, lineHeight: 1.6, tracking: 0.02 }, 1000);
  same('ひな型をあてると書体が変わる', 'serif', styled.font);
  same('大きさはキャンバスの幅から決まる', 50, styled.fontSize);
}

// ---- 元に戻す -------------------------------------------------------------

{
  const h = createHistory({ n: 0 });
  ok('はじめは戻せない', !h.canUndo);

  h.push({ n: 1 }, 'a');
  h.push({ n: 2 }, 'b');
  same('いまの状態', 2, h.doc.n);

  same('1つ戻す', 1, h.undo().n);
  same('もう1つ戻す', 0, h.undo().n);
  ok('それ以上は戻せない', h.undo() === null);
  same('やり直す', 1, h.redo().n);

  // 続けざまの同じ操作はまとめる
  const h2 = createHistory({ n: 0 });
  h2.push({ n: 1 }, 'move');
  h2.push({ n: 2 }, 'move');
  h2.push({ n: 3 }, 'move');
  same('続けざまの同じ操作は1回にまとまる', 0, h2.undo().n);

  // 種類が変われば別の記録になる
  const h3 = createHistory({ n: 0 });
  h3.push({ n: 1 }, 'move');
  h3.push({ n: 2 }, 'resize');
  same('種類が変われば別に残る', 1, h3.undo().n);
}

// ---- 吸着 -----------------------------------------------------------------

{
  const doc = newDoc(1000, 1000);
  const others = [{ x: 400, y: 400, w: 200, h: 200 }];

  const hit = snapMove({ x: 398, y: 300, w: 100, h: 100 }, others, doc, 1);
  near('近くの縦線に吸いつく', 2, hit.dx, 0.001);
  ok('吸いついた線をガイドとして返す', hit.guides.some((g) => g.axis === 'x' && g.v === 400));

  const miss = snapMove({ x: 200, y: 200, w: 100, h: 100 }, others, doc, 1);
  same('遠いときは動かさない', 0, miss.dx);

  const canvasCenter = snapMove({ x: 448, y: 200, w: 100, h: 100 }, [], doc, 1);
  near('キャンバスの中心にも吸いつく', 2, canvasCenter.dx, 0.001);

  // 拡大しているときは、画面の見た目で同じ距離になるよう効き方が変わる
  const zoomed = snapMove({ x: 396, y: 300, w: 100, h: 100 }, others, doc, 4);
  same('拡大しているときは、はなれていると吸いつかない', 0, zoomed.dx);
}

// ---- 結果 -----------------------------------------------------------------

console.log(`\n${pass} 件たしかめました`);
if (fail.length) {
  console.log(`\n✗ ${fail.length} 件しっぱい`);
  for (const f of fail) console.log('   - ' + f);
  process.exit(1);
}
console.log('✓ ぜんぶ通りました');
