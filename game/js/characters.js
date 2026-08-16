/* =========================================================
 *  ハグミン ツムツム  ―  キャラクター定義
 *  すべて自作のオリジナルキャラクター（procedural art）
 * =======================================================*/

/**
 * ears   : 'round' | 'pointed' | 'long' | 'horn' | 'none'
 * eyes   : 'dot'   | 'sparkle' | 'sleepy' | 'wink'
 * mouth  : 'w'     | 'smile'   | 'cat'    | 'o'
 * item   : 'none'  | 'leaf'    | 'star'   | 'ribbon' | 'moon' | 'crown'
 */
const CHARACTERS = [
  {
    id: 'moko',
    name: 'モコ',
    kana: 'ふわふわの みんなの人気者',
    color: '#FFD27F',
    dark: '#E9A94C',
    inner: '#FFF0D2',
    cheek: '#FF9E9E',
    ears: 'round', eyes: 'dot', mouth: 'w', item: 'none',
    price: 0,
    skill: {
      id: 'burst',
      name: 'まんまるバースト',
      desc: 'まんなかの ツムを まるく まとめて消す',
      need: [22, 20, 18, 16, 14],
      power: [110, 125, 140, 158, 178]   // 効果半径(px)
    }
  },
  {
    id: 'rubi',
    name: 'ルビィ',
    kana: 'まけずぎらいな 火の子',
    color: '#FF7F6E',
    dark: '#D9503F',
    inner: '#FFD3CB',
    cheek: '#FF5B7F',
    ears: 'pointed', eyes: 'sparkle', mouth: 'smile', item: 'ribbon',
    price: 0,
    skill: {
      id: 'line_h',
      name: 'フレイムライン',
      desc: 'よこ一列を 燃やして消す',
      need: [24, 22, 20, 18, 16],
      power: [90, 105, 120, 138, 158]    // 帯の高さ(px)
    }
  },
  {
    id: 'sora',
    name: 'ソラ',
    kana: 'そらを かける 風のこども',
    color: '#7FC9F2',
    dark: '#3E93C9',
    inner: '#D6EFFF',
    cheek: '#8ED8FF',
    ears: 'none', eyes: 'sparkle', mouth: 'o', item: 'star',
    price: 0,
    skill: {
      id: 'line_v',
      name: 'そらとびウェーブ',
      desc: 'たて一列を かぜで ふきとばす',
      need: [24, 22, 20, 18, 16],
      power: [110, 126, 142, 160, 180]   // 帯の幅(px)
    }
  },
  {
    id: 'riifu',
    name: 'リーフ',
    kana: 'みどりを そだてる めばえの子',
    color: '#9DE0A0',
    dark: '#4FA45C',
    inner: '#E1F7DF',
    cheek: '#FFB0C8',
    ears: 'long', eyes: 'dot', mouth: 'smile', item: 'leaf',
    price: 500,
    skill: {
      id: 'grow',
      name: 'めばえの祝福',
      desc: 'ツムを 大ツムに そだてる',
      need: [26, 24, 22, 20, 18],
      power: [3, 4, 5, 6, 8]             // 大ツムにする数
    }
  },
  {
    id: 'pomu',
    name: 'ポム',
    kana: 'あまえんぼうの ねこっ子',
    color: '#FFA9CF',
    dark: '#DB6499',
    inner: '#FFE0EF',
    cheek: '#FF6F9C',
    ears: 'pointed', eyes: 'wink', mouth: 'cat', item: 'none',
    price: 800,
    skill: {
      id: 'cross',
      name: 'ハートクロス',
      desc: 'じゅうじに ツムを 消す',
      need: [26, 24, 22, 20, 18],
      power: [84, 96, 108, 122, 138]     // 帯の太さ(px)
    }
  },
  {
    id: 'nowa',
    name: 'ノワ',
    kana: 'よるを まもる ねぼすけ',
    color: '#B6A6F5',
    dark: '#6F5FC4',
    inner: '#E7E1FF',
    cheek: '#C9A0FF',
    ears: 'horn', eyes: 'sleepy', mouth: 'smile', item: 'moon',
    price: 1200,
    skill: {
      id: 'night',
      name: 'よぞらのねがい',
      desc: 'ランダムに消して じかんを +3びょう',
      need: [28, 26, 24, 22, 20],
      power: [10, 13, 16, 19, 23]        // 消す数
    }
  },
  {
    id: 'haguru',
    name: 'ハグミン',
    kana: 'つたえの きんいろ ハグミン',
    color: '#FFD84D',
    dark: '#D9A400',
    inner: '#FFF4C2',
    cheek: '#FFA23E',
    ears: 'round', eyes: 'sparkle', mouth: 'w', item: 'crown',
    price: 3000,
    skill: {
      id: 'same',
      name: 'ハグ・オールクリア',
      desc: 'おなじ しゅるいの ツムを ぜんぶ消す',
      need: [30, 28, 26, 24, 22],
      power: [1, 1, 2, 2, 3]             // 消す種類の数
    }
  }
];

const CHAR_BY_ID = {};
CHARACTERS.forEach(function (c, i) { c.index = i; CHAR_BY_ID[c.id] = c; });

/** キャラのレベル（0-index の内部レベル 0..4 ＝ 表示 Lv1..5） */
const CHAR_EXP_TABLE = [0, 300, 900, 2000, 4200];

function charLevelFromExp(exp) {
  var lv = 0;
  for (var i = 0; i < CHAR_EXP_TABLE.length; i++) {
    if (exp >= CHAR_EXP_TABLE[i]) lv = i;
  }
  return lv;
}

function charExpToNext(exp) {
  var lv = charLevelFromExp(exp);
  if (lv >= CHAR_EXP_TABLE.length - 1) return null;
  return {
    cur: exp - CHAR_EXP_TABLE[lv],
    need: CHAR_EXP_TABLE[lv + 1] - CHAR_EXP_TABLE[lv]
  };
}
