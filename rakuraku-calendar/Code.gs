/**
 * らくらく連絡帳の「〇〇カレンダー.pdf」→ Googleカレンダー 自動登録
 *
 * 動かすアカウント : love.rose.9630911@gmail.com の Google アカウント
 *                    （このスクリプトを作ったアカウントのカレンダーに登録されます）
 * 流れ             : Driveフォルダ「らくらく連絡帳カレンダー」に PDF が入る
 *                    → 15分ごとの自動チェックで PDF を読む
 *                       ・マス目のカレンダー（Excel などで作った PDF）は、PDF から直接マスごとに読み取る
 *                       ・それ以外は Drive の文字認識で読み、「5日(土) 運動会」のような行を拾う
 *                    → 日ごとに終日の予定として登録
 *                    → 各予定に「前日 17:00」のポップアップ通知を設定
 *                    → 登録結果をこのアカウントあてにメールで報告
 *
 * 初回だけ setup を1回実行してください。あとは自動です。
 */

var CONFIG = {
  FOLDER_NAME: 'らくらく連絡帳カレンダー', // PDF を入れる Drive フォルダ（setup で自動作成）
  FILE_PATTERN: /カレンダー(?:\s*\(\d+\))?\.pdf$/i, // 「〇〇カレンダー.pdf」「〇〇カレンダー (1).pdf」
  CALENDAR_ID: '',                          // 空ならこのアカウントのメインカレンダー
  NOTIFY_HOUR: 17,                          // 前日の何時に通知するか
  TIME_ZONE: 'Asia/Tokyo',
  CHECK_EVERY_MINUTES: 15,                  // 自動チェックの間隔（1/5/10/15/30 のどれか）
  SEND_REPORT_MAIL: true,                   // 登録結果をメールで知らせる
  GMAIL_SENDER: '',                         // GmailImport.gs を追加したときだけ使う送信元アドレス
  GMAIL_LOOKBACK_DAYS: 14
};

var TAG_KEY = 'rakurakuKey';
var TAG_SOURCE = 'rakurakuSource';
var PROP_PROCESSED = 'processedFiles';
var PROP_LAST_CREATED = 'lastCreatedEventIds';
var WEEKDAY_RE = '[(（][月火水木金土日祝・\\s]{1,5}[)）]';

/* ===================== 利用者が実行する関数 ===================== */

/** 初回に1回だけ実行：フォルダ作成・自動チェック登録・設定の点検 */
function setup() {
  var folder = getOrCreateFolder_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkNew') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkNew').timeBased().everyMinutes(CONFIG.CHECK_EVERY_MINUTES).create();

  var cal = getCalendar_();
  var lines = [
    '【設定完了】',
    'PDF を入れるフォルダ: ' + folder.getName() + '  ' + folder.getUrl(),
    '登録先カレンダー: ' + cal.getName(),
    '自動チェック: ' + CONFIG.CHECK_EVERY_MINUTES + '分ごと',
    '通知: 予定の前日 ' + CONFIG.NOTIFY_HOUR + ':00（ポップアップ）'
  ];
  var warnings = checkEnvironment_(cal);
  if (warnings.length) lines = lines.concat(['', '【要確認】'], warnings);
  Logger.log(lines.join('\n'));

  checkNew(); // すでにフォルダに PDF があればすぐ処理する
  return lines;
}

/** 自動チェック本体（15分ごとに自動実行。手動実行しても可） */
function checkNew() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return [];
  try {
    if (!driveAvailable_()) {
      // PDF は処理済みにせず残す。Drive API を有効にした次の回で処理される
      Logger.log('Drive API（拡張サービス）が無効のため処理を見送りました。README の手順3を確認してください。');
      return [];
    }
    var folder = getOrCreateFolder_();
    if (CONFIG.GMAIL_SENDER && typeof importFromGmail_ === 'function') importFromGmail_(folder);

    var processed = loadJson_(PROP_PROCESSED, {});
    var results = [];
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var name = normalizeText_(file.getName());
      if (!CONFIG.FILE_PATTERN.test(name)) continue;
      if (processed[file.getId()]) continue;

      var result;
      try {
        result = processFile_(file, name);
      } catch (e) {
        result = { fileName: name, error: String(e && e.message ? e.message : e), created: [], skipped: [], text: '' };
      }
      processed[file.getId()] = { at: new Date().toISOString(), ok: !result.error };
      saveJson_(PROP_PROCESSED, pruneProcessed_(processed));
      results.push(result);
    }

    var createdIds = [];
    results.forEach(function (r) { r.created.forEach(function (c) { createdIds.push(c.id); }); });
    if (createdIds.length) saveJson_(PROP_LAST_CREATED, createdIds);

    if (results.length && CONFIG.SEND_REPORT_MAIL) sendReport_(results);
    results.forEach(function (r) { Logger.log(buildReportSection_(r)); });
    return results;
  } finally {
    lock.releaseLock();
  }
}

/** 直前の自動登録で作った予定をまとめて削除する（読み取りミスがあったとき用） */
function undoLastImport() {
  var ids = loadJson_(PROP_LAST_CREATED, []);
  var cal = getCalendar_();
  var deleted = 0;
  ids.forEach(function (id) {
    var ev = cal.getEventById(id);
    if (ev) { ev.deleteEvent(); deleted++; }
  });
  saveJson_(PROP_LAST_CREATED, []);
  Logger.log('削除した予定: ' + deleted + '件');
  return deleted;
}

/* ===================== 処理の中身 ===================== */

function processFile_(file, name) {
  var blob = file.getBlob();
  var grid = null;
  var gridProblem = '';
  try {
    grid = readCalendarGridFromPdf_(blob.getBytes());
  } catch (e) {
    gridProblem = String(e && e.message ? e.message : e);
  }
  var method, text, ym, events, notes;
  if (grid) {
    method = 'PDF のマス目から直接読み取り';
    text = gridToText_(grid);
    ym = resolveYearMonth_(name, grid.title.join('\n'), file.getDateCreated());
    checkGridMatchesMonth_(grid, ym.year, ym.month);
    events = gridToEvents_(grid, ym.year, ym.month);
    notes = grid.notes;
  } else {
    method = '文字認識（Google ドキュメントへの変換）' + (gridProblem ? '　※マス目の読み取りに失敗: ' + gridProblem : '');
    text = extractText_(blob, name);
    ym = resolveYearMonth_(name, text, file.getDateCreated());
    events = parseEvents_(text, ym.year, ym.month);
    notes = [];
  }
  var cal = getCalendar_();
  var created = [];
  var skipped = [];
  events.forEach(function (ev) {
    var r = registerEvent_(cal, ev, name, file.getId());
    (r.status === 'created' ? created : skipped).push(r);
  });
  return { fileName: name, year: ym.year, month: ym.month, created: created, skipped: skipped, text: text, error: '', method: method, notes: notes };
}

/** マス目の日ごとの文字を、終日の予定にする。予定名は行を「 / 」でつなぐ */
function gridToEvents_(grid, year, month) {
  var out = [];
  grid.cells.forEach(function (c) {
    if (!c.lines.length) return;
    var title = c.lines.join(' / ');
    out.push({ year: year, month: month, day: c.day, title: title, lines: c.lines,
      key: year + '-' + pad2_(month) + '-' + pad2_(c.day) + '|' + title });
  });
  return out;
}

/** マス目の曜日と日数が、決めた年月の暦と合うか確かめる。合わなければ登録しない */
function checkGridMatchesMonth_(grid, year, month) {
  var wd = new Date(year, month - 1, 1).getDay();
  if (grid.firstWeekday !== wd) {
    throw new Error(year + '年' + month + '月1日の曜日と、PDF の1日の位置が合いません。年か月の読み取りを確認してください。');
  }
  if (grid.lastDay !== daysInMonth_(year, month)) {
    throw new Error('PDF から読めた日付が ' + grid.lastDay + '日までで、' + month + '月の日数と合いません。');
  }
}

function gridToText_(grid) {
  var lines = grid.title.slice();
  grid.cells.forEach(function (c) { lines.push(c.day + '日: ' + (c.lines.length ? c.lines.join(' / ') : '（なし）')); });
  return lines.concat(grid.notes).join('\n');
}

/** PDF を一時的に Google ドキュメントへ変換（OCR）して文字を取り出す */
function extractText_(blob, name) {
  if (!driveAvailable_()) {
    throw new Error('Drive API（拡張サービス）が有効になっていません。README の手順3を確認してください。');
  }
  var title = 'tmp_ocr_' + name;
  var doc;
  if (typeof Drive.Files.create === 'function') {
    doc = Drive.Files.create({ name: title, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'ja' });
  } else {
    doc = Drive.Files.insert({ title: title, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocr: true, ocrLanguage: 'ja' });
  }
  try {
    return DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    DriveApp.getFileById(doc.id).setTrashed(true);
  }
}

/** 何年何月のカレンダーかを決める */
function resolveYearMonth_(name, text, refDate) {
  var n = normalizeText_(name);
  var t = normalizeText_(text || '');
  var month = null;
  var m = n.match(/(\d{1,2})\s*月/);
  if (m) month = Number(m[1]);

  var explicit = [];
  var re1 = /(\d{4})\s*年\s*(\d{1,2})\s*月/g;
  var re2 = /令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月/g;
  var x;
  while ((x = re1.exec(t)) !== null) explicit.push({ year: Number(x[1]), month: Number(x[2]) });
  while ((x = re2.exec(t)) !== null) explicit.push({ year: 2018 + (x[1] === '元' ? 1 : Number(x[1])), month: Number(x[2]) });

  if (month === null) {
    if (!explicit.length) throw new Error('何月のカレンダーか分かりません（ファイル名にも本文にも「◯月」がありません）');
    month = explicit[0].month;
  }
  if (month < 1 || month > 12) throw new Error('月の読み取りに失敗しました: ' + month);

  for (var i = 0; i < explicit.length; i++) {
    if (explicit[i].month === month) return { year: explicit[i].year, month: month };
  }
  // 「令和8年度」「2026年度」: 年度は4月始まり。1〜3月は翌年
  var fy = t.match(/令和\s*(\d{1,2}|元)\s*年度/);
  var fyYear = fy ? 2018 + (fy[1] === '元' ? 1 : Number(fy[1])) : null;
  if (fyYear === null) {
    var fy2 = t.match(/(\d{4})\s*年度/);
    if (fy2) fyYear = Number(fy2[1]);
  }
  if (fyYear !== null) return { year: month >= 4 ? fyYear : fyYear + 1, month: month };
  var ref = refDate || new Date();
  return { year: nearestYear_(ref.getFullYear(), ref.getMonth() + 1, month), month: month };
}

/** 基準の年月にいちばん近い年を選ぶ（12月に届いた「1月」は翌年、など） */
function nearestYear_(refYear, refMonth, month) {
  var diff = month - refMonth;
  if (diff < -6) return refYear + 1;
  if (diff > 6) return refYear - 1;
  return refYear;
}

/**
 * 本文から予定を取り出す。対応する行の形:
 *   「5日(土) 運動会」「5日 運動会」「5(土) 運動会」「10/5(土) 運動会」「10月5日(土) 運動会」
 * 日付だけで予定名がない行（カレンダーのマス目など）は無視する。
 */
function parseEvents_(text, year, month) {
  var lines = normalizeText_(text || '').split(/\r?\n/);
  var seen = {};
  var out = [];
  var patterns = [
    { re: new RegExp('^(\\d{1,2})\\s*[/.]\\s*(\\d{1,2})(?!\\d)\\s*(?:' + WEEKDAY_RE + ')?\\s*(.*)$'), hasMonth: true },
    { re: new RegExp('^(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日\\s*(?:' + WEEKDAY_RE + ')?\\s*(.*)$'), hasMonth: true },
    { re: new RegExp('^(\\d{1,2})\\s*日\\s*(?:' + WEEKDAY_RE + ')?\\s*(.*)$'), hasMonth: false },
    { re: new RegExp('^(\\d{1,2})\\s*' + WEEKDAY_RE + '\\s*(.*)$'), hasMonth: false }
  ];

  lines.forEach(function (raw) {
    var line = raw.replace(/\s+/g, ' ').trim();
    if (!line) return;
    for (var i = 0; i < patterns.length; i++) {
      var m = line.match(patterns[i].re);
      if (!m) continue;
      var evMonth = patterns[i].hasMonth ? Number(m[1]) : month;
      var day = Number(patterns[i].hasMonth ? m[2] : m[1]);
      var rest = patterns[i].hasMonth ? m[3] : m[2];
      var title = cleanTitle_(rest);
      if (!title) return;
      if (evMonth < 1 || evMonth > 12) return;
      var evYear = evMonth === month ? year : nearestYear_(year, month, evMonth);
      if (day < 1 || day > daysInMonth_(evYear, evMonth)) return;
      var key = evYear + '-' + pad2_(evMonth) + '-' + pad2_(day) + '|' + title;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ year: evYear, month: evMonth, day: day, title: title, key: key });
      return;
    }
  });
  return out;
}

function cleanTitle_(rest) {
  var t = String(rest || '').replace(/^[\s:：\-・,、]+/, '').trim();
  if (!t) return '';
  if (/^[\d\s/.:()（）月火水木金土日祝・]+$/.test(t)) return ''; // 数字や曜日だけ = 予定名ではない
  if (/^(まで|頃|以降|以内)/.test(t)) return ''; // 「5日までに提出」など文中の日付（行事名はこれらで始まらない）
  return t;
}

/** 終日予定として登録し、前日 NOTIFY_HOUR 時の通知を付ける。同じ予定があれば作らない */
function registerEvent_(cal, ev, sourceName, sourceId) {
  var date = new Date(ev.year, ev.month - 1, ev.day);
  var label = ev.month + '/' + ev.day + ' ' + ev.title;
  var existing = cal.getEventsForDay(date);
  for (var i = 0; i < existing.length; i++) {
    var e = existing[i];
    if (e.getTag(TAG_KEY) === ev.key || (e.isAllDayEvent() && e.getTitle() === ev.title)) {
      return { status: 'skipped', label: label, reason: '同じ予定が登録済み' };
    }
  }
  var created = cal.createAllDayEvent(ev.title, date, {
    description: (ev.lines ? ev.lines.join('\n') + '\n\n' : '') + 'らくらく連絡帳「' + sourceName + '」から自動登録'
  });
  created.removeAllReminders();
  created.addPopupReminder(reminderMinutesForAllDay_(CONFIG.NOTIFY_HOUR));
  created.setTag(TAG_KEY, ev.key.slice(0, 900));
  created.setTag(TAG_SOURCE, String(sourceId));
  return { status: 'created', label: label, id: created.getId() };
}

/** 終日予定の通知は「その日の 0:00 の何分前か」で指定する。前日17:00 → 7時間前 = 420分 */
function reminderMinutesForAllDay_(hour) {
  if (!(hour >= 1 && hour <= 23)) throw new Error('NOTIFY_HOUR は 1〜23 で指定してください: ' + hour);
  return (24 - hour) * 60;
}

/* ===================== 報告・点検 ===================== */

function sendReport_(results) {
  var to = Session.getEffectiveUser().getEmail();
  var createdCount = 0;
  var hasProblem = false;
  results.forEach(function (r) {
    createdCount += r.created.length;
    if (r.error || (!r.created.length && !r.skipped.length)) hasProblem = true;
  });
  var subject = '【らくらく連絡帳→カレンダー】' + (hasProblem ? '要確認: ' : '') + createdCount + '件登録しました';
  var body = results.map(buildReportSection_).join('\n\n------------------------------\n\n');
  MailApp.sendEmail(to, subject, body);
}

function buildReportSection_(r) {
  var lines = ['ファイル: ' + r.fileName];
  if (r.error) {
    lines.push('結果: 失敗しました');
    lines.push('理由: ' + r.error);
    lines.push('対処: 原因を直したあと、PDF をもう一度フォルダに入れ直すと再処理されます。');
    return lines.join('\n');
  }
  lines.push('対象: ' + r.year + '年' + r.month + '月');
  if (r.method) lines.push('読み取り方法: ' + r.method);
  lines.push('登録: ' + r.created.length + '件 / 登録済みのため省略: ' + r.skipped.length + '件');
  r.created.forEach(function (c) { lines.push('  ＋ ' + c.label); });
  r.skipped.forEach(function (s) { lines.push('  ＝ ' + s.label + '（' + s.reason + '）'); });
  if (!r.created.length && !r.skipped.length) {
    lines.push('予定を1件も読み取れませんでした。下の「読み取った文字」を Claude に送ると、読み取り方を合わせられます。');
  }
  if (r.notes && r.notes.length) {
    lines.push('日付のない注意書き（予定には入れていません）:');
    r.notes.forEach(function (n) { lines.push('  ・' + n); });
  }
  lines.push('通知: 各予定の前日 ' + CONFIG.NOTIFY_HOUR + ':00');
  lines.push('間違って登録された場合: スクリプトの undoLastImport を実行すると、今回の登録分を消せます。');
  lines.push('');
  lines.push('▼読み取った文字（PDF と見比べて抜けがないか確認してください）');
  lines.push(String(r.text || '').slice(0, 6000));
  return lines.join('\n');
}

function checkEnvironment_(cal) {
  var w = [];
  if (!driveAvailable_()) {
    w.push('・Drive API（拡張サービス）が無効です。README の手順3で有効にしてください。');
  }
  if (Session.getScriptTimeZone() !== CONFIG.TIME_ZONE) {
    w.push('・スクリプトのタイムゾーンが ' + Session.getScriptTimeZone() + ' です。appsscript.json の timeZone を ' + CONFIG.TIME_ZONE + ' にしてください。');
  }
  if (cal.getTimeZone() !== CONFIG.TIME_ZONE) {
    w.push('・カレンダーのタイムゾーンが ' + cal.getTimeZone() + ' です。' + CONFIG.TIME_ZONE + ' 以外だと通知時刻がずれます。');
  }
  return w;
}

/* ===================== 小さな部品 ===================== */

function driveAvailable_() {
  return typeof Drive !== 'undefined' && !!Drive.Files;
}

function getOrCreateFolder_() {
  var it = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
}

function getCalendar_() {
  var cal = CONFIG.CALENDAR_ID ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('カレンダーが見つかりません: ' + CONFIG.CALENDAR_ID);
  return cal;
}

/** 全角英数→半角、濁点の分離（iPhone から上げたファイル名で起きる）→結合 */
function normalizeText_(s) {
  return String(s).normalize('NFKC');
}

function daysInMonth_(year, month) {
  return new Date(year, month, 0).getDate();
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function loadJson_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

function saveJson_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}

/** 処理済み記録は400日分だけ残す（保存容量の上限対策） */
function pruneProcessed_(processed) {
  var limit = Date.now() - 400 * 24 * 60 * 60 * 1000;
  var out = {};
  Object.keys(processed).forEach(function (id) {
    var at = Date.parse(processed[id].at);
    if (!(at < limit)) out[id] = processed[id];
  });
  return out;
}
/* ===================== PDF を直接読む（カレンダーのマス目） ===================== */
/*
 * Excel などで作られた「文字の入った PDF」から、文字とその位置を取り出す。
 * Google ドキュメントへの変換（文字認識）を使わないので、マス目の位置関係が崩れない。
 * 画像だけの PDF（スキャンなど）では文字が取れないため、その場合は文字認識に切り替える。
 */

/** Apps Script の blob.getBytes()（-128〜127）や配列を 0〜255 の Uint8Array にする */
function toUint8_(bytes) {
  var u = new Uint8Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) u[i] = bytes[i] & 255;
  return u;
}

function bytesToLatin1_(u, start, end) {
  var s = '';
  var from = start || 0;
  var to = end === undefined ? u.length : end;
  for (var i = from; i < to; i += 8192) {
    s += String.fromCharCode.apply(null, Array.prototype.slice.call(u.subarray(i, Math.min(i + 8192, to))));
  }
  return s;
}

/* ---------- 圧縮の展開（RFC 1950/1951） ---------- */

var INF_LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var INF_LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var INF_DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var INF_DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var INF_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function inflate_(src) {
  var pos = 0;
  if (src.length >= 2 && (src[0] & 15) === 8 && ((src[0] << 8) | src[1]) % 31 === 0) pos = 2; // zlib の頭
  var out = new Uint8Array(Math.max(1024, src.length * 4));
  var outLen = 0;
  var bitBuf = 0;
  var bitCnt = 0;

  function need(n) {
    if (outLen + n <= out.length) return;
    var bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  }
  function bits(n) {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('圧縮データが途中で終わっています');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    var v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  }
  function build(lengths, n) {
    var count = new Array(16).fill(0);
    var symbol = new Array(n).fill(0);
    var offs = new Array(16).fill(0);
    for (var s = 0; s < n; s++) count[lengths[s]]++;
    count[0] = 0;
    for (var len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
    for (s = 0; s < n; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
    return { count: count, symbol: symbol };
  }
  function decode(h) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len <= 15; len++) {
      code |= bits(1);
      var count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('圧縮データの符号が不正です');
  }
  function codes(lit, dist) {
    for (;;) {
      var sym = decode(lit);
      if (sym < 256) { need(1); out[outLen++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw new Error('圧縮データの長さ符号が不正です');
      var len = INF_LBASE[sym] + bits(INF_LEXT[sym]);
      var ds = decode(dist);
      if (ds >= 30) throw new Error('圧縮データの距離符号が不正です');
      var d = INF_DBASE[ds] + bits(INF_DEXT[ds]);
      if (d > outLen) throw new Error('圧縮データの距離が範囲外です');
      need(len);
      for (var k = 0; k < len; k++) { out[outLen] = out[outLen - d]; outLen++; }
    }
  }

  var fixedLit = null, fixedDist = null;
  var last = 0;
  while (!last) {
    last = bits(1);
    var type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) throw new Error('圧縮データが途中で終わっています');
      var len = src[pos] | (src[pos + 1] << 8);
      var nlen = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if (len !== (~nlen & 0xffff)) throw new Error('圧縮データの長さが不正です');
      if (pos + len > src.length) throw new Error('圧縮データが途中で終わっています');
      need(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len; pos += len;
    } else if (type === 1) {
      if (!fixedLit) {
        var l = new Array(288);
        for (var i = 0; i < 144; i++) l[i] = 8;
        for (; i < 256; i++) l[i] = 9;
        for (; i < 280; i++) l[i] = 7;
        for (; i < 288; i++) l[i] = 8;
        fixedLit = build(l, 288);
        var dl = new Array(30).fill(5);
        fixedDist = build(dl, 30);
      }
      codes(fixedLit, fixedDist);
    } else if (type === 2) {
      var nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4;
      var cl = new Array(19).fill(0);
      for (i = 0; i < nc; i++) cl[INF_ORDER[i]] = bits(3);
      var ch = build(cl, 19);
      var lengths = new Array(nl + nd).fill(0);
      i = 0;
      while (i < nl + nd) {
        var sym = decode(ch);
        if (sym < 16) { lengths[i++] = sym; continue; }
        var rep, val = 0;
        if (sym === 16) { if (!i) throw new Error('圧縮データが不正です'); val = lengths[i - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nl + nd) throw new Error('圧縮データが不正です');
        while (rep--) lengths[i++] = val;
      }
      codes(build(lengths.slice(0, nl), nl), build(lengths.slice(nl), nd));
    } else {
      throw new Error('圧縮データの種類が不正です');
    }
  }
  return out.subarray(0, outLen);
}

/* ---------- PDF の字句・値の読み取り ---------- */

function PdfLexer_(s, pos) {
  this.s = s;
  this.pos = pos || 0;
}

PdfLexer_.prototype.skipSpace = function () {
  var s = this.s;
  for (;;) {
    var c = s.charCodeAt(this.pos);
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00) { this.pos++; continue; }
    if (c === 0x25) { // % コメント
      while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++;
      continue;
    }
    return;
  }
};

/** 次の字句。{k:'num'|'name'|'str'|'op'|'['|']'|'<<'|'>>'|'eof', v} */
PdfLexer_.prototype.next = function () {
  this.skipSpace();
  var s = this.s;
  if (this.pos >= s.length) return { k: 'eof' };
  var c = s[this.pos];
  if (c === '[' || c === ']' || c === '{' || c === '}') { this.pos++; return { k: c === '{' ? '[' : c === '}' ? ']' : c }; }
  if (c === '<' && s[this.pos + 1] === '<') { this.pos += 2; return { k: '<<' }; }
  if (c === '>' && s[this.pos + 1] === '>') { this.pos += 2; return { k: '>>' }; }
  if (c === '<') {
    var end = s.indexOf('>', this.pos);
    if (end < 0) end = s.length;
    var hex = s.slice(this.pos + 1, end).replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length % 2) hex += '0';
    var str = '';
    for (var i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    this.pos = end + 1;
    return { k: 'str', v: str };
  }
  if (c === '(') return { k: 'str', v: this.literal() };
  if (c === '/') {
    var j = this.pos + 1;
    while (j < s.length && !/[\s\/\[\]<>(){}%]/.test(s[j])) j++;
    var name = s.slice(this.pos + 1, j).replace(/#([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
    this.pos = j;
    return { k: 'name', v: name };
  }
  var k = this.pos;
  while (k < s.length && !/[\s\/\[\]<>(){}%]/.test(s[k])) k++;
  if (k === this.pos) { this.pos++; return { k: 'op', v: c }; }
  var word = s.slice(this.pos, k);
  this.pos = k;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { k: 'num', v: parseFloat(word) };
  return { k: 'op', v: word };
};

PdfLexer_.prototype.literal = function () {
  var s = this.s;
  var depth = 0;
  var out = '';
  this.pos++; // (
  depth = 1;
  while (this.pos < s.length) {
    var c = s[this.pos++];
    if (c === '\\') {
      var n = s[this.pos++];
      if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 't') out += '\t';
      else if (n === 'b') out += '\b';
      else if (n === 'f') out += '\f';
      else if (n === '\r') { if (s[this.pos] === '\n') this.pos++; }
      else if (n === '\n') { /* 行の継続 */ }
      else if (/[0-7]/.test(n)) {
        var oct = n;
        while (oct.length < 3 && /[0-7]/.test(s[this.pos])) oct += s[this.pos++];
        out += String.fromCharCode(parseInt(oct, 8) & 255);
      } else out += n;
    } else if (c === '(') { depth++; out += c; }
    else if (c === ')') { depth--; if (!depth) break; out += c; }
    else out += c;
  }
  return out;
};

/** 値を1つ読む。辞書→{}, 配列→[], 名前→{name}, 参照→{ref}, 文字列→{str} */
PdfLexer_.prototype.value = function (tok) {
  var t = tok || this.next();
  if (t.k === 'num') {
    var save = this.pos;
    var t2 = this.next();
    if (t2.k === 'num') {
      var t3 = this.next();
      if (t3.k === 'op' && t3.v === 'R') return { ref: t.v };
    }
    this.pos = save;
    return t.v;
  }
  if (t.k === 'name') return { name: t.v };
  if (t.k === 'str') return { str: t.v };
  if (t.k === '[') {
    var arr = [];
    for (;;) {
      var a = this.next();
      if (a.k === ']' || a.k === 'eof') return arr;
      arr.push(this.value(a));
    }
  }
  if (t.k === '<<') {
    var d = {};
    for (;;) {
      var key = this.next();
      if (key.k === '>>' || key.k === 'eof') return d;
      if (key.k !== 'name') continue;
      d[key.v] = this.value();
    }
  }
  if (t.k === 'op') {
    if (t.v === 'true') return true;
    if (t.v === 'false') return false;
    if (t.v === 'null') return null;
  }
  return { op: t.v };
};

/* ---------- PDF ファイルの中のオブジェクト ---------- */

function PdfDoc_(u8) {
  this.u = u8;
  this.s = bytesToLatin1_(u8);
  this.objs = {};
  this.cache = {};
  var re = /(\d+)\s+(\d+)\s+obj\b/g;
  var m;
  while ((m = re.exec(this.s)) !== null) this.objs[Number(m[1])] = { at: re.lastIndex };
  var self = this;
  Object.keys(this.objs).forEach(function (n) {
    var o = self.get(Number(n));
    if (o && o.dict && o.dict.Type && o.dict.Type.name === 'ObjStm') self.loadObjStm_(o);
  });
}

PdfDoc_.prototype.resolve = function (v) {
  var guard = 0;
  while (v && typeof v === 'object' && v.ref !== undefined && guard++ < 20) {
    var o = this.get(v.ref);
    v = o ? (o.dict !== undefined ? o.dict : o.value) : null;
  }
  return v;
};

/** 番号のオブジェクトを読む。{value} か ストリームなら {dict, data(未展開)} */
PdfDoc_.prototype.get = function (n) {
  if (this.cache[n]) return this.cache[n];
  var e = this.objs[n];
  if (!e) return null;
  if (e.inline !== undefined) {
    var lx0 = new PdfLexer_(e.inline, 0);
    var r0 = { value: lx0.value() };
    this.cache[n] = r0;
    return r0;
  }
  var lx = new PdfLexer_(this.s, e.at);
  var v = lx.value();
  var after = lx.next();
  var res;
  if (after.k === 'op' && after.v === 'stream') {
    var p = lx.pos;
    if (this.s[p] === '\r' && this.s[p + 1] === '\n') p += 2;
    else if (this.s[p] === '\n' || this.s[p] === '\r') p += 1;
    var len = this.resolveLength_(v.Length);
    if (!(len >= 0) || p + len > this.u.length || this.s.substr(p + len, 20).indexOf('endstream') < 0) {
      var endAt = this.s.indexOf('endstream', p);
      len = (endAt < 0 ? this.u.length : endAt) - p;
      while (len > 0 && (this.s[p + len - 1] === '\n' || this.s[p + len - 1] === '\r')) len--;
    }
    res = { dict: v, start: p, length: len };
  } else {
    res = { value: v };
  }
  this.cache[n] = res;
  return res;
};

PdfDoc_.prototype.resolveLength_ = function (L) {
  if (typeof L === 'number') return L;
  if (L && L.ref !== undefined) {
    var o = this.get(L.ref);
    return o && typeof o.value === 'number' ? o.value : -1;
  }
  return -1;
};

/** ストリームの中身（展開済み）を返す */
PdfDoc_.prototype.streamData = function (o) {
  var raw = this.u.subarray(o.start, o.start + o.length);
  var f = o.dict.Filter;
  var filters = !f ? [] : Array.isArray(f) ? f : [f];
  var data = raw;
  for (var i = 0; i < filters.length; i++) {
    var name = this.resolve(filters[i]).name;
    if (name === 'FlateDecode' || name === 'Fl') data = inflate_(data);
    else throw new Error('未対応の圧縮形式です: ' + name);
  }
  return data;
};

PdfDoc_.prototype.loadObjStm_ = function (o) {
  var text = bytesToLatin1_(this.streamData(o));
  var n = o.dict.N, first = o.dict.First;
  var lx = new PdfLexer_(text, 0);
  var pairs = [];
  for (var i = 0; i < n; i++) {
    var a = lx.next(), b = lx.next();
    if (a.k !== 'num' || b.k !== 'num') break;
    pairs.push([a.v, b.v]);
  }
  for (i = 0; i < pairs.length; i++) {
    var num = pairs[i][0];
    if (this.objs[num]) continue; // ふつうの位置にあるものを優先
    var from = first + pairs[i][1];
    var to = i + 1 < pairs.length ? first + pairs[i + 1][1] : text.length;
    this.objs[num] = { inline: text.slice(from, to) };
  }
};

PdfDoc_.prototype.pages = function () {
  var out = [];
  /** @type {any} */
  var root = null;
  var self = this;
  Object.keys(this.objs).forEach(function (n) {
    var o = self.get(Number(n));
    var d = o && (o.dict || o.value);
    if (d && d.Type && d.Type.name === 'Catalog') root = d;
  });
  function walk(node, inherited) {
    node = self.resolve(node);
    if (!node) return;
    var res = node.Resources !== undefined ? node.Resources : inherited;
    if (node.Type && node.Type.name === 'Pages') {
      (self.resolve(node.Kids) || []).forEach(function (k) { walk(k, res); });
    } else {
      out.push({ dict: node, resources: self.resolve(res) || {} });
    }
  }
  if (root) walk(root.Pages, null);
  return out;
};

/* ---------- 文字の対応表（フォント） ---------- */

function readToUnicode_(text) {
  var map = {};
  var lx = new PdfLexer_(text, 0);
  var toks = [];
  for (var t = lx.next(); t.k !== 'eof'; t = lx.next()) toks.push(t);
  function code(str) { var c = 0; for (var i = 0; i < str.length; i++) c = c * 256 + str.charCodeAt(i); return c; }
  function utf16(str) {
    var s = '';
    for (var i = 0; i + 1 < str.length; i += 2) s += String.fromCharCode(str.charCodeAt(i) * 256 + str.charCodeAt(i + 1));
    return s;
  }
  for (var i = 0; i < toks.length; i++) {
    if (toks[i].k === 'op' && toks[i].v === 'beginbfchar') {
      i++;
      while (i + 1 < toks.length && !(toks[i].k === 'op' && toks[i].v === 'endbfchar')) {
        map[code(toks[i].v)] = utf16(toks[i + 1].v);
        i += 2;
      }
    } else if (toks[i].k === 'op' && toks[i].v === 'beginbfrange') {
      i++;
      while (i + 2 < toks.length && !(toks[i].k === 'op' && toks[i].v === 'endbfrange')) {
        var lo = code(toks[i].v), hi = code(toks[i + 1].v);
        if (toks[i + 2].k === '[') {
          var j = i + 3, c = lo;
          while (j < toks.length && toks[j].k !== ']') { map[c++] = utf16(toks[j].v); j++; }
          i = j + 1;
        } else {
          var dst = toks[i + 2].v;
          var base = utf16(dst);
          for (var c2 = lo; c2 <= hi && c2 - lo < 65536; c2++) {
            var last = base.charCodeAt(base.length - 1) + (c2 - lo);
            map[c2] = base.slice(0, -1) + String.fromCharCode(last);
          }
          i += 3;
        }
      }
    }
  }
  return map;
}

function loadFont_(doc, ref) {
  var d = doc.resolve(ref) || {};
  var font = { twoByte: false, toUni: null, widths: {}, dw: 1000, first: 0 };
  var sub = d.Subtype && d.Subtype.name;
  if (d.ToUnicode) {
    var tu = doc.get(d.ToUnicode.ref);
    if (tu && tu.dict) font.toUni = readToUnicode_(bytesToLatin1_(doc.streamData(tu)));
  }
  if (sub === 'Type0') {
    font.twoByte = true;
    var desc = doc.resolve((doc.resolve(d.DescendantFonts) || [])[0]) || {};
    if (typeof desc.DW === 'number') font.dw = desc.DW;
    var w = doc.resolve(desc.W) || [];
    for (var i = 0; i < w.length;) {
      var c = doc.resolve(w[i]);
      var nx = doc.resolve(w[i + 1]);
      if (Array.isArray(nx)) {
        for (var k = 0; k < nx.length; k++) font.widths[c + k] = doc.resolve(nx[k]);
        i += 2;
      } else {
        var w3 = doc.resolve(w[i + 2]);
        for (var c3 = c; c3 <= nx; c3++) font.widths[c3] = w3;
        i += 3;
      }
    }
  } else {
    font.dw = 500;
    font.first = typeof d.FirstChar === 'number' ? d.FirstChar : 0;
    var ws = doc.resolve(d.Widths) || [];
    for (var j = 0; j < ws.length; j++) font.widths[font.first + j] = doc.resolve(ws[j]);
  }
  return font;
}

/** 文字列（バイト）をフォントに従って字形の並びにする */
function decodeGlyphs_(font, str) {
  var out = [];
  var step = font.twoByte ? 2 : 1;
  for (var i = 0; i + step - 1 < str.length; i += step) {
    var code = step === 2 ? str.charCodeAt(i) * 256 + str.charCodeAt(i + 1) : str.charCodeAt(i);
    var uni = font.toUni && font.toUni[code] !== undefined ? font.toUni[code] : (font.twoByte ? '' : String.fromCharCode(code));
    var w = font.widths[code];
    out.push({ code: code, text: uni, width: (typeof w === 'number' ? w : font.dw) / 1000, space: !font.twoByte && code === 32 });
  }
  return out;
}

/* ---------- ページの中身を読み、文字の位置を集める ---------- */

function mulMatrix_(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
  ];
}

/** PDF の1ページ目までの文字を {text, x0, x1, y, size} の並びで返す */
function extractPdfTextRuns_(bytes) {
  var doc = new PdfDoc_(bytes instanceof Uint8Array ? bytes : toUint8_(bytes));
  var pages = doc.pages();
  var runs = [];
  pages.forEach(function (page, pageIndex) {
    var fontsDict = doc.resolve(page.resources.Font) || {};
    var fonts = {};
    var contents = doc.resolve(page.dict.Contents);
    var list = Array.isArray(contents) ? page.dict.Contents && doc.resolve(page.dict.Contents) : [page.dict.Contents];
    var text = '';
    (list || []).forEach(function (ref) {
      var o = ref && ref.ref !== undefined ? doc.get(ref.ref) : null;
      if (o && o.dict) text += bytesToLatin1_(doc.streamData(o)) + '\n';
    });
    interpretContent_(text, function (name) {
      if (!fonts[name]) fonts[name] = fontsDict[name] ? loadFont_(doc, fontsDict[name]) : { twoByte: false, toUni: null, widths: {}, dw: 500, first: 0 };
      return fonts[name];
    }, function (run) { run.page = pageIndex; runs.push(run); });
  });
  return runs;
}

function interpretContent_(content, getFont, emit) {
  var lx = new PdfLexer_(content, 0);
  var ops = [];
  var ctm = [1, 0, 0, 1, 0, 0];
  var stack = [];
  var tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
  var font = null, fs = 0, tc = 0, tw = 0, th = 1, tl = 0;

  function show(str) {
    if (!font) return;
    var glyphs = decodeGlyphs_(font, str);
    var start = mulMatrix_(tm, ctm);
    var text = '';
    glyphs.forEach(function (g) {
      text += g.text;
      var tx = (g.width * fs + tc + (g.space ? tw : 0)) * th;
      tm = mulMatrix_([1, 0, 0, 1, tx, 0], tm);
    });
    var end = mulMatrix_(tm, ctm);
    var scale = Math.sqrt(start[2] * start[2] + start[3] * start[3]);
    emit({ text: text, x0: start[4], x1: end[4], y: start[5], size: fs * scale });
  }
  function td(x, y) { tlm = mulMatrix_([1, 0, 0, 1, x, y], tlm); tm = tlm.slice(); }

  for (;;) {
    var t = lx.next();
    if (t.k === 'eof') break;
    if (t.k !== 'op') { ops.push(lx.value(t)); continue; }
    var a = ops;
    ops = [];
    switch (t.v) {
      case 'q': stack.push(ctm.slice()); break;
      case 'Q': if (stack.length) ctm = stack.pop(); break;
      case 'cm': if (a.length >= 6) ctm = mulMatrix_(a.slice(-6), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); break;
      case 'Tf': if (a.length >= 2 && a[a.length - 2] && a[a.length - 2].name !== undefined) { font = getFont(a[a.length - 2].name); fs = a[a.length - 1]; } break;
      case 'Tm': if (a.length >= 6) { tm = a.slice(-6); tlm = tm.slice(); } break;
      case 'Td': if (a.length >= 2) td(a[a.length - 2], a[a.length - 1]); break;
      case 'TD': if (a.length >= 2) { tl = -a[a.length - 1]; td(a[a.length - 2], a[a.length - 1]); } break;
      case 'T*': td(0, -tl); break;
      case 'TL': tl = a[a.length - 1]; break;
      case 'Tc': tc = a[a.length - 1]; break;
      case 'Tw': tw = a[a.length - 1]; break;
      case 'Tz': th = a[a.length - 1] / 100; break;
      case 'Tj': if (a.length && a[a.length - 1].str !== undefined) show(a[a.length - 1].str); break;
      case "'": td(0, -tl); if (a.length && a[a.length - 1].str !== undefined) show(a[a.length - 1].str); break;
      case '"':
        if (a.length >= 3) { tw = a[0]; tc = a[1]; td(0, -tl); if (a[2].str !== undefined) show(a[2].str); }
        break;
      case 'TJ':
        var arr = a[a.length - 1];
        if (!Array.isArray(arr) || !font) break;
        var start = mulMatrix_(tm, ctm);
        var all = '';
        arr.forEach(function (el) {
          if (el && el.str !== undefined) {
            decodeGlyphs_(font, el.str).forEach(function (g) {
              all += g.text;
              tm = mulMatrix_([1, 0, 0, 1, (g.width * fs + tc + (g.space ? tw : 0)) * th, 0], tm);
            });
          } else if (typeof el === 'number') {
            tm = mulMatrix_([1, 0, 0, 1, -el / 1000 * fs * th, 0], tm);
          }
        });
        var end = mulMatrix_(tm, ctm);
        var scale = Math.sqrt(start[2] * start[2] + start[3] * start[3]);
        emit({ text: all, x0: start[4], x1: end[4], y: start[5], size: fs * scale });
        break;
      case 'BI':
        var ei = content.indexOf('EI', lx.pos);
        lx.pos = ei < 0 ? content.length : ei + 2;
        break;
      default:
        break;
    }
  }
}

/* ---------- マス目の組み立て ---------- */

var WEEKDAY_CHARS = '日月火水木金土';

/** PDF のバイト列から、カレンダーのマス目ごとの予定を取り出す。マス目の形でなければ null */
function readCalendarGridFromPdf_(bytes) {
  var runs = extractPdfTextRuns_(bytes);
  return runs.length ? buildCalendarGrid_(runs) : null;
}

/**
 * 文字の位置からマス目を組み立てる。
 *  横の境目: 曜日の見出し「日〜土」の中心どうしの真ん中
 *  縦の境目: 各週の日付の数字の位置 ＋ その数字の文字の大きさ
 */
function buildCalendarGrid_(runs) {
  var items = [];
  runs.forEach(function (r) {
    var norm = normalizeText_(r.text).trim();
    if (norm) items.push({ text: String(r.text).normalize('NFC').trim(), norm: norm, x0: r.x0, x1: r.x1, y: r.y, size: r.size });
  });

  /** @type {any} */
  var header = null;
  groupByY_(items.filter(function (r) { return r.norm.length === 1 && WEEKDAY_CHARS.indexOf(r.norm) >= 0; }), 2)
    .forEach(function (g) {
      var byDay = {};
      g.forEach(function (r) { byDay[r.norm] = r; });
      var keys = Object.keys(byDay);
      if (keys.length !== 7 || (header && header.y >= g[0].y)) return;
      header = {
        y: g[0].y,
        cols: keys.map(function (k) { return { wd: WEEKDAY_CHARS.indexOf(k), cx: (byDay[k].x0 + byDay[k].x1) / 2 }; })
          .sort(function (a, b) { return a.cx - b.cx; })
      };
    });
  if (!header) return null;
  var cols = header.cols;
  function colOf(r) {
    var x = r.x0 + 1;
    for (var i = 0; i < cols.length - 1; i++) if (x < (cols[i].cx + cols[i + 1].cx) / 2) return i;
    return cols.length - 1;
  }

  var below = items.filter(function (r) { return r.y < header.y - 1; });
  var nums = below.filter(function (r) { return /^\d{1,2}$/.test(r.norm); });
  function topMost(list) { return list.reduce(function (a, b) { return !a || b.y > a.y ? b : a; }, null); }
  var one = topMost(nums.filter(function (r) { return Number(r.norm) === 1; }));
  if (!one) return null;
  var p1 = colOf(one);
  var days = [];
  for (var d = 1; d <= 31; d++) {
    var want = (p1 + d - 1) % 7;
    var hit = topMost(nums.filter(function (r) { return Number(r.norm) === d && colOf(r) === want; }));
    if (!hit) break;
    hit.isDay = true;
    days.push({ day: d, col: want, row: Math.floor((p1 + d - 1) / 7), run: hit, runs: [] });
  }
  if (days.length < 28) return null;

  var rowYs = [];
  days.forEach(function (c) { (rowYs[c.row] = rowYs[c.row] || []).push(c.run.y); });
  var rowY = rowYs.map(median_);
  for (var i = 0; i < days.length; i++) if (Math.abs(days[i].run.y - rowY[days[i].row]) > 3) return null;
  var gaps = [];
  for (i = 1; i < rowY.length; i++) {
    if (!(rowY[i] < rowY[i - 1])) return null;
    gaps.push(rowY[i - 1] - rowY[i]);
  }
  var rowHeight = median_(gaps);
  var numSize = median_(days.map(function (c) { return c.run.size; }));
  var last = rowY.length - 1;
  function top(r) { return r === 0 ? header.y - 1 : rowY[r] + numSize; }
  function bottom(r) { return r < last ? rowY[r + 1] + numSize : rowY[r] - rowHeight + numSize; }

  var cellAt = {};
  days.forEach(function (c) { cellAt[c.row + ':' + c.col] = c; });
  var noteRuns = [];
  below.forEach(function (r) {
    if (r.isDay) return;
    for (var row = 0; row <= last; row++) {
      if (r.y <= top(row) && r.y > bottom(row)) {
        var cell = cellAt[row + ':' + colOf(r)];
        if (cell) cell.runs.push(r); else noteRuns.push(r);
        return;
      }
    }
    noteRuns.push(r);
  });

  return {
    firstWeekday: cols[p1].wd,
    lastDay: days.length,
    title: linesOf_(items.filter(function (r) { return r.y > header.y + 1; })),
    cells: days.map(function (c) { return { day: c.day, lines: mergeContinuation_(linesOf_(c.runs)) }; }),
    notes: linesOf_(noteRuns)
  };
}

/** 同じ高さ（差が tol 以内）の文字をまとめる。上の行から順 */
function groupByY_(list, tol) {
  var sorted = list.slice().sort(function (a, b) { return b.y - a.y; });
  var groups = [];
  sorted.forEach(function (r) {
    var g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - r.y) <= tol) g.push(r); else groups.push([r]);
  });
  return groups;
}

/** 文字のかたまりを行にまとめ、上から順の文字列の配列にする */
function linesOf_(list) {
  return groupByY_(list, 2).map(function (g) {
    return g.sort(function (a, b) { return a.x0 - b.x0; }).map(function (r) { return r.text; }).join('').trim();
  }).filter(function (s) { return s !== ''; });
}

/** 「（ダンス）」「＆リトミック…」のような続きの行は前の行につなげる */
function mergeContinuation_(lines) {
  var out = [];
  lines.forEach(function (s) {
    if (out.length && /^[（(＆&]/.test(s)) out[out.length - 1] += s; else out.push(s);
  });
  return out;
}

function median_(arr) {
  var s = arr.slice().sort(function (a, b) { return a - b; });
  if (!s.length) return 0;
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
