# よく使う操作のまとめ
#
#   make serve   … 立ち上げる（http://localhost:8090）
#   make seed    … デモデータを入れる
#   make fresh   … データを消してから入れ直す
#   make test    … テストを走らせる（PHP と JavaScript の両方）
#   make browser … ブラウザでの動作確認（Playwright が入っていれば）
#   make lint    … PHP と JavaScript の構文チェック
#   make icons   … アイコンを作り直す
#   make shots   … README に載せる画面写真を撮り直す

.PHONY: serve seed fresh test test-php test-js browser lint icons shots clean

serve:
	bin/serve

seed:
	bin/seed

fresh:
	bin/seed --fresh

test: test-php test-js

test-php:
	php tests/run.php

test-js:
	node tests/editor.mjs

browser:
	node tests/browser.mjs

lint:
	@find src public tools tests -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null && echo "✓ PHP OK"
	@node tools/lint-js.mjs

icons:
	node tools/render-icons.mjs

shots:
	node tools/shots.mjs

clean:
	rm -f data/canter.sqlite data/canter.sqlite-wal data/canter.sqlite-shm
	rm -rf data/uploads
