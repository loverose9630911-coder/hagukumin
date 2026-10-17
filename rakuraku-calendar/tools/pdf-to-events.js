#!/usr/bin/env node
/**
 * カレンダーの PDF を読み、登録する予定の一覧を JSON で出す（Claude のルーティーン用）。
 * 読み取りは Code.gs と同じ処理を使う。Google には接続しない。
 *
 * 使い方:
 *   node rakuraku-calendar/tools/pdf-to-events.js --pdf 10月カレンダー.pdf \
 *     [--name 10月カレンダー.pdf] [--file-id DriveのファイルID] [--ref 2026-09-30] [--from 2026-10-18]
 *   --pdf     PDF のファイル。--base64 にすると、base64 の文字が入ったファイルを読む
 *   --name    元のファイル名（何月かを決めるのに使う）。省略時は --pdf のファイル名
 *   --ref     年の判断の基準日（PDF を受け取った日）。省略時は今日
 *   --from    この日より前の予定は出さない（過去の予定を登録しないため）。省略時は全部
 *
 * 出力（標準出力）:
 *   {"ok":true,"year":2026,"month":10,"events":[{"date":"2026-10-19","title":"...","description":"...","reminderMinutes":420}],
 *    "skippedPast":13,"notes":["＊..."]}
 *   失敗時は {"ok":false,"error":"理由"}。終了コードは 0（成功）/ 1（失敗）
 */
'use strict';
process.env.TZ = 'Asia/Tokyo';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z0-9-]+)$/.exec(argv[i]);
    if (m) { out[m[1]] = argv[i + 1]; i++; }
  }
  return out;
}

function parseDate(s, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) throw new Error(label + ' は YYYY-MM-DD で指定してください: ' + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ymd(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pdf && !args.base64) throw new Error('--pdf か --base64 を指定してください');
  const bytes = args.pdf
    ? fs.readFileSync(args.pdf)
    : Buffer.from(fs.readFileSync(args.base64, 'utf8').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  const name = (args.name || path.basename(args.pdf || args.base64)).normalize('NFKC');
  const ref = args.ref ? parseDate(args.ref, '--ref') : new Date();
  const from = args.from ? parseDate(args.from, '--from') : null;

  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  if (!ctx.CONFIG.FILE_PATTERN.test(name)) throw new Error('対象のファイル名ではありません（「〇〇カレンダー.pdf」の形）: ' + name);
  const grid = ctx.readCalendarGridFromPdf_(new Uint8Array(bytes));
  if (!grid) throw new Error('マス目のカレンダーとして読めませんでした（画像だけの PDF などは、この方法では読めません）');
  const ym = ctx.resolveYearMonth_(name, grid.title.join('\n'), ref);
  ctx.checkGridMatchesMonth_(grid, ym.year, ym.month);
  const minutes = ctx.reminderMinutesForAllDay_(ctx.CONFIG.NOTIFY_HOUR);

  let skippedPast = 0;
  const events = [];
  ctx.gridToEvents_(grid, ym.year, ym.month).forEach((ev) => {
    if (from && new Date(ev.year, ev.month - 1, ev.day) < from) { skippedPast++; return; }
    events.push({
      date: ymd(ev.year, ev.month, ev.day),
      title: ev.title,
      description: ev.lines.join('\n') + '\n\nらくらく連絡帳「' + name + '」から自動登録' + (args['file-id'] ? '（' + args['file-id'] + '）' : ''),
      reminderMinutes: minutes,
    });
  });
  return { ok: true, year: ym.year, month: ym.month, events, skippedPast, notes: Array.from(grid.notes) };
}

try {
  process.stdout.write(JSON.stringify(main(), null, 1) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) + '\n');
  process.exit(1);
}
