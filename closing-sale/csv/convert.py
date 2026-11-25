"""ストアクリエイターPro の商品CSV（項目指定）を、閉店セール用に書き換える。

  price               → 1（1円）
  sale-price          → 空欄（セール価格を消す）
  member-price        → 空欄（会員価格を消す）
  original-price      → そのまま（--clear-original-price を付けたときだけ空欄）
  postage-set         → そのまま（--postage-set 番号 を付けたときだけ、全商品をその配送グループに）
  sale-period-start   → 販売期間の開始（YYYYMMDDHH）
  sale-period-end     → 販売期間の終了（YYYYMMDDHH）
  それ以外の列（code, sub-code など）は1文字も変えない。

文字コード（Shift_JIS / cp932）と改行（CRLF）は元のCSVと同じにする。

使い方:
  python3 convert.py 入力.csv 出力.csv [--start 2026112500] [--end 2026113017] [--clear-original-price] [--postage-set 番号]
"""
import argparse
import csv
import io
import sys
from datetime import datetime
from pathlib import Path

START = '2026112500'   # 2026年11月25日 0時
END = '2026113017'     # 2026年11月30日 17時

NEW_VALUES = {
    'price': lambda s, e: '1',
    'sale-price': lambda s, e: '',
    'member-price': lambda s, e: '',
    'sale-period-start': lambda s, e: s,
    'sale-period-end': lambda s, e: e,
}
CLEAR_ORIGINAL = {'original-price': lambda s, e: ''}


class ConvertError(Exception):
    pass


def parse_period(value, label):
    if len(value) != 10 or not value.isdigit():
        raise ConvertError(f'{label} は YYYYMMDDHH の10桁の数字にしてください: {value}')
    try:
        return datetime.strptime(value, '%Y%m%d%H')
    except ValueError:
        raise ConvertError(f'{label} が日付として正しくありません: {value}') from None


def read(path):
    raw = Path(path).read_bytes()
    try:
        text = raw.decode('cp932')
    except UnicodeDecodeError as e:
        raise ConvertError(f'Shift_JIS として読めません: {e}') from None
    rows = list(csv.reader(io.StringIO(text, newline='')))
    if not rows:
        raise ConvertError('CSV が空です')
    return raw, rows


def write(path, rows):
    buf = io.StringIO(newline='')
    csv.writer(buf, lineterminator='\r\n', quoting=csv.QUOTE_MINIMAL).writerows(rows)
    Path(path).write_bytes(buf.getvalue().encode('cp932'))


def convert(src, dst, start=START, end=END, clear_original_price=False, postage_set=None):
    new_values = dict(NEW_VALUES, **(CLEAR_ORIGINAL if clear_original_price else {}))
    if postage_set is not None:
        # 半角数字だけを受け付ける（全角数字は isdigit() が真になるため isascii() も見る）
        if not (postage_set.isascii() and postage_set.isdigit()):
            raise ConvertError(f'配送グループの番号は半角数字にしてください: {postage_set!r}')
        new_values['postage-set'] = lambda s, e, v=postage_set: v
    s, e = parse_period(start, '開始'), parse_period(end, '終了')
    if s >= e:
        raise ConvertError(f'開始 {start} が終了 {end} より後になっています')

    _, rows = read(src)
    header, data = rows[0], rows[1:]
    missing = [c for c in new_values if c not in header]
    if missing:
        raise ConvertError(f'CSV に必要な列がありません: {missing}')
    if 'code' not in header:
        raise ConvertError('CSV に code の列がありません')
    bad = [i + 2 for i, r in enumerate(data) if len(r) != len(header)]
    if bad:
        raise ConvertError(f'列の数が見出しと合わない行があります（行番号 {bad}）')
    codes = [r[header.index('code')] for r in data]
    dup = sorted({c for c in codes if codes.count(c) > 1 or not c})
    if dup:
        raise ConvertError(f'code が空か重複しています: {dup}')

    idx = {c: header.index(c) for c in new_values}
    out = [list(header)]
    for r in data:
        r = list(r)
        for col, f in new_values.items():
            r[idx[col]] = f(start, end)
        out.append(r)

    # 書き出す前に、変えた列は狙いどおり・ほかの列は元のまま、を確かめる
    for before, after in zip(data, out[1:]):
        for i, (b, a) in enumerate(zip(before, after)):
            col = header[i]
            want = new_values[col](start, end) if col in new_values else b
            if a != want:
                raise ConvertError(f'{before[header.index("code")]} の {col} が想定と違います')
    write(dst, out)

    # 書き出したものを読み直して、もう一度確かめる
    _, again = read(dst)
    if again != out:
        raise ConvertError('書き出したCSVを読み直すと内容が一致しません')
    return header, data, out, new_values


def main(argv=None):
    ap = argparse.ArgumentParser(description='商品CSVを閉店セール用（1円・販売期間）に書き換える')
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--start', default=START, help=f'販売期間の開始 YYYYMMDDHH（既定 {START}）')
    ap.add_argument('--end', default=END, help=f'販売期間の終了 YYYYMMDDHH（既定 {END}）')
    ap.add_argument('--clear-original-price', action='store_true', help='元値（original-price）も空欄にする')
    ap.add_argument('--postage-set', help='全商品の配送グループ（postage-set）をこの番号にする')
    a = ap.parse_args(argv)
    if Path(a.src).resolve() == Path(a.dst).resolve():
        print('NG  入力と出力に同じファイルは指定できません'); return 1
    try:
        header, data, out, new_values = convert(a.src, a.dst, a.start, a.end, a.clear_original_price, a.postage_set)
    except ConvertError as e:
        print(f'NG  {e}（出力ファイルは作っていません）'); return 1
    print(f'OK  {len(data)}商品を書き換えて {a.dst} に保存しました')
    cleared = '・元値' if a.clear_original_price else ''
    print(f'    価格 1円 / セール価格・会員価格{cleared} 空欄 / 販売期間 {a.start} 〜 {a.end}')
    if a.postage_set is not None:
        print(f'    配送グループ（postage-set）: 全商品 {a.postage_set}')
    print(f'    そのままの列: {[c for c in header if c not in new_values]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
