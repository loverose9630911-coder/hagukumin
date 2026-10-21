#!/usr/bin/env python3
"""神社図鑑のビルド。

data/src/*.json（地方ごとの調査データ）と data/photos.json（写真のクレジット）を
検証・集約し、src/page.html にデータを埋め込んで index.html を作る。

  python3 tools/build.py                      # index.html を作る
  python3 tools/build.py --fragment OUT.html  # Artifact 用（doctype なし）も書き出す
  python3 tools/build.py --check              # 検証だけ（書き出さない）

検証に失敗した場合は何も書き出さず、終了コード 1 で終わる。
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "data" / "src"
PHOTOS = ROOT / "data" / "photos.json"
TEMPLATE = ROOT / "src" / "page.html"
OUT = ROOT / "index.html"

# JIS X 0401 の都道府県コード
PREFS = {
    "01": "北海道", "02": "青森県", "03": "岩手県", "04": "宮城県", "05": "秋田県",
    "06": "山形県", "07": "福島県", "08": "茨城県", "09": "栃木県", "10": "群馬県",
    "11": "埼玉県", "12": "千葉県", "13": "東京都", "14": "神奈川県", "15": "新潟県",
    "16": "富山県", "17": "石川県", "18": "福井県", "19": "山梨県", "20": "長野県",
    "21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県", "25": "滋賀県",
    "26": "京都府", "27": "大阪府", "28": "兵庫県", "29": "奈良県", "30": "和歌山県",
    "31": "鳥取県", "32": "島根県", "33": "岡山県", "34": "広島県", "35": "山口県",
    "36": "徳島県", "37": "香川県", "38": "愛媛県", "39": "高知県", "40": "福岡県",
    "41": "佐賀県", "42": "長崎県", "43": "熊本県", "44": "大分県", "45": "宮崎県",
    "46": "鹿児島県", "47": "沖縄県",
}

# ご利益の分類。公式の「ご利益・御神徳」の語句に、ここのキーワードが含まれていれば
# そのタグを付ける（機械的な文字列一致。表はページ下部にもそのまま載せる）。
CATEGORIES = [
    ("family", "家庭運", ["家内安全", "家庭円満", "夫婦円満", "子授", "安産", "子育", "子孫繁栄", "家運"]),
    ("work", "仕事運", ["商売繁盛", "商売繁昌", "事業繁栄", "事業繁盛", "事業発展", "社運", "出世", "立身", "殖産", "産業", "仕事", "技芸", "諸芸"]),
    ("money", "金運", ["金運", "財運", "宝くじ", "財宝", "蓄財", "金銭"]),
    ("love", "縁結び", ["縁結", "良縁", "恋愛", "結婚", "縁談"]),
    ("health", "健康・長寿", ["病気平癒", "健康", "長寿", "延命", "無病息災", "身体健全", "医薬", "病除", "疫病"]),
    ("study", "学業", ["学業", "合格", "学問", "受験", "試験", "智恵", "知恵", "書道"]),
    ("yakuyoke", "厄除け・開運", ["厄除", "厄払", "厄祓", "開運", "方位除", "八方除", "除災", "災難除", "災厄"]),
    ("travel", "交通・旅の安全", ["交通安全", "航海安全", "海上安全", "旅行安全", "旅の安全", "道中安全", "航空安全", "交通"]),
    ("victory", "勝運", ["必勝", "勝運", "武運", "勝負"]),
    ("harvest", "豊作・大漁", ["五穀豊穣", "五穀豊饒", "豊作", "大漁", "豊漁", "農業", "漁業"]),
]

REQUIRED = {
    "id": str, "prefCode": str, "pref": str, "name": str, "officialUrl": (str, type(None)),
    "sourceType": str, "address": (str, type(None)), "deities": list,
    "benefitsOfficial": list, "history": (str, type(None)), "access": list,
    "hours": (str, type(None)), "festivals": list, "officialNotes": list,
    "sources": list, "fieldSources": dict, "notes": str,
}
SOURCE_TYPES = {"official", "jinjacho", "municipal"}
URL_RE = re.compile(r"^https?://[^\s]+$")


def tags_for(benefits):
    hits = []
    for key, _label, words in CATEGORIES:
        if any(w in b for b in benefits for w in words):
            hits.append(key)
    return hits


def validate(shrine, where):
    errs = []
    for key, typ in REQUIRED.items():
        if key not in shrine:
            errs.append(f"{where}: 項目 {key} がありません")
        elif not isinstance(shrine[key], typ):
            errs.append(f"{where}: 項目 {key} の型が違います")
    if errs:
        return errs
    sid = shrine["id"]
    m = re.fullmatch(r"(\d{2})-([123])", sid)
    if not m:
        errs.append(f"{where}: id '{sid}' は「都道府県コード-1〜3」の形ではありません")
    elif m.group(1) != shrine["prefCode"]:
        errs.append(f"{where}: id と prefCode が一致しません")
    if PREFS.get(shrine["prefCode"]) != shrine["pref"]:
        errs.append(f"{where}: prefCode {shrine['prefCode']} と pref '{shrine['pref']}' が一致しません")
    if shrine["sourceType"] not in SOURCE_TYPES:
        errs.append(f"{where}: sourceType '{shrine['sourceType']}' は使えません")
    if shrine["officialUrl"] and not URL_RE.match(shrine["officialUrl"]):
        errs.append(f"{where}: officialUrl が URL ではありません")
    if not shrine["sources"]:
        errs.append(f"{where}: sources が空です（出典のない神社は載せません）")
    for i, s in enumerate(shrine["sources"]):
        if not isinstance(s, dict) or not URL_RE.match(str(s.get("url", ""))) or not s.get("label"):
            errs.append(f"{where}: sources[{i}] に label と url が必要です")
    n = len(shrine["sources"])
    for field, idx in shrine["fieldSources"].items():
        if not isinstance(idx, list) or any(not isinstance(i, int) or i < 0 or i >= n for i in idx):
            errs.append(f"{where}: fieldSources.{field} の番号が sources の範囲外です")
    for f in shrine["festivals"]:
        if not isinstance(f, dict) or not f.get("name") or not f.get("date"):
            errs.append(f"{where}: festivals の各要素には name と date が必要です")
    for key in ("deities", "benefitsOfficial", "access", "officialNotes"):
        if any(not isinstance(v, str) or not v.strip() for v in shrine[key]):
            errs.append(f"{where}: {key} に空や文字列以外の要素があります")
    return errs


def load():
    """調査済みの神社と、まだ調査が済んでいない枠（sources が空）を分けて返す。

    同じ id が複数のファイルにある場合は、調査済みのほうを使う。
    調査済みどうしで重なっていたらエラーにする。
    """
    files = sorted(SRC_DIR.glob("*.json"))
    done, pending, errs = {}, {}, []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errs.append(f"{path.name}: JSON として読めません（{e}）")
            continue
        if not isinstance(data, list):
            errs.append(f"{path.name}: 配列ではありません")
            continue
        for i, s in enumerate(data):
            where = f"{path.name}[{i}] {s.get('name', '?') if isinstance(s, dict) else '?'}"
            if not isinstance(s, dict):
                errs.append(f"{where}: オブジェクトではありません")
                continue
            sid = s.get("id")
            if not s.get("sources"):
                pending.setdefault(sid, s)
                continue
            if sid in done:
                errs.append(f"{where}: 調査済みの id {sid} が {done[sid][1]} と重複しています")
                continue
            errs += validate(s, where)
            done[sid] = (s, path.name)
    shrines = [s for s, _ in done.values()]
    shrines.sort(key=lambda s: (s.get("prefCode", ""), s.get("id", "")))
    waiting = sorted((s for k, s in pending.items() if k not in done), key=lambda s: str(s.get("id")))
    return files, shrines, waiting, errs


def load_photos(ids):
    if not PHOTOS.exists():
        return {}, []
    photos = json.loads(PHOTOS.read_text(encoding="utf-8"))
    errs = []
    for sid, p in photos.items():
        if sid not in ids:
            errs.append(f"photos.json: id {sid} の神社がデータにありません")
            continue
        for key in ("src", "title", "pageUrl", "artist", "license"):
            if not p.get(key):
                errs.append(f"photos.json: {sid} に {key} がありません")
        if p.get("src") and not (ROOT / p["src"]).exists():
            errs.append(f"photos.json: {sid} の画像ファイル {p['src']} がありません")
    return photos, errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="検証だけ行う")
    ap.add_argument("--fragment", help="Artifact 用の本文（doctype なし）を書き出すパス")
    args = ap.parse_args()

    files, shrines, waiting, errs = load()
    photos, perrs = load_photos({s.get("id") for s in shrines})
    errs += perrs

    by_pref = {}
    for s in shrines:
        by_pref.setdefault(s.get("prefCode"), []).append(s)
    missing = [f"{c} {n}" for c, n in PREFS.items() if c not in by_pref]

    print(f"読み込んだファイル: {len(files)}  調査済みの神社: {len(shrines)}  写真: {len(photos)}")
    if waiting:
        print(f"調査待ち（ページには載せない）{len(waiting)}社: "
              + "、".join(f"{s.get('id')} {s.get('name')}" for s in waiting))
    if missing:
        print(f"まだ1社も載っていない都道府県（{len(missing)}）: " + "、".join(missing))
    for s in shrines:
        empty = [k for k in ("address", "history", "hours") if not s.get(k)]
        empty += [k for k in ("deities", "benefitsOfficial", "access", "festivals") if not s.get(k)]
        if empty:
            print(f"  空の項目 {s.get('id')} {s.get('name')}: {', '.join(empty)}")
    if errs:
        print(f"\n検証エラー {len(errs)} 件:")
        for e in errs:
            print("  - " + e)
        return 1
    if args.check:
        print("検証 OK")
        return 0

    for s in shrines:
        s["tags"] = tags_for(s["benefitsOfficial"])
        if s["id"] in photos:
            s["photo"] = photos[s["id"]]

    payload = {
        "built": date.today().isoformat(),
        "prefs": PREFS,
        "categories": [{"key": k, "label": l, "words": w} for k, l, w in CATEGORIES],
        "shrines": shrines,
    }
    data_js = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = TEMPLATE.read_text(encoding="utf-8")
    marker = "/*__SHRINE_DATA__*/null"
    if template.count(marker) != 1:
        print(f"src/page.html にデータ差し込み位置 {marker} がちょうど1つありません")
        return 1
    body = template.replace(marker, data_js)

    OUT.write_text(
        "<!doctype html>\n<html lang=\"ja\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        + body + "\n</html>\n",
        encoding="utf-8",
    )
    print(f"書き出し: {OUT.relative_to(ROOT.parent)}（{OUT.stat().st_size // 1024} KB）")
    if args.fragment:
        Path(args.fragment).write_text(body, encoding="utf-8")
        print(f"書き出し: {args.fragment}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
