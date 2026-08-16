"""どうぶつツムツム ― ゲームエンジン（Python）.

盤面・物理・チェーン判定・スコア・スキルといったゲームのルールは
すべてこのパッケージが持っている（サーバー権威）。
PHP の Web アプリはここに問い合わせて結果を保存するだけで、
ブラウザは受け取った盤面を描くだけになる。
"""

__version__ = "1.0.0"

from . import board, characters, physics, rules, session, skills  # noqa: F401

__all__ = ["board", "characters", "physics", "rules", "session", "skills"]
