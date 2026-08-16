/* =========================================================
 *  ハグミン ツムツム  ―  セーブデータ（localStorage）
 * =======================================================*/

var Save = (function () {

  var KEY = 'hagukumin_tsum_v1';

  var DEFAULT = {
    coins: 0,
    highScore: 0,
    plays: 0,
    totalScore: 0,
    maxCombo: 0,
    selected: 'moko',
    owned: {},          // charId -> true
    exp: {},            // charId -> exp
    bgm: true,
    se: true
  };

  var data = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      var d = JSON.parse(raw);
      var out = fresh();
      for (var k in DEFAULT) if (d[k] !== undefined) out[k] = d[k];
      // 無料キャラは常に所持
      CHARACTERS.forEach(function (c) { if (c.price === 0) out.owned[c.id] = true; });
      return out;
    } catch (e) {
      return fresh();
    }
  }

  function fresh() {
    var d = JSON.parse(JSON.stringify(DEFAULT));
    CHARACTERS.forEach(function (c) {
      if (c.price === 0) d.owned[c.id] = true;
      d.exp[c.id] = 0;
    });
    return d;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 保存不可でも続行 */ }
  }

  return {
    get data() { return data; },
    save: save,
    owns: function (id) { return !!data.owned[id]; },
    buy: function (id) {
      var c = CHAR_BY_ID[id];
      if (!c || data.owned[id] || data.coins < c.price) return false;
      data.coins -= c.price;
      data.owned[id] = true;
      save();
      return true;
    },
    addExp: function (id, v) {
      var before = charLevelFromExp(data.exp[id] || 0);
      data.exp[id] = (data.exp[id] || 0) + v;
      var after = charLevelFromExp(data.exp[id]);
      return after > before ? after : -1;   // レベルアップしたら新レベル
    },
    level: function (id) { return charLevelFromExp(data.exp[id] || 0); },
    reset: function () { data = fresh(); save(); }
  };
})();
