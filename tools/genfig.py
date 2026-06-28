# -*- coding: utf-8 -*-
"""
genfig.py — マニュアル用の図版(PNG)を生成する共通ライブラリ。

提供する図版:
  - draw_window()    : アプリ/ブラウザ画面を模したモックアップ(操作画面イラスト)
  - annot_box()      : 操作対象を赤枠で囲い、番号バッジを付ける注釈
  - callout()        : 番号付きの吹き出し注釈
  - placeholder()    : 「実スクリーンショット差込欄」(破線枠)
  - arch_diagram()   : Claude × MCP × SFA の連携構成図
  - flow_diagram()   : 手順フロー図

実画面はネットワーク制限・ログイン要件のため取得できないため、本ライブラリは
操作手順を再現した「イラスト(モックアップ)」を生成する。実画面は別途、各図版内の
破線「差込欄」へ貼り付ける運用を想定している。
"""
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"

# 配色(落ち着いたビジネス系)
C_BG      = (255, 255, 255)
C_INK     = (33, 37, 41)
C_SUB     = (108, 117, 125)
C_LINE    = (206, 212, 218)
C_PANEL   = (248, 249, 250)
C_HEADER  = (45, 55, 72)
C_ACCENT  = (37, 99, 235)     # 青(主要アクション)
C_ACCENT2 = (13, 148, 136)    # 緑(MCP)
C_RED     = (220, 38, 38)     # 注釈枠
C_AMBER   = (217, 119, 6)
C_CHIP    = (224, 231, 255)
C_OK      = (22, 163, 74)


def font(size, bold=False):
    # IPAGothic に bold は無いので、描画側でstroke_widthで擬似ボールド化する
    return ImageFont.truetype(FONT_PATH, size)


def _text(d, xy, s, f, fill=C_INK, bold=False, anchor=None):
    sw = 0
    # 擬似ボールド
    kw = {}
    if anchor:
        kw["anchor"] = anchor
    if bold:
        kw["stroke_width"] = 0
        d.text(xy, s, font=f, fill=fill, **kw)
        d.text((xy[0] + 0.6, xy[1]), s, font=f, fill=fill, **kw)
    else:
        d.text(xy, s, font=f, fill=fill, **kw)


def _wrap(d, s, f, max_w):
    """日本語向けの簡易折返し(文字単位)。"""
    lines = []
    for para in s.split("\n"):
        cur = ""
        for ch in para:
            if d.textlength(cur + ch, font=f) <= max_w:
                cur += ch
            else:
                lines.append(cur)
                cur = ch
        lines.append(cur)
    return lines


def _round(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def new_canvas(w, h, bg=C_BG):
    img = Image.new("RGB", (w, h), bg)
    return img, ImageDraw.Draw(img)


# ----------------------------------------------------------------------------
# 画面モックアップ
# ----------------------------------------------------------------------------
def draw_window(d, x, y, w, h, title, kind="app"):
    """アプリ/ブラウザ風のウィンドウ枠を描く。中身は呼び出し側で描画する。"""
    _round(d, (x, y, x + w, y + h), 10, fill=C_BG, outline=C_LINE, width=2)
    # タイトルバー
    bar_h = 34
    _round(d, (x, y, x + w, y + bar_h + 8), 10, fill=C_PANEL)
    d.rectangle((x, y + bar_h - 6, x + w, y + bar_h + 2), fill=C_PANEL)
    d.line((x, y + bar_h + 2, x + w, y + bar_h + 2), fill=C_LINE, width=1)
    # 信号機ボタン
    for i, col in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = x + 16 + i * 16
        d.ellipse((cx, y + 12, cx + 10, y + 22), fill=col)
    f = font(15)
    if kind == "browser":
        # アドレスバー
        ax = x + 70
        _round(d, (ax, y + 8, x + w - 16, y + bar_h - 2), 8, fill=C_BG, outline=C_LINE)
        _text(d, (ax + 10, y + 11), title, font(13), fill=C_SUB)
    else:
        _text(d, (x + 70, y + 9), title, f, fill=C_HEADER, bold=True)
    return (x, y + bar_h + 3, x + w, y + h)  # content box


def sidebar(d, box, items, active=0):
    x0, y0, x1, y1 = box
    sw = 150
    d.rectangle((x0, y0, x0 + sw, y1), fill=C_HEADER)
    f = font(13)
    yy = y0 + 14
    for i, it in enumerate(items):
        if i == active:
            _round(d, (x0 + 6, yy - 3, x0 + sw - 6, yy + 20), 6, fill=C_ACCENT)
        _text(d, (x0 + 16, yy), it, f, fill=(255, 255, 255))
        yy += 30
    return (x0 + sw, y0, x1, y1)


def field(d, x, y, w, label, value="", h=30, focus=False):
    f1 = font(12); f2 = font(13)
    _text(d, (x, y), label, f1, fill=C_SUB)
    oy = y + 17
    _round(d, (x, oy, x + w, oy + h), 6, fill=C_BG,
           outline=C_ACCENT if focus else C_LINE, width=2 if focus else 1)
    if value:
        _text(d, (x + 8, oy + h / 2 - 8), value, f2, fill=C_INK)
    return (x, oy, x + w, oy + h)


def button(d, x, y, label, primary=True, w=None):
    f = font(13)
    pad = 14
    tw = d.textlength(label, font=f)
    bw = w or (tw + pad * 2)
    h = 30
    col = C_ACCENT if primary else C_PANEL
    _round(d, (x, y, x + bw, y + h), 6, fill=col,
           outline=None if primary else C_LINE, width=1)
    _text(d, (x + (bw - tw) / 2, y + 7), label, f,
          fill=(255, 255, 255) if primary else C_INK, bold=primary)
    return (x, y, x + bw, y + h)


def chips(d, x, y, labels, color=C_CHIP, tcol=C_ACCENT):
    f = font(12)
    cx = x
    for lb in labels:
        tw = d.textlength(lb, font=f)
        _round(d, (cx, y, cx + tw + 18, y + 22), 11, fill=color)
        _text(d, (cx + 9, y + 4), lb, f, fill=tcol)
        cx += tw + 28
    return cx


# ----------------------------------------------------------------------------
# 注釈(枠囲い・吹き出し・差込欄)
# ----------------------------------------------------------------------------
def annot_box(d, box, n=None, color=C_RED):
    """操作対象を赤枠で囲い、左上に番号バッジを付ける。"""
    x0, y0, x1, y1 = box
    _round(d, (x0 - 4, y0 - 4, x1 + 4, y1 + 4), 8, outline=color, width=3)
    if n is not None:
        r = 13
        d.ellipse((x0 - 4 - r, y0 - 4 - r, x0 - 4 + r, y0 - 4 + r), fill=color)
        _text(d, (x0 - 4, y0 - 4 - 9), str(n), font(15),
              fill=(255, 255, 255), bold=True, anchor="mm")


def callout(d, x, y, n, text, color=C_RED, max_w=300):
    """番号バッジ + 注釈文。手順説明の引き出しに使う。"""
    r = 13
    d.ellipse((x, y, x + 2 * r, y + 2 * r), fill=color)
    _text(d, (x + r, y + r), str(n), font(15), fill=(255, 255, 255), bold=True, anchor="mm")
    f = font(14)
    lines = _wrap(d, text, f, max_w)
    ty = y - 2
    for ln in lines:
        _text(d, (x + 2 * r + 10, ty), ln, f, fill=C_INK)
        ty += 19
    return ty


def placeholder(d, box, caption):
    """実スクリーンショット差込欄(破線枠)。"""
    x0, y0, x1, y1 = box
    # 破線枠
    dash = 9
    col = C_AMBER
    for xx in range(int(x0), int(x1), dash * 2):
        d.line((xx, y0, min(xx + dash, x1), y0), fill=col, width=2)
        d.line((xx, y1, min(xx + dash, x1), y1), fill=col, width=2)
    for yy in range(int(y0), int(y1), dash * 2):
        d.line((x0, yy, x0, min(yy + dash, y1)), fill=col, width=2)
        d.line((x1, yy, x1, min(yy + dash, y1)), fill=col, width=2)
    _round(d, (x0, y0, x1, y1), 4, fill=(255, 251, 235))
    # 再描画(塗りで破線が隠れるため枠を上書き)
    for xx in range(int(x0), int(x1), dash * 2):
        d.line((xx, y0, min(xx + dash, x1), y0), fill=col, width=2)
        d.line((xx, y1, min(xx + dash, x1), y1), fill=col, width=2)
    for yy in range(int(y0), int(y1), dash * 2):
        d.line((x0, yy, x0, min(yy + dash, y1)), fill=col, width=2)
        d.line((x1, yy, x1, min(yy + dash, y1)), fill=col, width=2)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    _text(d, (cx, cy - 22), "［ 実スクリーンショット差込欄 ］", font(16), fill=C_AMBER,
          bold=True, anchor="mm")
    lines = _wrap(d, caption, font(13), x1 - x0 - 30)
    ty = cy
    for ln in lines:
        _text(d, (cx, ty), ln, font(13), fill=C_SUB, anchor="mm")
        ty += 18


# ----------------------------------------------------------------------------
# 構成図・フロー図
# ----------------------------------------------------------------------------
def _node(d, x, y, w, h, title, sub="", fill=C_PANEL, tcol=C_INK, outline=C_LINE):
    _round(d, (x, y, x + w, y + h), 10, fill=fill, outline=outline, width=2)
    _text(d, (x + w / 2, y + (18 if sub else h / 2)), title, font(16),
          fill=tcol, bold=True, anchor="mm")
    if sub:
        for i, ln in enumerate(_wrap(d, sub, font(12), w - 16)):
            _text(d, (x + w / 2, y + 40 + i * 16), ln, font(12), fill=C_SUB, anchor="mm")
    return (x, y, x + w, y + h)


def _arrow(d, p0, p1, color=C_SUB, label="", two=True):
    d.line((p0[0], p0[1], p1[0], p1[1]), fill=color, width=3)
    # 矢じり
    import math
    for end, start in ([(p1, p0)] + ([(p0, p1)] if two else [])):
        ang = math.atan2(end[1] - start[1], end[0] - start[0])
        L = 11
        for da in (-0.4, 0.4):
            d.line((end[0], end[1],
                    end[0] - L * math.cos(ang - da),
                    end[1] - L * math.sin(ang - da)), fill=color, width=3)
    if label:
        mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
        f = font(12)
        tw = d.textlength(label, font=f)
        _round(d, (mx - tw / 2 - 6, my - 24, mx + tw / 2 + 6, my - 4), 6,
               fill=(255, 255, 255), outline=C_LINE)
        _text(d, (mx, my - 14), label, f, fill=C_SUB, anchor="mm")


def arch_diagram(path, tool_name, mode="official", note=""):
    """Claude × MCP × SFA の連携構成図を描く。
       mode: 'official'(公式MCP) / 'ipaas'(Zapier等) / 'custom'(API+自作MCP)
    """
    W, H = 1180, 460
    img, d = new_canvas(W, H)
    _text(d, (30, 24), f"図: {tool_name} と Claude の連携構成", font(20), fill=C_HEADER, bold=True)
    d.line((30, 56, W - 30, 56), fill=C_LINE, width=1)

    y = 150
    nw, nh = 230, 120
    # Claude
    _node(d, 40, y, nw, nh, "Claude", "Claude Desktop /\nClaude(Web・アプリ)",
          fill=(238, 242, 255), tcol=C_ACCENT, outline=C_ACCENT)

    if mode == "official":
        mid_title = "公式 MCP サーバー"
        mid_sub = f"{tool_name} 提供\n(認証・権限はサービス側で制御)"
        mid_fill = (236, 253, 245); mid_t = C_ACCENT2; mid_o = C_ACCENT2
        a1 = "MCP (Model Context Protocol)"
    elif mode == "ipaas":
        mid_title = "iPaaS (Zapier / Make)"
        mid_sub = "MCP サーバー機能 +\n各SFAコネクタ"
        mid_fill = (255, 247, 237); mid_t = C_AMBER; mid_o = C_AMBER
        a1 = "MCP"
    else:
        mid_title = "カスタム MCP サーバー"
        mid_sub = "自作/OSS\n(REST API をMCP化)"
        mid_fill = (243, 244, 246); mid_t = C_INK; mid_o = C_SUB
        a1 = "MCP (stdio / HTTP)"

    mx = (W - nw) / 2
    _node(d, mx, y, nw, nh, mid_title, mid_sub, fill=mid_fill, tcol=mid_t, outline=mid_o)
    # SFA
    _node(d, W - 40 - nw, y, nw, nh, tool_name, "SFA / CRM 本体\n(顧客・案件・活動データ)",
          fill=C_PANEL, tcol=C_INK)

    _arrow(d, (40 + nw, y + nh / 2), (mx, y + nh / 2), color=C_ACCENT, label=a1)
    a2 = "REST API / OAuth" if mode != "official" else "サービス内部連携"
    _arrow(d, (mx + nw, y + nh / 2), (W - 40 - nw, y + nh / 2), color=mid_o, label=a2)

    # 凡例/注記
    ny = y + nh + 40
    _text(d, (40, ny), "● データの流れ: 自然言語の指示 → MCPがツール呼び出し → SFAのデータを取得/更新 → 回答",
          font(13), fill=C_SUB)
    if note:
        for i, ln in enumerate(_wrap(d, "※ " + note, font(13), W - 80)):
            _text(d, (40, ny + 24 + i * 18), ln, font(13), fill=C_SUB)
    img.save(path)
    return path


def flow_diagram(path, title, steps):
    """横並びの手順フロー図。steps: [(見出し, 補足), ...]"""
    n = len(steps)
    W = 1180
    bw = (W - 60 - (n - 1) * 40) / n
    bh = 110
    H = 90 + bh + 40
    img, d = new_canvas(W, H)
    _text(d, (30, 24), title, font(20), fill=C_HEADER, bold=True)
    d.line((30, 56, W - 30, 56), fill=C_LINE, width=1)
    y = 90
    for i, (h, s) in enumerate(steps):
        x = 30 + i * (bw + 40)
        _round(d, (x, y, x + bw, y + bh), 10, fill=C_PANEL, outline=C_LINE, width=2)
        # 番号バッジ
        d.ellipse((x + 12, y + 12, x + 38, y + 38), fill=C_ACCENT)
        _text(d, (x + 25, y + 25), str(i + 1), font(16), fill=(255, 255, 255), bold=True, anchor="mm")
        _text(d, (x + 48, y + 16), h, font(15), fill=C_INK, bold=True)
        for j, ln in enumerate(_wrap(d, s, font(12), bw - 24)):
            _text(d, (x + 12, y + 50 + j * 16), ln, font(12), fill=C_SUB)
        if i < n - 1:
            ax = x + bw + 8
            _arrow(d, (ax, y + bh / 2), (ax + 24, y + bh / 2), color=C_ACCENT, two=False)
    img.save(path)
    return path


if __name__ == "__main__":
    # 動作確認用
    arch_diagram("/tmp/_t_arch.png", "kintone", "official", "公式MCPサーバーはStandard以上が前提。")
    flow_diagram("/tmp/_t_flow.png", "連携フロー", [("準備", "アカウント/トークン"), ("設定", "MCP登録"), ("利用", "自然言語で操作")])
    print("ok")
