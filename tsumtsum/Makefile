# ぞうさんとなかまたち

.PHONY: help setup assets serve static test sim clean

help:
	@echo "make setup   キャラ定義の書き出しと画像の生成"
	@echo "make serve   エンジン(Python)と Web アプリ(PHP)を起動"
	@echo "make test    エンジンのテスト"
	@echo "make sim     自動プレイでバランスを確認"
	@echo "make assets  キャラ画像とアプリアイコンを描きなおす"
	@echo "make static  iPad 用の静的サイト(dist/)を書き出す"

setup: assets

assets:
	python3 engine/export_config.py
	php tools/render_assets.php

serve:
	bin/serve

# Netlify に置く用（オフラインで遊べる PWA）
static: assets
	php tools/build_static.php

test:
	python3 -m unittest discover -s engine/tests -t engine -v

sim:
	python3 engine/simulate.py

clean:
	rm -rf engine/.cache engine/zousan/__pycache__ engine/tests/__pycache__ data
