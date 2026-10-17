/**
 * らくらく連絡帳の「〇〇カレンダー.pdf」→ Googleカレンダー 自動登録
 *
 * 動かすアカウント : com.bur.bura の Google アカウント
 *                    （このスクリプトを作ったアカウントのカレンダーに登録されます）
 * 流れ             : Driveフォルダ「らくらく連絡帳カレンダー」に PDF が入る
 *                    → 15分ごとの自動チェックで PDF の文字を読み取る（Drive の OCR）
 *                    → 「5日(土) 運動会」のような行を予定として終日登録
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
  var text = extractText_(file.getBlob(), name);
  var ym = resolveYearMonth_(name, text, file.getDateCreated());
  var events = parseEvents_(text, ym.year, ym.month);
  var cal = getCalendar_();
  var created = [];
  var skipped = [];
  events.forEach(function (ev) {
    var r = registerEvent_(cal, ev, name, file.getId());
    (r.status === 'created' ? created : skipped).push(r);
  });
  return { fileName: name, year: ym.year, month: ym.month, created: created, skipped: skipped, text: text, error: '' };
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
    description: 'らくらく連絡帳「' + sourceName + '」から自動登録'
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
  lines.push('登録: ' + r.created.length + '件 / 登録済みのため省略: ' + r.skipped.length + '件');
  r.created.forEach(function (c) { lines.push('  ＋ ' + c.label); });
  r.skipped.forEach(function (s) { lines.push('  ＝ ' + s.label + '（' + s.reason + '）'); });
  if (!r.created.length && !r.skipped.length) {
    lines.push('予定を1件も読み取れませんでした。下の「読み取った文字」を Claude に送ると、読み取り方を合わせられます。');
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
