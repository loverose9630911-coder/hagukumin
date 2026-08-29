# よく使う操作のまとめ
#
#   make serve   … 立ち上げる（http://localhost:8080）
#   make seed    … デモデータを入れる
#   make fresh   … データを消してから入れ直す
#   make test    … テストを走らせる
#   make browser … ブラウザでの動作確認（Playwright が入っていれば）
#   make lint    … PHP と JavaScript の構文チェック

.PHONY: serve seed fresh test browser lint clean

serve:
	bin/serve

seed:
	bin/seed

fresh:
	bin/seed --fresh

test:
	php tests/run.php

browser:
	node tests/browser.mjs

lint:
	@find src public tools tests -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null && echo "✓ PHP OK"
	@node tools/lint-js.mjs

clean:
	rm -f data/mikata.sqlite data/mikata.sqlite-wal data/mikata.sqlite-shm
