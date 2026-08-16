"""エンジンの HTTP API（標準ライブラリのみ）.

PHP の Web アプリからだけ呼ばれる想定なので 127.0.0.1 で待ち受ける。
セッションの実体はこのプロセスのメモリ上にあり、
クライアントは session_id しか知らない。
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Optional, Tuple

from . import board as board_mod
from . import characters, rules
from .session import GameSession

SESSION_TTL = 60 * 20      # 20 分さわられなければ捨てる
MAX_SESSIONS = 500


class SessionStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: Dict[str, Tuple[GameSession, float]] = {}

    def put(self, sess: GameSession) -> None:
        with self._lock:
            self._sweep_locked()
            if len(self._items) >= MAX_SESSIONS:
                oldest = min(self._items.items(), key=lambda kv: kv[1][1])[0]
                self._items.pop(oldest, None)
            self._items[sess.id] = (sess, time.monotonic())

    def get(self, session_id: str) -> Optional[GameSession]:
        with self._lock:
            item = self._items.get(session_id)
            if item is None:
                return None
            sess, _ = item
            self._items[session_id] = (sess, time.monotonic())
            return sess

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._items.pop(session_id, None)

    def _sweep_locked(self) -> None:
        now = time.monotonic()
        dead = [k for k, (_, t) in self._items.items() if now - t > SESSION_TTL]
        for k in dead:
            self._items.pop(k, None)

    def __len__(self) -> int:
        return len(self._items)


STORE = SessionStore()


class Handler(BaseHTTPRequestHandler):
    server_version = "HagukuminEngine/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------ 基本

    def log_message(self, fmt, *args):  # アクセスログは静かに
        if os.environ.get("ENGINE_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, payload: Dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def _session(self, data: Dict) -> Optional[GameSession]:
        return STORE.get(str(data.get("session_id") or ""))

    # ------------------------------------------------------------------ ルーティング

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/health"):
            self._send({"ok": True, "version": "1.0.0", "sessions": len(STORE)})
        elif self.path.startswith("/config"):
            self._send(build_config())
        else:
            self._send({"ok": False, "error": "not found"}, 404)

    def do_POST(self):  # noqa: N802
        data = self._read_json()
        path = self.path.split("?")[0].rstrip("/")

        if path == "/session/new":
            self._new_session(data)
            return

        sess = self._session(data)
        if sess is None:
            self._send({"ok": False, "error": "セッションが みつかりません",
                        "expired": True}, 404)
            return

        if path == "/session/start":
            sess.start()
            self._send({"ok": True, "state": sess.state()})
        elif path == "/session/state":
            sess.check_timeout()
            self._send({"ok": True, "state": sess.state()})
        elif path == "/session/chain":
            ids = [int(i) for i in (data.get("ids") or []) if str(i).lstrip("-").isdigit()]
            self._send(sess.act_chain(ids))
        elif path == "/session/bomb":
            self._send(sess.act_bomb(int(data.get("id") or 0)))
        elif path == "/session/skill":
            self._send(sess.act_skill())
        elif path == "/session/finish":
            result = sess.finish()
            STORE.drop(sess.id)
            self._send({"ok": True, "result": result, "state": sess.state()})
        else:
            self._send({"ok": False, "error": "not found"}, 404)

    # ------------------------------------------------------------------ 個別処理

    def _new_session(self, data: Dict) -> None:
        char_id = str(data.get("char_id") or characters.ICON_ID)
        if char_id not in characters.BY_ID:
            self._send({"ok": False, "error": "そのキャラは いません"}, 400)
            return
        try:
            level = int(data.get("level") or 0)
        except (TypeError, ValueError):
            level = 0
        try:
            height = float(data.get("height") or 1080)
        except (TypeError, ValueError):
            height = 1080.0

        sess = GameSession(char_id, level=level, height=height)
        STORE.put(sess)
        self._send({
            "ok": True,
            "session_id": sess.id,
            "deck": sess.deck,
            "board": sess.board.snapshot(),
            "field": {"w": board_mod.WIDTH, "h": sess.board.height},
            "skill": {
                "id": sess.char.skill.id,
                "name": sess.char.skill.name,
                "need": sess.skill_need,
            },
            "state": sess.state(),
        })


def build_config() -> Dict:
    """ブラウザと PHP が使うマスタデータ。"""
    return {
        "characters": characters.all_dicts(),
        "free_ids": characters.FREE_IDS,
        "icon_id": characters.ICON_ID,
        "exp_table": characters.EXP_TABLE,
        "max_level": characters.MAX_LEVEL,
        "rules": {
            "play_time": rules.PLAY_TIME,
            "max_time": rules.MAX_TIME,
            "combo_hold": rules.COMBO_HOLD,
            "fever_need": rules.FEVER_NEED,
            "fever_time": rules.FEVER_TIME,
            "bomb_chain": board_mod.BOMB_CHAIN,
            "time_bomb_chain": board_mod.TIME_BOMB_CHAIN,
            "time_bomb_bonus": rules.TIME_BOMB_BONUS,
        },
        "field": {
            "w": board_mod.WIDTH,
            "h_min": board_mod.HEIGHT_MIN,
            "h_max": board_mod.HEIGHT_MAX,
            "tsum_r": board_mod.TSUM_R,
            "big_r": board_mod.BIG_R,
            "chain_reach": board_mod.CHAIN_REACH,
        },
    }


def serve(host: str = "127.0.0.1", port: int = 8765, warm: bool = True) -> None:
    if warm:
        print("[engine] レイアウトを準備しています…", flush=True)
        board_mod.warm_cache()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"[engine] http://{host}:{port} で待機中", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    serve(port=int(os.environ.get("ENGINE_PORT", "8765")))
