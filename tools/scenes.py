# -*- coding: utf-8 -*-
"""scenes.py — 各サービス共通で使う「操作画面イラスト(注釈付き)」を生成する。

実画面は取得できないため、操作手順を再現したモックアップを描画し、
赤枠で操作対象を囲い、番号付き注釈と「実スクリーンショット差込欄」を併記する。
"""
import os
from genfig import (new_canvas, draw_window, sidebar, field, button, chips,
                    annot_box, callout, placeholder, font,
                    C_BG, C_INK, C_SUB, C_LINE, C_PANEL, C_HEADER, C_ACCENT,
                    C_ACCENT2, C_RED, C_AMBER, C_CHIP, C_OK)
from genfig import _text, _round, _wrap

FIGDIR = os.path.join(os.path.dirname(__file__), "..", "manuals", "figures")
os.makedirs(FIGDIR, exist_ok=True)


def _save(img, name):
    p = os.path.join(FIGDIR, name)
    img.save(p)
    return p


def _heading(d, W, text):
    _text(d, (30, 20), text, font(20), fill=C_HEADER, bold=True)
    d.line((30, 52, W - 30, 52), fill=C_LINE, width=1)


def scene_token(name, fig, title, panel_title, rows, annot_row, callouts, ph_caption):
    """SFA/CRM 管理画面でAPIトークン/接続アプリ/OAuthを発行する画面。
       rows: [(label, value), ...] 設定項目
       annot_row: 強調する行index(0始まり)
    """
    W, H = 1180, 600
    img, d = new_canvas(W, H)
    _heading(d, W, title)
    cb = draw_window(d, 30, 70, 700, 500, panel_title, kind="browser")
    x0, y0, x1, y1 = cb
    body = sidebar(d, cb, ["ダッシュボード", "設定", "API/連携", "ユーザー", "セキュリティ"], active=2)
    bx0, by0, bx1, by1 = body
    px = bx0 + 24
    _text(d, (px, by0 + 16), panel_title, font(16), fill=C_INK, bold=True)
    yy = by0 + 50
    fld_boxes = []
    for i, (lb, val) in enumerate(rows):
        fb = field(d, px, yy, bx1 - px - 30, lb, val, focus=(i == annot_row))
        fld_boxes.append(fb)
        yy += 64
    btn = button(d, px, yy + 4, "発行する / 保存", primary=True)
    # 注釈枠
    if annot_row is not None and annot_row < len(fld_boxes):
        annot_box(d, fld_boxes[annot_row], 1)
    annot_box(d, btn, 2)
    # 右側 注釈
    cx, cy = 760, 110
    for n, txt in callouts:
        cy = callout(d, cx, cy, n, txt, max_w=380) + 14
    placeholder(d, (760, max(cy, 330), 1150, 540), ph_caption)
    return _save(img, fig)


def scene_connector(name, fig, title, url, steps_text, ph_caption):
    """Claude(Web/アプリ)の「コネクタ/インテグレーション」追加画面(公式リモートMCP)。"""
    W, H = 1180, 600
    img, d = new_canvas(W, H)
    _heading(d, W, title)
    cb = draw_window(d, 30, 70, 700, 500, "Claude — 設定 > コネクタ", kind="app")
    x0, y0, x1, y1 = cb
    d.rectangle((x0, y0, x1, y1), fill=C_BG)
    _text(d, (x0 + 24, y0 + 18), "コネクタ (MCP)", font(16), fill=C_INK, bold=True)
    _text(d, (x0 + 24, y0 + 44), "外部ツールを追加して、会話から直接操作できます。",
          font(12), fill=C_SUB)
    # 既存コネクタ行
    row_y = y0 + 80
    for nm in [name, "Google Drive", "GitHub"]:
        _round(d, (x0 + 24, row_y, x1 - 24, row_y + 44), 8, fill=C_PANEL, outline=C_LINE)
        d.ellipse((x0 + 36, row_y + 12, x0 + 56, row_y + 32), fill=C_ACCENT2 if nm == name else C_LINE)
        _text(d, (x0 + 68, row_y + 13), nm, font(14), fill=C_INK, bold=(nm == name))
        st = "接続済み" if nm == name else "未接続"
        _text(d, (x1 - 110, row_y + 14), st, font(12),
              fill=C_OK if nm == name else C_SUB)
        row_y += 54
    # 追加ボタン
    addb = button(d, x0 + 24, row_y + 8, "+ カスタムコネクタを追加", primary=True, w=240)
    # URL入力欄(モーダル風)
    mx, my = x0 + 24, row_y + 56
    _round(d, (mx, my, x1 - 24, my + 90), 8, fill=(248, 250, 252), outline=C_LINE)
    ub = field(d, mx + 16, my + 12, x1 - 24 - mx - 32, "MCPサーバーURL", url)
    # 注釈
    annot_box(d, (x0 + 24, y0 + 80, x1 - 24, y0 + 80 + 44), 1)  # 接続済み行
    annot_box(d, addb, 2)
    annot_box(d, ub, 3)
    cx, cy = 760, 110
    for n, txt in steps_text:
        cy = callout(d, cx, cy, n, txt, max_w=380) + 12
    placeholder(d, (760, max(cy, 320), 1150, 540), ph_caption)
    return _save(img, fig)


def scene_config(name, fig, title, pkg, args, envs, ph_caption, extra_note=""):
    """claude_desktop_config.json にMCPサーバーを登録する画面(ローカル/カスタムMCP)。"""
    W, H = 1180, 620
    img, d = new_canvas(W, H)
    _heading(d, W, title)
    cb = draw_window(d, 30, 70, 700, 510, "claude_desktop_config.json", kind="app")
    x0, y0, x1, y1 = cb
    d.rectangle((x0, y0, x1, y1), fill=(30, 34, 45))
    key = name.lower().replace(" ", "-")
    lines = ['{', '  "mcpServers": {', f'    "{key}": {{',
             f'      "command": "{pkg}",',
             f'      "args": {args},',
             '      "env": {']
    env_items = list(envs.items())
    for i, (k, v) in enumerate(env_items):
        comma = "," if i < len(env_items) - 1 else ""
        lines.append(f'        "{k}": "{v}"{comma}')
    lines += ['      }', '    }', '  }', '}']
    yy = y0 + 14
    line_y = {}
    for idx, ln in enumerate(lines):
        line_y[idx] = yy
        _text(d, (x0 + 16, yy), ln, font(14), fill=(220, 223, 228))
        yy += 23
    # 注釈: command/args 行 と env ブロック
    annot_box(d, (x0 + 30, line_y[3] - 2, x0 + 430, line_y[4] + 20), 1)
    env_start = line_y[5]
    env_end = line_y[5 + len(env_items)] + 18
    annot_box(d, (x0 + 30, env_start - 2, x1 - 30, env_end), 2)
    cx, cy = 760, 110
    cy = callout(d, cx, cy, 1, "起動コマンドと引数。npx 等でMCPサーバーを取得・起動します。", max_w=380) + 12
    cy = callout(d, cx, cy, 2, "接続先URL・APIトークン等を環境変数で設定。秘匿情報は厳重に管理。", max_w=380) + 12
    if extra_note:
        cy = callout(d, cx, cy, 3, extra_note, max_w=380, color=C_AMBER) + 12
    placeholder(d, (760, max(cy, 360), 1150, 560), ph_caption)
    return _save(img, fig)


def scene_zapier(name, fig, title, ph_caption):
    """Zapier(iPaaS)のMCP/連携設定画面。"""
    W, H = 1180, 600
    img, d = new_canvas(W, H)
    _heading(d, W, title)
    cb = draw_window(d, 30, 70, 700, 500, "https://zapier.com/app/mcp", kind="browser")
    x0, y0, x1, y1 = cb
    d.rectangle((x0, y0, x1, y1), fill=C_BG)
    _text(d, (x0 + 24, y0 + 18), "Zapier MCP — 公開アクションの設定", font(16), fill=C_INK, bold=True)
    _text(d, (x0 + 24, y0 + 46), "ClaudeへこのMCPエンドポイントを登録すると、下記アクションを呼び出せます。",
          font(12), fill=C_SUB)
    # MCPエンドポイント欄
    eb = field(d, x0 + 24, y0 + 72, x1 - x0 - 48, "MCP Server URL",
               "https://mcp.zapier.com/api/mcp/s/****/")
    # アクション一覧
    ay = y0 + 150
    _text(d, (x0 + 24, ay - 8), "有効化するアクション", font(13), fill=C_INK, bold=True)
    acts = [f"{name}: レコード検索", f"{name}: レコード作成",
            f"{name}: レコード更新", f"{name}: 活動/メモ追加"]
    first = None
    for i, a in enumerate(acts):
        ry = ay + 18 + i * 40
        _round(d, (x0 + 24, ry, x1 - 24, ry + 32), 6, fill=C_PANEL, outline=C_LINE)
        # トグル
        _round(d, (x1 - 70, ry + 7, x1 - 38, ry + 25), 9, fill=C_OK)
        d.ellipse((x1 - 54, ry + 8, x1 - 38, ry + 24), fill=C_BG)
        _text(d, (x0 + 38, ry + 7), a, font(13), fill=C_INK)
        if i == 0:
            first = (x0 + 24, ry, x1 - 24, ry + 32)
    annot_box(d, eb, 1)
    if first:
        annot_box(d, first, 2)
    cx, cy = 760, 110
    cy = callout(d, cx, cy, 1, "このMCPサーバーURLをClaudeのコネクタに登録します(公式リモートMCPと同様)。", max_w=380) + 12
    cy = callout(d, cx, cy, 2, "Claudeに許可する操作をアクション単位でON/OFF。最小権限で有効化します。", max_w=380) + 12
    placeholder(d, (760, max(cy, 320), 1150, 540), ph_caption)
    return _save(img, fig)


def scene_chat(name, fig, title, prompt, tool_call, reply_lines, ph_caption):
    """Claudeのチャットで実際に操作・活用する例。"""
    W, H = 1180, 620
    img, d = new_canvas(W, H)
    _heading(d, W, title)
    cb = draw_window(d, 30, 70, 700, 520, f"Claude — {name} 連携", kind="app")
    x0, y0, x1, y1 = cb
    d.rectangle((x0, y0, x1, y1), fill=(247, 248, 250))
    # ユーザー吹き出し
    uy = y0 + 16
    uw = x1 - x0 - 140
    ulines = _wrap(d, prompt, font(14), uw - 24)
    uh = 16 + len(ulines) * 20
    _round(d, (x0 + 120, uy, x1 - 20, uy + uh), 10, fill=(219, 234, 254))
    _text(d, (x0 + 130, uy - 18), "あなた", font(11), fill=C_SUB)
    ty = uy + 9
    for ln in ulines:
        _text(d, (x0 + 132, ty), ln, font(14), fill=C_INK); ty += 20
    # ツール呼び出しインジケータ
    ty2 = uy + uh + 26
    _round(d, (x0 + 20, ty2, x0 + 360, ty2 + 28), 6, fill=(236, 253, 245), outline=C_ACCENT2)
    _text(d, (x0 + 30, ty2 + 6), f"■ MCPツール呼び出し: {tool_call}", font(12), fill=C_ACCENT2)
    tool_box = (x0 + 20, ty2, x0 + 360, ty2 + 28)
    # アシスタント吹き出し
    ay = ty2 + 52
    aw = x1 - x0 - 140
    alines = []
    for rl in reply_lines:
        alines += _wrap(d, rl, font(14), aw - 24)
    ah = 16 + len(alines) * 20
    _round(d, (x0 + 20, ay, x0 + 20 + aw, ay + ah), 10, fill=C_BG, outline=C_LINE)
    _text(d, (x0 + 22, ay - 18), "Claude", font(11), fill=C_ACCENT2)
    ty = ay + 9
    for ln in alines:
        _text(d, (x0 + 32, ty), ln, font(14), fill=C_INK); ty += 20
    annot_box(d, tool_box, 1)
    annot_box(d, (x0 + 20, ay, x0 + 20 + aw, ay + ah), 2, color=C_ACCENT2)
    cx, cy = 760, 110
    cy = callout(d, cx, cy, 1, "Claudeが自動でMCPツールを選び、SFAのデータを取得/更新します。", max_w=380) + 12
    cy = callout(d, cx, cy, 2, "取得結果を要約・整形して回答。続けて指示すれば追加操作も可能です。",
                 max_w=380, color=C_ACCENT2) + 12
    placeholder(d, (760, max(cy, 330), 1150, 560), ph_caption)
    return _save(img, fig)
