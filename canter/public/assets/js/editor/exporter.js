// 書き出し。
//
// 画面に出しているのと**同じ関数**（render.js）で SVG を作り、それを
//   ・そのまま .svg として保存する
//   ・いったん画像として読み直し、canvas に描いて .png にする
// の2通りに分ける。作り方が1つなので「見えているものと違うものが出る」が起きない。
//
// 【気をつけたところ】
// ブラウザは <img> に読ませた SVG の中から、外のファイルを取りに行かない。
// なので PNG にするときは、使っている画像を先に data: の形に埋めこんでおく。
// 文字は端末に入っているフォントで描かれる（Webフォントは読みこまれない）。
// canter が最初から用意している書体を、どの端末にもある系統から選んでいるのはこのため。

import { renderDoc } from './render.js';

/** doc を SVG の文字列にする。 */
export function toSvgString(doc, assets) {
  const svg = renderDoc(doc, { assets, ids: false });
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

/**
 * 使っている画像を data: に置きかえた対応表を作る。
 * これをしないと、PNG にしたとき画像だけ抜け落ちる。
 */
export async function inlineAssets(doc, assets) {
  const out = new Map();
  const ids = new Set();

  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'image' && n.asset) ids.add(n.asset);
      if (n.type === 'group') walk(n.kids || []);
    }
  };
  walk(doc.nodes);

  for (const id of ids) {
    const url = assets.get(id);
    if (!url) continue;
    try {
      out.set(id, await toDataUrl(url));
    } catch {
      out.set(id, url);   // 読めなくても、そこで止めない
    }
  }

  return out;
}

async function toDataUrl(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('画像を読めませんでした');
  const blob = await res.blob();
  return await new Promise((ok, ng) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ng(new Error('画像を読めませんでした'));
    r.readAsDataURL(blob);
  });
}

/**
 * PNG にする。
 * @param {number} scale  1 なら doc の大きさそのまま。2 にすると倍の解像度。
 * @returns {Promise<Blob>}
 */
export async function toPngBlob(doc, assets, scale = 1) {
  const inlined = await inlineAssets(doc, assets);
  const svgText = toSvgString(doc, inlined);
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(doc.w * scale);
  canvas.height = Math.round(doc.h * scale);

  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await new Promise((ok, ng) => {
    canvas.toBlob((b) => (b ? ok(b) : ng(new Error('画像にできませんでした'))), 'image/png');
  });
}

/** 見本用の小さな PNG（一覧に出すもの）。 */
export async function toThumbDataUrl(doc, assets, longSide = 480) {
  const scale = Math.min(1, longSide / Math.max(doc.w, doc.h));
  const blob = await toPngBlob(doc, assets, scale);
  return await new Promise((ok, ng) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ng(new Error('見本を作れませんでした'));
    r.readAsDataURL(blob);
  });
}

export async function blobToDataUrl(blob) {
  return await new Promise((ok, ng) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ng(new Error('読めませんでした'));
    r.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((ok, ng) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ng(new Error('書き出しの下ごしらえに失敗しました'));
    img.src = src;
  });
}

/** ファイルとして保存させる。 */
export function download(blobOrText, filename, mime = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
