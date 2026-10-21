#!/usr/bin/env python3
"""神社の写真を Wikimedia Commons から取り込む。

調査済みの神社ごとに Wikidata で神社を特定し（名前・「神社」であること・都道府県が一致するもの）、
その代表画像（P18）を Commons から 960px 幅で img/<id>.jpg に保存する。
撮影者・ライセンスは data/photos.json に書き、ページの詳細に表示する。

  python3 tools/fetch_photos.py            # 写真がまだ無い神社だけ取り込む
  python3 tools/fetch_photos.py --redo     # すべて取り込み直す
  python3 tools/fetch_photos.py --only 13-1,26-1

自動で特定できない神社は data/photo_overrides.json で指定できる。
  { "13-1": "Q1059374" }               … Wikidata の項目を指定
  { "13-1": "File:Meiji Jingu.jpg" }   … Commons のファイルを直接指定

自由利用できるライセンス（CC0・パブリックドメイン・CC BY・CC BY-SA）の画像だけを使う。
必要な接続先: www.wikidata.org / commons.wikimedia.org / upload.wikimedia.org
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from build import PREFS, load  # noqa: E402

PHOTOS = ROOT / "data" / "photos.json"
OVERRIDES = ROOT / "data" / "photo_overrides.json"
IMG_DIR = ROOT / "img"
WIDTH = 960
UA = "jinja-zukan/1.0 (https://github.com/loverose9630911-coder/hagukumin; static shrine guide)"
WD_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

SHRINE = "Q845945"  # 神社
FREE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+( [A-Za-z]+)?)", re.I)

_cache = {}


def get_json(url, params, tries=4):
    q = url + "?" + urllib.parse.urlencode({**params, "format": "json"})
    if q in _cache:
        return _cache[q]
    for i in range(tries):
        try:
            req = urllib.request.Request(q, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            _cache[q] = data
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 ** (i + 1))
                continue
            raise
        except urllib.error.URLError:
            if i < tries - 1:
                time.sleep(2 ** (i + 1))
                continue
            raise


def entities(ids):
    out = {}
    ids = list(ids)
    for i in range(0, len(ids), 40):
        d = get_json(WD_API, {"action": "wbgetentities", "ids": "|".join(ids[i:i + 40]),
                              "props": "claims|labels|descriptions|aliases", "languages": "ja"})
        out.update(d.get("entities", {}))
    return out


def claim_ids(ent, prop):
    vals = []
    for c in ent.get("claims", {}).get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and "id" in v:
            vals.append(v["id"])
        elif isinstance(v, str):
            vals.append(v)
    return vals


def is_shrine(ent, depth=0):
    """P31 が「神社」か、その下位分類（八幡宮・稲荷神社など）なら真。"""
    p31 = claim_ids(ent, "P31")
    if SHRINE in p31:
        return True
    if depth >= 2 or not p31:
        return False
    for cls in entities(p31).values():
        if SHRINE in claim_ids(cls, "P279"):
            return True
        if is_shrine({"claims": {"P31": cls.get("claims", {}).get("P279", [])}}, depth + 1):
            return True
    return False


def prefecture_of(ent, depth=0):
    """P131（所在地の行政区）をたどって都道府県名を返す。"""
    if depth > 5:
        return None
    for pid in claim_ids(ent, "P131"):
        parent = entities([pid]).get(pid, {})
        label = parent.get("labels", {}).get("ja", {}).get("value", "")
        if label in PREFS.values():
            return label
        found = prefecture_of(parent, depth + 1)
        if found:
            return found
    return None


def names_of(ent):
    names = [ent.get("labels", {}).get("ja", {}).get("value", "")]
    names += [a["value"] for a in ent.get("aliases", {}).get("ja", [])]
    return {n for n in names if n}


def search_names(shrine):
    base = shrine["name"]
    names = [base, re.sub(r"[（(].*?[）)]", "", base).strip()]
    names += re.findall(r"[（(](.*?)[）)]", base)
    return [n for i, n in enumerate(names) if n and n not in names[:i]]


def find_entity(shrine):
    for name in search_names(shrine):
        d = get_json(WD_API, {"action": "wbsearchentities", "search": name, "language": "ja",
                              "uselang": "ja", "type": "item", "limit": 15})
        ids = [r["id"] for r in d.get("search", [])]
        if not ids:
            continue
        cands = []
        for qid, ent in entities(ids).items():
            if name not in names_of(ent) and not any(n in names_of(ent) for n in search_names(shrine)):
                continue
            if not is_shrine(ent):
                continue
            if prefecture_of(ent) != shrine["pref"]:
                continue
            cands.append((qid, ent))
        if len(cands) == 1:
            return cands[0]
        if len(cands) > 1:
            with_img = [c for c in cands if claim_ids(c[1], "P18")]
            if len(with_img) == 1:
                return with_img[0]
            return None, f"候補が{len(cands)}件あり特定できません: " + ", ".join(q for q, _ in cands)
    return None, "Wikidata で名前・神社・都道府県が一致する項目が見つかりません"


def file_info(title):
    d = get_json(COMMONS_API, {"action": "query", "titles": title, "prop": "imageinfo",
                               "iiprop": "url|extmetadata|mime", "iiurlwidth": WIDTH})
    page = next(iter(d["query"]["pages"].values()))
    if "imageinfo" not in page:
        return None, f"Commons にファイル {title} がありません"
    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})
    lic = meta.get("LicenseShortName", {}).get("value", "")
    if meta.get("NonFree", {}).get("value") or not FREE.match(lic):
        return None, f"自由利用のライセンスではありません（{lic or '記載なし'}）"
    if info.get("mime") not in ("image/jpeg", "image/png"):
        return None, f"画像形式 {info.get('mime')} は使いません"
    artist = re.sub(r"<[^>]+>", "", html.unescape(meta.get("Artist", {}).get("value", ""))).strip()
    if not artist and meta.get("Credit"):
        artist = re.sub(r"<[^>]+>", "", html.unescape(meta["Credit"]["value"])).strip()
    return {
        "title": page["title"],
        "thumb": info.get("thumburl") or info["url"],
        "mime": info.get("mime"),
        "pageUrl": info["descriptionurl"],
        "artist": re.sub(r"\s+", " ", artist) or "不明",
        "license": lic,
        "licenseUrl": meta.get("LicenseUrl", {}).get("value", ""),
    }, None


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    dest.write_bytes(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--redo", action="store_true")
    ap.add_argument("--only", help="カンマ区切りの id")
    args = ap.parse_args()

    _files, shrines, _waiting, errs = load()
    if errs:
        print("データに検証エラーがあります。先に python3 tools/build.py --check を通してください。")
        return 1
    photos = json.loads(PHOTOS.read_text(encoding="utf-8")) if PHOTOS.exists() else {}
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    only = set(args.only.split(",")) if args.only else None
    IMG_DIR.mkdir(exist_ok=True)

    targets = [s for s in shrines if (only is None or s["id"] in only) and (args.redo or s["id"] not in photos)]
    print(f"対象 {len(targets)}社")
    try:
        get_json(WD_API, {"action": "wbgetentities", "ids": SHRINE, "props": "labels"}, tries=1)
    except Exception as e:  # noqa: BLE001
        print(f"Wikidata に接続できません（{e}）。環境のネットワーク設定で "
              "www.wikidata.org / commons.wikimedia.org / upload.wikimedia.org を許可してください。")
        return 2

    got, failed = 0, []
    for s in targets:
        sid, label = s["id"], f"{s['id']} {s['name']}"
        try:
            ov = overrides.get(sid)
            qid = None
            if ov and ov.startswith("File:"):
                title = ov
            else:
                if ov and re.fullmatch(r"Q\d+", ov):
                    qid, ent = ov, entities([ov])[ov]
                else:
                    qid, ent = find_entity(s)
                    if qid is None:
                        failed.append((label, ent))
                        continue
                imgs = claim_ids(ent, "P18")
                if not imgs:
                    failed.append((label, f"Wikidata {qid} に代表画像（P18）がありません"))
                    continue
                title = "File:" + imgs[0]
            info, why = file_info(title)
            if not info:
                failed.append((label, why))
                continue
            ext = ".png" if info["mime"] == "image/png" else ".jpg"
            dest = IMG_DIR / f"{sid}{ext}"
            size = download(info["thumb"], dest)
            photos[sid] = {
                "src": f"img/{dest.name}",
                "title": info["title"].removeprefix("File:"),
                "pageUrl": info["pageUrl"],
                "artist": info["artist"],
                "license": info["license"],
                "licenseUrl": info["licenseUrl"],
                "wikidata": qid,
            }
            got += 1
            print(f"  ✓ {label}  {info['title']}  {info['license']}  {size // 1024}KB")
            time.sleep(0.3)
        except Exception as e:  # noqa: BLE001
            failed.append((label, f"取得中のエラー: {e}"))

    PHOTOS.write_text(json.dumps(dict(sorted(photos.items())), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n取り込み {got}社 / 写真なし {len(failed)}社（photos.json は計 {len(photos)}社）")
    for label, why in failed:
        print(f"  ✗ {label}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
