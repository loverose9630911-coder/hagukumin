/* =========================================================
 *  ハグミン ツムツム  ―  スキル効果
 *  api: {
 *    tsums(), field:{w,h}, clear(list, tag), addTime(sec),
 *    makeBig(n), flash(color), shake(power), ring(x,y,r,color)
 *  }
 * =======================================================*/

var Skills = (function () {

  function pickRandom(arr, n) {
    var a = arr.slice(), out = [];
    while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
    return out;
  }

  var TABLE = {

    /* まんまるバースト：円形範囲を消す */
    burst: function (api, power) {
      var ts = api.tsums();
      if (!ts.length) return;
      // ツムが密集している場所を中心にする
      var cx = 0, cy = 0;
      ts.forEach(function (t) { cx += t.x; cy += t.y; });
      cx /= ts.length; cy /= ts.length;
      cy = Math.max(cy, api.field.h * 0.55);
      api.ring(cx, cy, power, '#FFD27F');
      api.shake(10);
      var hit = ts.filter(function (t) {
        return (t.x - cx) * (t.x - cx) + (t.y - cy) * (t.y - cy) <= power * power;
      });
      api.clear(hit, 'skill');
    },

    /* フレイムライン：よこ帯 */
    line_h: function (api, power) {
      var ts = api.tsums();
      if (!ts.length) return;
      var ys = ts.map(function (t) { return t.y; }).sort(function (a, b) { return a - b; });
      var cy = ys[Math.floor(ys.length * 0.55)];
      api.ring(api.field.w / 2, cy, power * 1.4, '#FF7F6E');
      api.band(0, cy - power / 2, api.field.w, power, '#FF7F6E');
      api.shake(9);
      api.clear(ts.filter(function (t) { return Math.abs(t.y - cy) <= power / 2; }), 'skill');
    },

    /* そらとびウェーブ：たて帯 */
    line_v: function (api, power) {
      var ts = api.tsums();
      if (!ts.length) return;
      var cx = 0;
      ts.forEach(function (t) { cx += t.x; });
      cx /= ts.length;
      cx = Math.max(power / 2, Math.min(api.field.w - power / 2, cx + (Math.random() - 0.5) * 120));
      api.band(cx - power / 2, 0, power, api.field.h, '#7FC9F2');
      api.shake(9);
      api.clear(ts.filter(function (t) { return Math.abs(t.x - cx) <= power / 2; }), 'skill');
    },

    /* めばえの祝福：大ツムを作る */
    grow: function (api, power) {
      var n = api.makeBig(power);
      api.flash('rgba(157,224,160,0.45)');
      api.shake(5);
      return n;
    },

    /* ハートクロス：じゅうじに消す */
    cross: function (api, power) {
      var ts = api.tsums();
      if (!ts.length) return;
      var cx = 0, cy = 0;
      ts.forEach(function (t) { cx += t.x; cy += t.y; });
      cx /= ts.length; cy /= ts.length;
      cy = Math.max(cy, api.field.h * 0.58);
      api.band(0, cy - power / 2, api.field.w, power, '#FFA9CF');
      api.band(cx - power / 2, 0, power, api.field.h, '#FFA9CF');
      api.shake(10);
      api.clear(ts.filter(function (t) {
        return Math.abs(t.y - cy) <= power / 2 || Math.abs(t.x - cx) <= power / 2;
      }), 'skill');
    },

    /* よぞらのねがい：ランダム消し＋時間 */
    night: function (api, power) {
      var ts = api.tsums();
      var hit = pickRandom(ts, power);
      hit.forEach(function (t) { api.ring(t.x, t.y, t.r * 1.6, '#B6A6F5'); });
      api.addTime(3);
      api.flash('rgba(182,166,245,0.4)');
      api.shake(7);
      api.clear(hit, 'skill');
    },

    /* ハグ・オールクリア：同じ種類を全部消す */
    same: function (api, power) {
      var ts = api.tsums();
      if (!ts.length) return;
      var counts = {};
      ts.forEach(function (t) { counts[t.charId] = (counts[t.charId] || 0) + 1; });
      var ids = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      var targets = ids.slice(0, power);
      api.flash('rgba(255,216,77,0.5)');
      api.shake(12);
      api.clear(ts.filter(function (t) { return targets.indexOf(t.charId) >= 0; }), 'skill');
    }
  };

  function run(skillId, api, power) {
    var fn = TABLE[skillId];
    if (fn) fn(api, power);
  }

  return { run: run };
})();
