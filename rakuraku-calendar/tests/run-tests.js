#!/usr/bin/env node
/**
 * Code.gs / GmailImport.gs を Google のサービスを模した環境で実行するテスト。
 * 実行: node rakuraku-calendar/tests/run-tests.js
 * （本物の Google アカウントには一切アクセスしません）
 */
'use strict';
process.env.TZ = 'Asia/Tokyo'; // appsscript.json の timeZone と同じにする

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
const GMAIL = fs.readFileSync(path.join(ROOT, 'GmailImport.gs'), 'utf8');

/* ---------- Google サービスの模型 ---------- */

function makeEnv(opt) {
  opt = opt || {};
  let seq = 0;
  const nextId = (p) => p + '-' + (++seq);
  const state = {
    props: {}, triggers: [], mails: [], logs: [], trashed: [], folders: [],
    docs: {}, driveCalls: [], calTz: opt.calTz || 'Asia/Tokyo',
    scriptTz: opt.scriptTz || 'Asia/Tokyo', events: [], lockFree: opt.lockFree !== false,
    ocr: opt.ocr || {}, threads: opt.threads || [],
  };

  function makeFile(name, created) {
    const id = nextId('file');
    const f = {
      _name: name,
      getId: () => id,
      getName: () => f._name,
      setName: (n) => { f._name = n; return f; },
      getBlob: () => ({ getName: () => f._name }),
      getDateCreated: () => created || new Date(2026, 8, 30, 16, 0),
    };
    return f;
  }
  function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  function makeFolder(name) {
    const folder = {
      _files: [], getName: () => name, getId: () => 'folder-' + name, getUrl: () => 'https://drive.example/' + name,
      getFiles: () => iter(folder._files.slice()),
      createFile: (blob) => { const f = makeFile(blob.getName(), new Date()); folder._files.push(f); return f; },
    };
    return folder;
  }

  const ocrConvert = (blob) => {
    const v = state.ocr[blob.getName()];
    if (v instanceof Error) throw v;
    const id = nextId('doc');
    state.docs[id] = v === undefined ? '' : v;
    return { id: id };
  };
  const Drive = opt.noDrive ? undefined : opt.driveV2
    ? { Files: { insert: (res, blob, o) => { state.driveCalls.push({ v: 2, res, o }); return ocrConvert(blob); } } }
    : { Files: { create: (res, blob, o) => { state.driveCalls.push({ v: 3, res, o }); return ocrConvert(blob); } } };

  function makeEvent(title, date, options) {
    const id = nextId('ev');
    const ev = {
      _title: title, _y: date.getFullYear(), _m: date.getMonth() + 1, _d: date.getDate(),
      _popup: [30], _tags: {}, _desc: (options && options.description) || '', _deleted: false,
      getId: () => id, getTitle: () => ev._title, isAllDayEvent: () => true,
      getAllDayStartDate: () => new Date(ev._y, ev._m - 1, ev._d),
      getTag: (k) => (k in ev._tags ? ev._tags[k] : null),
      setTag: (k, v) => { ev._tags[k] = v; return ev; },
      removeAllReminders: () => { ev._popup = []; return ev; },
      addPopupReminder: (min) => {
        assert.ok(Number.isInteger(min) && min >= 5 && min <= 40320, 'reminder minutes out of range: ' + min);
        ev._popup.push(min); return ev;
      },
      getPopupReminders: () => ev._popup.slice(),
      getDescription: () => ev._desc,
      deleteEvent: () => { ev._deleted = true; },
    };
    return ev;
  }
  const live = () => state.events.filter((e) => !e._deleted);
  const calendar = {
    getName: () => 'テスト用カレンダー',
    getTimeZone: () => state.calTz,
    getEventsForDay: (d) => live().filter((e) => e._y === d.getFullYear() && e._m === d.getMonth() + 1 && e._d === d.getDate()),
    createAllDayEvent: (title, date, options) => { const e = makeEvent(title, date, options); state.events.push(e); return e; },
    getEventById: (id) => live().find((e) => e.getId() === id) || null,
  };

  const sandbox = {
    console, Date, JSON, Math, Object, String, Number, RegExp, Error, Array,
    Logger: { log: (s) => state.logs.push(String(s)) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }), getScriptTimeZone: () => state.scriptTz },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in state.props ? state.props[k] : null),
      setProperty: (k, v) => { assert.strictEqual(typeof v, 'string'); state.props[k] = v; },
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => state.lockFree, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => {
        assert.ok([1, 5, 10, 15, 30].includes(n), 'everyMinutes must be 1/5/10/15/30');
        const t = { fn, n, getHandlerFunction: () => fn }; state.triggers.push(t); return t;
      } }) }) }),
    },
    DriveApp: {
      getFoldersByName: (name) => iter(state.folders.filter((f) => f.getName() === name)),
      createFolder: (name) => { const f = makeFolder(name); state.folders.push(f); return f; },
      getFileById: (id) => ({ setTrashed: (b) => { if (b) state.trashed.push(id); } }),
    },
    Drive,
    DocumentApp: { openById: (id) => ({ getBody: () => ({ getText: () => state.docs[id] }) }) },
    MimeType: { GOOGLE_DOCS: 'application/vnd.google-apps.document' },
    CalendarApp: { getDefaultCalendar: () => calendar, getCalendarById: () => null },
    MailApp: { sendEmail: (to, subject, body) => state.mails.push({ to, subject, body }) },
    GmailApp: { search: (q) => { state.lastGmailQuery = q; return state.threads; } },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  if (opt.withGmail) vm.runInContext(GMAIL, ctx, { filename: 'GmailImport.gs' });

  return {
    ctx, state, calendar,
    putFile: (name, created) => {
      const f = state.folders[0] || sandbox.DriveApp.createFolder(ctx.CONFIG.FOLDER_NAME);
      const file = makeFile(name, created); f._files.push(file); return file;
    },
    live,
  };
}

/* ---------- テスト用の文字データ（実物の PDF ではなく、想定した書式の見本） ---------- */

const SAMPLE_OCT = [
  '年少組 10月 行事予定',
  '2026年10月',
  '1日(木) 衣替え',
  '５日（月）　避難訓練',
  '10/12(月) スポーツの日 休園',
  '14日(水) 誕生会 10:00〜',
  '6日(火)',
  '20日(火)までに参加票を提出してください',
  '24(土) 運動会（雨天時 25日）',
  '31日(土) ハロウィンパーティー',
  '32日(日) ありえない日',
  '1 2 3 4 5 6 7',
  'もちつき大会のお知らせ',
  '1日(木) 衣替え',
].join('\n');
const EXPECTED_OCT = [
  [10, 1, '衣替え'], [10, 5, '避難訓練'], [10, 12, 'スポーツの日 休園'], [10, 14, '誕生会 10:00〜'],
  [10, 24, '運動会(雨天時 25日)'], [10, 31, 'ハロウィンパーティー'],
];

/* ---------- テスト本体 ---------- */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
// vm の中で作られた配列は別の Array を持つため、比較前にふつうの値へ直す
const plain = (x) => JSON.parse(JSON.stringify(x));

test('タイムゾーンが日本時間で動いている', () => {
  assert.strictEqual(new Date(2026, 9, 1).getTimezoneOffset(), -540);
});

test('対象ファイル名の判定（濁点分離・全角数字・(1) 付き・対象外）', () => {
  const { ctx } = makeEnv();
  const ok = (n) => ctx.CONFIG.FILE_PATTERN.test(ctx.normalizeText_(n));
  assert.ok(ok('10月カレンダー.pdf'));
  assert.ok(ok('10月カレンダー.pdf'.normalize('NFD')), 'iPhone 由来の濁点分離');
  assert.ok(ok('１１月カレンダー.PDF'));
  assert.ok(ok('10月カレンダー (1).pdf'));
  assert.ok(!ok('10月.pdf'));
  assert.ok(!ok('会社カレンダーと就労証明書.pdf'));
  assert.ok(!ok('10月カレンダー.pdf.zip'));
});

test('年月の決定（ファイル名の月＋近い年、本文の西暦・令和を優先）', () => {
  const { ctx } = makeEnv();
  const r = (name, text, ref) => { const x = ctx.resolveYearMonth_(name, text, ref); return x.year + '/' + x.month; };
  assert.strictEqual(r('10月カレンダー.pdf', '', new Date(2026, 8, 30)), '2026/10');
  assert.strictEqual(r('1月カレンダー.pdf', '', new Date(2026, 11, 25)), '2027/1');
  assert.strictEqual(r('12月カレンダー.pdf', '', new Date(2027, 0, 3)), '2026/12');
  assert.strictEqual(r('10月カレンダー.pdf', '令和8年10月 行事', new Date(2026, 8, 30)), '2026/10');
  assert.strictEqual(r('1月カレンダー.pdf', '2028年1月', new Date(2026, 11, 25)), '2028/1');
  assert.strictEqual(r('カレンダー.pdf', '2026年11月 行事予定', new Date(2026, 9, 30)), '2026/11');
  assert.throws(() => ctx.resolveYearMonth_('カレンダー.pdf', '行事予定', new Date()), /何月のカレンダーか/);
});

test('予定の読み取り（対応する書式・無視すべき行）', () => {
  const { ctx } = makeEnv();
  const evs = ctx.parseEvents_(SAMPLE_OCT, 2026, 10);
  assert.deepStrictEqual(plain(evs.map((e) => [e.month, e.day, e.title])), EXPECTED_OCT);
  evs.forEach((e) => assert.strictEqual(e.year, 2026));
});

test('12月のカレンダーに書かれた 1/8 は翌年として扱う', () => {
  const { ctx } = makeEnv();
  const evs = ctx.parseEvents_('12/24(木) クリスマス会\n1/8(金) 始業式', 2026, 12);
  assert.deepStrictEqual(plain(evs.map((e) => [e.year, e.month, e.day, e.title])),
    [[2026, 12, 24, 'クリスマス会'], [2027, 1, 8, '始業式']]);
});

test('存在しない日付は登録しない（11月31日など）', () => {
  const { ctx } = makeEnv();
  assert.strictEqual(ctx.parseEvents_('31日(月) 何か\n30日(月) 作品展', 2026, 11).length, 1);
  assert.strictEqual(ctx.parseEvents_('29日 豆まき', 2027, 2).length, 0); // 2027年はうるう年でない
  assert.strictEqual(ctx.parseEvents_('29日 豆まき', 2028, 2).length, 1);
});

test('通知は前日17:00（終日予定の0:00から420分前）', () => {
  const { ctx } = makeEnv();
  assert.strictEqual(ctx.reminderMinutesForAllDay_(17), 420);
  assert.throws(() => ctx.reminderMinutesForAllDay_(0));
  assert.throws(() => ctx.reminderMinutesForAllDay_(24));
  const day = new Date(2026, 10, 1); // 11/1 0:00
  const fire = new Date(day.getTime() - 420 * 60000);
  assert.deepStrictEqual([fire.getMonth() + 1, fire.getDate(), fire.getHours(), fire.getMinutes()], [10, 31, 17, 0]);
});

test('setup: フォルダ作成・15分ごとの自動チェック・2回実行しても重複しない', () => {
  const env = makeEnv();
  const lines = env.ctx.setup();
  env.ctx.setup();
  assert.strictEqual(env.state.folders.length, 1);
  assert.strictEqual(env.state.triggers.length, 1);
  assert.strictEqual(env.state.triggers[0].fn, 'checkNew');
  assert.strictEqual(env.state.triggers[0].n, 15);
  assert.ok(!lines.join('\n').includes('要確認'), lines.join('\n'));
  assert.strictEqual(env.state.mails.length, 0, 'PDF がなければメールは出さない');
});

test('PDF 1件 → 6件登録・通知420分のみ・タグ・報告メール・一時ファイル削除', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  const res = env.ctx.checkNew();
  assert.strictEqual(res.length, 1);
  const evs = env.live();
  assert.deepStrictEqual(evs.map((e) => [e._m, e._d, e._title]), EXPECTED_OCT);
  evs.forEach((e) => {
    assert.strictEqual(e._y, 2026);
    assert.deepStrictEqual(e.getPopupReminders(), [420], '既定の通知は消して前日17:00だけにする');
    assert.ok(e.getTag('rakurakuKey').startsWith('2026-'));
    assert.ok(e.getDescription().includes('10月カレンダー.pdf'));
  });
  assert.strictEqual(env.state.driveCalls[0].v, 3);
  assert.strictEqual(env.state.driveCalls[0].o.ocrLanguage, 'ja');
  assert.strictEqual(env.state.driveCalls[0].res.mimeType, 'application/vnd.google-apps.document');
  assert.strictEqual(env.state.trashed.length, 1, 'OCR 用の一時ドキュメントはゴミ箱へ');
  assert.strictEqual(env.state.mails.length, 1);
  assert.strictEqual(env.state.mails[0].to, 'owner@example.com');
  assert.match(env.state.mails[0].subject, /^【らくらく連絡帳→カレンダー】6件登録しました$/);
  assert.ok(env.state.mails[0].body.includes('＋ 10/31 ハロウィンパーティー'));
  assert.ok(env.state.mails[0].body.includes('▼読み取った文字'));
});

test('2回目のチェックでは何もしない（二重登録・二重メールなし）', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  env.ctx.checkNew();
  const res2 = env.ctx.checkNew();
  assert.strictEqual(res2.length, 0);
  assert.strictEqual(env.live().length, 6);
  assert.strictEqual(env.state.mails.length, 1);
});

test('同じ PDF を別名で入れ直しても予定は増えない', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': SAMPLE_OCT, '10月カレンダー (1).pdf': SAMPLE_OCT } });
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  env.ctx.checkNew();
  env.putFile('10月カレンダー (1).pdf');
  const res = env.ctx.checkNew();
  assert.strictEqual(res[0].created.length, 0);
  assert.strictEqual(res[0].skipped.length, 6);
  assert.strictEqual(env.live().length, 6);
  assert.match(env.state.mails[1].subject, /0件登録しました$/);
  assert.ok(!env.state.mails[1].subject.includes('要確認'));
});

test('手で入れてある同名の終日予定は重ねて作らない', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': '24日(土) 運動会\n31日(土) ハロウィンパーティー' } });
  env.calendar.createAllDayEvent('運動会', new Date(2026, 9, 24));
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  const res = env.ctx.checkNew();
  assert.strictEqual(res[0].created.length, 1);
  assert.strictEqual(res[0].skipped.length, 1);
  assert.strictEqual(env.live().length, 2);
});

test('undoLastImport で直前の登録分だけ消せる', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  env.calendar.createAllDayEvent('自分で入れた予定', new Date(2026, 9, 3));
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  env.ctx.checkNew();
  assert.strictEqual(env.live().length, 7);
  assert.strictEqual(env.ctx.undoLastImport(), 6);
  assert.deepStrictEqual(env.live().map((e) => e._title), ['自分で入れた予定']);
  assert.strictEqual(env.ctx.undoLastImport(), 0, '2回目は何も消さない');
});

test('対象外のファイル名はフォルダにあっても触らない', () => {
  const env = makeEnv({ ocr: { '10月.pdf': SAMPLE_OCT } });
  env.ctx.setup();
  env.putFile('10月.pdf');
  assert.strictEqual(env.ctx.checkNew().length, 0);
  assert.strictEqual(env.state.driveCalls.length, 0);
});

test('読み取り失敗 → 要確認メール1回だけ・次回は再送しない', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': new Error('Drive OCR 失敗（模擬）') } });
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  env.ctx.checkNew();
  env.ctx.checkNew();
  assert.strictEqual(env.state.mails.length, 1);
  assert.match(env.state.mails[0].subject, /要確認/);
  assert.ok(env.state.mails[0].body.includes('Drive OCR 失敗（模擬）'));
  assert.ok(env.state.mails[0].body.includes('入れ直す'));
});

test('予定が1件も読めない → 要確認メールに読み取った文字を載せる', () => {
  const env = makeEnv({ ocr: { '10月カレンダー.pdf': '1 2 3 4 5 6 7\n運動会 遠足 誕生会' } });
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  env.ctx.checkNew();
  assert.match(env.state.mails[0].subject, /要確認: 0件/);
  assert.ok(env.state.mails[0].body.includes('運動会 遠足 誕生会'));
  assert.ok(env.state.mails[0].body.includes('Claude に送る'));
});

test('Drive API 無効 → setup が警告、PDF は残して有効化後に処理', () => {
  const env = makeEnv({ noDrive: true, ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  const lines = env.ctx.setup().join('\n');
  assert.ok(lines.includes('Drive API（拡張サービス）が無効'), lines);
  env.putFile('10月カレンダー.pdf');
  assert.strictEqual(env.ctx.checkNew().length, 0);
  assert.strictEqual(env.state.props.processedFiles, undefined, '処理済みにしない');
  env.ctx.Drive = { Files: { create: (res, blob, o) => { env.state.driveCalls.push({ v: 3 }); env.state.docs['d'] = SAMPLE_OCT; return { id: 'd' }; } } };
  assert.strictEqual(env.ctx.checkNew().length, 1);
  assert.strictEqual(env.live().length, 6);
});

test('タイムゾーンが日本でなければ setup が警告する', () => {
  const env = makeEnv({ calTz: 'UTC', scriptTz: 'America/Los_Angeles' });
  const lines = env.ctx.setup().join('\n');
  assert.ok(lines.includes('カレンダーのタイムゾーンが UTC'));
  assert.ok(lines.includes('スクリプトのタイムゾーンが America/Los_Angeles'));
});

test('ほかの実行中は重ねて動かない（ロック）', () => {
  const env = makeEnv({ lockFree: false, ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  env.ctx.DriveApp.createFolder(env.ctx.CONFIG.FOLDER_NAME);
  env.putFile('10月カレンダー.pdf');
  assert.strictEqual(env.ctx.checkNew().length, 0);
  assert.strictEqual(env.live().length, 0);
});

test('Drive API を v2 で有効にしていても動く', () => {
  const env = makeEnv({ driveV2: true, ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  env.ctx.setup();
  env.putFile('10月カレンダー.pdf');
  env.ctx.checkNew();
  assert.strictEqual(env.state.driveCalls[0].v, 2);
  assert.strictEqual(env.state.driveCalls[0].o.ocr, true);
  assert.strictEqual(env.live().length, 6);
});

test('【任意】GmailImport: 送信元のメールの PDF をフォルダへ保存して同じ回で登録', () => {
  const att = (name) => ({ getName: () => name, copyBlob: () => ({ getName: () => name }) });
  const msg = { getId: () => 'msg-1', getAttachments: () => [att('10月.pdf'), att('10月カレンダー.pdf')] };
  const env = makeEnv({ withGmail: true, threads: [{ getMessages: () => [msg] }], ocr: { '10月カレンダー.pdf': SAMPLE_OCT } });
  env.ctx.CONFIG.GMAIL_SENDER = 'noreply@example.jp';
  env.ctx.setup();
  assert.match(env.state.lastGmailQuery, /^from:noreply@example\.jp has:attachment filename:pdf newer_than:14d$/);
  assert.strictEqual(env.state.folders[0]._files.length, 1, '対象外の 10月.pdf は保存しない');
  assert.strictEqual(env.live().length, 6);
  env.ctx.checkNew();
  assert.strictEqual(env.state.folders[0]._files.length, 1, '同じ添付を二度保存しない');
  assert.strictEqual(env.live().length, 6);
});

test('GMAIL_SENDER が空なら Gmail を見ない', () => {
  const env = makeEnv({ withGmail: true });
  env.ctx.setup();
  assert.strictEqual(env.state.lastGmailQuery, undefined);
});

/* ---------- 実行 ---------- */

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('PASS  ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + t.name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n      '));
  }
}
console.log('\n' + (tests.length - failed) + ' / ' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
