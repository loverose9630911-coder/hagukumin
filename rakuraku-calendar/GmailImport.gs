/**
 * 【任意】らくらく連絡帳から Gmail に PDF 付きのメールが届く場合だけ追加するファイル。
 *
 * 使い方:
 *   1. このファイルをスクリプトに追加する
 *   2. Code.gs の CONFIG.GMAIL_SENDER に送信元のメールアドレスを入れる
 *   3. setup をもう一度実行して、Gmail の許可を出す
 *
 * 送信元のメールに付いた「〇〇カレンダー.pdf」を Drive フォルダへ自動で保存します。
 * 保存後の処理（読み取り・登録・通知）は Drive に手で入れた場合と同じです。
 */
var PROP_IMPORTED = 'importedAttachments';

function importFromGmail_(folder) {
  var query = 'from:' + CONFIG.GMAIL_SENDER + ' has:attachment filename:pdf newer_than:' + CONFIG.GMAIL_LOOKBACK_DAYS + 'd';
  var imported = loadJson_(PROP_IMPORTED, {});
  var count = 0;
  GmailApp.search(query, 0, 20).forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      msg.getAttachments().forEach(function (att, i) {
        var name = normalizeText_(att.getName());
        if (!CONFIG.FILE_PATTERN.test(name)) return;
        var key = msg.getId() + ':' + i;
        if (imported[key]) return;
        folder.createFile(att.copyBlob()).setName(name);
        imported[key] = new Date().toISOString();
        count++;
      });
    });
  });
  if (count) saveJson_(PROP_IMPORTED, pruneImported_(imported));
  return count;
}

function pruneImported_(imported) {
  var limit = Date.now() - 400 * 24 * 60 * 60 * 1000;
  var out = {};
  Object.keys(imported).forEach(function (k) {
    if (!(Date.parse(imported[k]) < limit)) out[k] = imported[k];
  });
  return out;
}
