#!/usr/bin/env python3
"""キャラ定義とルールを JSON に書き出す.

PHP（画面・ショップ）とブラウザ（描画）は、この JSON だけを見る。
キャラを増やしたいときは characters.py を直して、これを実行すれば全部に反映される。

    python3 engine/export_config.py
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from doubutsu.server import build_config  # noqa: E402

OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "assets", "config.json",
)


def main() -> int:
    config = build_config()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"書き出しました: {OUT}")
    print(f"  キャラクター {len(config['characters'])} 体 / "
          f"アイコン: {config['icon_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
