// 元に戻す・やり直す。
//
// doc をまるごと控えておく方式。図形は多くても数百なので、
// 差分をとる仕組みを持つより、こちらのほうが読みやすく間違いが少ない。
//
// 続けざまの操作（ドラッグ中の1ピクセルずつの移動など）を1回にまとめるため、
// 「同じ種類の操作が短い間に続いたら上書きする」ようにしてある。

const LIMIT = 120;
const MERGE_MS = 600;

export function createHistory(initial) {
  const past = [];
  const future = [];
  let current = clone(initial);
  let lastKind = '';
  let lastAt = 0;

  return {
    get doc() {
      return current;
    },

    /**
     * 変更を記録する。
     * @param {object} doc   新しい doc
     * @param {string} kind  操作の種類（同じ種類が続くとまとめる）
     */
    push(doc, kind = '') {
      const now = Date.now();
      const merge = kind !== '' && kind === lastKind && now - lastAt < MERGE_MS;

      if (!merge) {
        past.push(current);
        if (past.length > LIMIT) past.shift();
      }

      current = clone(doc);
      future.length = 0;
      lastKind = kind;
      lastAt = now;
    },

    /** 記録せずに今の状態だけ差し替える（読み込み直後など）。 */
    reset(doc) {
      past.length = 0;
      future.length = 0;
      current = clone(doc);
      lastKind = '';
    },

    undo() {
      if (past.length === 0) return null;
      future.push(current);
      current = past.pop();
      lastKind = '';
      return current;
    },

    redo() {
      if (future.length === 0) return null;
      past.push(current);
      current = future.pop();
      lastKind = '';
      return current;
    },

    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get depth() { return past.length; },
  };
}

function clone(v) {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}
