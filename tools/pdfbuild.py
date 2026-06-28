# -*- coding: utf-8 -*-
"""pdfbuild.py — content.py のデータと manuals/figures の図版から PDF を生成する。

build.py(Word + 図版生成)を実行した後に実行すること。
LibreOffice が本環境で動作しないため、ReportLab で直接 PDF を組版する。
"""
import os
from PIL import Image as PILImage

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Image,
                                Table, TableStyle, PageBreak)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from content import COMMON, OVERVIEW_TABLE, SERVICES, DISCLAIMER

FONT_PATH = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"
pdfmetrics.registerFont(TTFont("JP", FONT_PATH))
pdfmetrics.registerFont(TTFont("JPB", FONT_PATH))
pdfmetrics.registerFontFamily("JP", normal="JP", bold="JPB", italic="JP", boldItalic="JPB")

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "manuals")
FIG = os.path.join(OUT, "figures")

ACCENT = HexColor("#255FB5")
HEADER = HexColor("#2D3748")
GREY = HexColor("#6C757D")
INK = HexColor("#212529")

CONTENT_W = 21.0 * cm - 2 * 2.2 * cm   # ≒ 16.6cm

# ----------------------------------------------------------------- styles
def S(name, size=10.5, leading=None, color=INK, bold=False, align=TA_LEFT,
      space_after=6, space_before=0, left=0):
    return ParagraphStyle(
        name, fontName="JPB" if bold else "JP", fontSize=size,
        leading=leading or size * 1.45, textColor=color, alignment=align,
        spaceAfter=space_after, spaceBefore=space_before, leftIndent=left,
        wordWrap="CJK")

ST = {
    "body": S("body"),
    "bullet": S("bullet", left=12),
    "cap": S("cap", 9, color=GREY, align=TA_CENTER, space_after=10),
    "h2": S("h2", 12, color=ACCENT, bold=True, space_before=8, space_after=4),
    "cover_t": S("ct", 22, color=HEADER, bold=True, align=TA_CENTER, space_after=6),
    "cover_s": S("cs", 12.5, color=GREY, align=TA_CENTER, space_after=16),
    "cover_k": S("ck", 13, color=ACCENT, bold=True, align=TA_CENTER, space_after=6),
    "cover_top": S("ctop", 13, color=ACCENT, bold=True, align=TA_CENTER, space_after=4),
    "code": S("code", 8.8, leading=12.5, color=HexColor("#DCDFE4")),
    "box_t": S("boxt", 10.5, bold=True, space_after=3),
    "box_b": S("boxb", 10, space_after=2),
    "ph_t": S("pht", 10.5, color=HexColor("#D97706"), bold=True, align=TA_CENTER, space_after=2),
    "ph_b": S("phb", 9.5, color=GREY, align=TA_CENTER),
    "ref": S("ref", 10, left=12),
    "tbl_h": S("tblh", 9, color=colors.white, bold=True, align=TA_CENTER),
    "tbl_c": S("tblc", 8.6, leading=11),
    "small": S("small", 9, color=GREY),
}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ----------------------------------------------------------------- flowables
def heading(text, num=None):
    label = f"{num}. {text}" if num else text
    p = Paragraph(esc(label), S("h1", 15.5, color=HEADER, bold=True, space_after=2))
    t = Table([[p]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 1.1, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def h2(text):
    return Paragraph("■ " + esc(text), ST["h2"])


def body(text):
    return Paragraph(esc(text), ST["body"])


def bullets(items, ordered=False):
    out = []
    for i, it in enumerate(items):
        mark = f"{i+1}. " if ordered else "・"
        out.append(Paragraph(mark + esc(it), ST["bullet"]))
    return out


def image_flow(path, caption):
    im = PILImage.open(path)
    w, h = im.size
    iw = CONTENT_W
    ih = iw * h / w
    return [Image(path, width=iw, height=ih),
            Paragraph(esc(caption), ST["cap"])]


def callout(title, lines, fill="#EFF6FF", border="#255FB5", tcol=ACCENT):
    inner = [Paragraph(esc(title), S("bt", 10.5, color=tcol, bold=True, space_after=3))]
    for ln in lines:
        inner.append(Paragraph(esc(ln), ST["box_b"]))
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor(fill)),
        ("BOX", (0, 0), (-1, -1), 1, HexColor(border)),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def placeholder(caption):
    inner = [Paragraph("［ 実スクリーンショット差込欄 ］", ST["ph_t"]),
             Paragraph("▼ ここに実画面のスクリーンショットを貼り付け: " + esc(caption), ST["ph_b"])]
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#FFFBEB")),
        ("BOX", (0, 0), (-1, -1), 1.2, HexColor("#D97706"), 1, (4, 3)),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
    ]))
    return t


def code_box(lines):
    txt = "<br/>".join(esc(ln) if ln else "&nbsp;" for ln in lines)
    p = Paragraph(txt, ST["code"])
    t = Table([[p]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#1E222D")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


def cover(title, subtitle, tag=""):
    out = [Spacer(1, 2.2 * cm),
           Paragraph("営業ツール × Claude 連携マニュアル", ST["cover_top"]),
           Paragraph(esc(title), ST["cover_t"])]
    if subtitle:
        out.append(Paragraph(esc(subtitle), ST["cover_s"]))
    if tag:
        out.append(Paragraph(esc(tag), ST["cover_k"]))
    out.append(Spacer(1, 0.5 * cm))
    out.append(callout("本マニュアルについて(必ずお読みください)", [DISCLAIMER],
                       fill="#FFF7ED", border="#D97706", tcol=HexColor("#B45309")))
    out.append(Spacer(1, 0.4 * cm))
    out.append(Paragraph("作成日: 2026年6月28日 / 基準記事: HubSpot『国内の主要SFAツール10選』",
                         ST["ph_b"]))
    out.append(PageBreak())
    return out


def legend():
    return callout("図の見方", [
        "赤い枠 … 操作する対象(クリック/入力する箇所)を示します。",
        "番号バッジ ①②③ … 操作の順序と、右側の注釈に対応します。",
        "オレンジの破線枠『実スクリーンショット差込欄』… 実環境で撮影した画面を貼り付ける場所です。",
    ], fill="#F8FAFC", border="#CED4DA", tcol=HEADER)


def fig(name):
    return os.path.join(FIG, name)


# ----------------------------------------------------------------- documents
def doc_template(path):
    return SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=2.2 * cm, rightMargin=2.2 * cm,
        topMargin=2.0 * cm, bottomMargin=2.0 * cm,
        title=os.path.splitext(os.path.basename(path))[0])


def build_common():
    path = os.path.join(OUT, "00_Common_Claude_MCP_Guide.pdf")
    s = []
    s += cover(COMMON["title"], COMMON["subtitle"])
    s.append(heading("はじめに", 1)); s.append(body(COMMON["intro"]))
    s.append(legend())
    s.append(heading("MCP(Model Context Protocol)とは", 2)); s.append(body(COMMON["mcp_what"]))
    s += image_flow(fig("common_arch.png"), "図1: Claude × MCP × SFA/CRM の基本構成")
    s.append(heading("連携の3つのパターン", 3))
    for t, d in COMMON["patterns"]:
        s.append(h2(t)); s.append(body(d))
    s += image_flow(fig("common_flow.png"), "図2: 導入の基本ステップ")
    s.append(heading("Claude側の準備", 4))
    for t, d in COMMON["client_prep"]:
        s.append(h2(t)); s.append(body(d))
    s.append(code_box([
        "// Claude Desktop: claude_desktop_config.json の例",
        "{", '  "mcpServers": {', '    "<サービス名>": {',
        '      "command": "npx",',
        '      "args": ["-y", "<MCPサーバーのパッケージ>"],',
        '      "env": { "API_TOKEN": "********" }',
        "    }", "  }", "}"]))
    s.append(Spacer(1, 4)); s.append(placeholder("実際の設定ファイル編集画面/コネクタ追加画面"))
    s.append(heading("各サービスの連携方式 早見表", 5))
    s.append(overview_table())
    s.append(Spacer(1, 4))
    s.append(Paragraph("※ 公式MCPの有無・仕様は変更される場合があります。最新情報は各社公式をご確認ください。",
                       ST["small"]))
    s.append(heading("セキュリティ・運用上の注意", 6))
    s += bullets(COMMON["security"])
    s.append(Spacer(1, 4))
    s.append(callout("推奨: スモールスタート", [
        "①参照のみの権限で接続 → ②少人数で試験運用 → ③書き込み権限を段階的に付与 → ④全体展開、",
        "の順で進めると、事故を防ぎつつ定着させやすくなります。"]))
    doc_template(path).build(s)
    return path


def overview_table():
    rows = [[Paragraph(h, ST["tbl_h"]) for h in
             ["サービス", "提供元", "連携方式", "公式MCP", "主な接続方法"]]]
    for r in OVERVIEW_TABLE:
        rows.append([Paragraph(esc(c), ST["tbl_c"]) for c in r])
    widths = [CONTENT_W * w for w in (0.27, 0.16, 0.14, 0.10, 0.33)]
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#2D3748")),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CED4DA")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, HexColor("#F4F6F8")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def build_service(sv):
    path = os.path.join(OUT, sv["file"] + ".pdf")
    f = sv["file"]
    s = []
    s += cover(sv["name"], sv["tagline"], tag=f"提供元: {sv['vendor']}")
    s.append(legend())
    s.append(heading("本サービスと Claude 連携の概要", 1)); s.append(body(sv["summary"]))
    s.append(heading("連携方式と構成", 2)); s.append(body(sv["method"]))
    s += image_flow(fig(f"{f}_arch.png"), f"図1: {sv['name']} と Claude の連携構成図")
    s += image_flow(fig(f"{f}_flow.png"), "図2: 導入ステップの全体像")
    s.append(heading("事前準備(前提条件)", 3)); s += bullets(sv["prereq"])
    s.append(heading("連携手順", 4))
    if sv.get("token"):
        s.append(h2("手順1: サービス側で認証情報を発行する"))
        s += image_flow(fig(f"{f}_token.png"),
                        f"図3: {sv['token']['panel_title']}(操作対象を赤枠で表示)")
        s.append(placeholder(sv["token"]["ph"]))
    s.append(h2("手順2: Claude にMCPを登録する"))
    cap = {"connector": "図4: Claudeのコネクタ追加画面(公式リモートMCP)",
           "config": "図4: Claude Desktop 設定ファイルへの登録",
           "zapier": "図4: Zapier MCP の設定画面(iPaaS経由)"}[sv["connect"]]
    s += image_flow(fig(f"{f}_connect.png"), cap)
    ph = (sv.get("connect_params") or sv.get("config_params") or sv.get("zapier_params"))["ph"]
    s.append(placeholder(ph))
    s.append(h2("手順3: 動作確認(参照系でテスト)"))
    s.append(body("まずは『データを5件表示して』のような参照のみの指示で接続を確認します。"
                  "正しく取得できれば連携は成功です。続いて作成・更新の操作に進みます。"))
    s.append(heading("活用例・使用例", 5))
    s.append(body("実際のチャットでの活用イメージを示します。自然言語で指示すると、ClaudeがMCPツールを"
                  "選んで実行し、結果を要約して回答します。"))
    uc0 = sv["use_cases"][0]
    s += image_flow(fig(f"{f}_chat.png"), f"図5: 活用例 ―『{uc0['title']}』のチャット例")
    s.append(placeholder("実際のClaudeチャット画面(指示と回答)を貼り付け"))
    for i, uc in enumerate(sv["use_cases"]):
        s.append(h2(f"活用例{i+1}: {uc['title']}"))
        s.append(callout("プロンプト例(Claudeへの指示)", ["「" + uc["prompt"] + "」"]))
        s.append(body("▶ 期待される動作: " + uc["desc"]))
        s.append(Paragraph(esc("▶ 呼び出されるMCPツール(例): " + uc["tool"]), ST["small"]))
        s.append(Spacer(1, 4))
    s.append(heading("セキュリティ・運用上の注意", 6)); s += bullets(sv["notes"])
    s.append(Spacer(1, 4))
    s.append(callout("共通の注意", [
        "APIトークン/シークレットは秘匿情報です。共有・コミットせず、最小権限で発行してください。",
        "作成・更新・削除などの書き込み操作は、参照のみで検証してから段階的に許可してください。"],
        fill="#FEF2F2", border="#DC2626", tcol=HexColor("#B91C1C")))
    s.append(heading("参考リンク", 7))
    for label, url in sv["refs"]:
        s.append(Paragraph("・" + esc(label) + ": <font color='#255FB5'>" + esc(url) + "</font>",
                           ST["ref"]))
    doc_template(path).build(s)
    return path


def main():
    print("== PDF: 共通編 ==")
    build_common()
    for sv in SERVICES:
        print("== PDF:", sv["id"], sv["name"], "==")
        build_service(sv)
    print("PDF生成完了")


if __name__ == "__main__":
    main()
