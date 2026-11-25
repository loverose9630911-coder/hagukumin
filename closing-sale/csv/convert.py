"""ストアクリエイターPro の商品CSV（項目指定）を、閉店セール用に書き換える。

  price               → 1（1円）
  sale-price          → 空欄（セール価格を消す）
  member-price        → 空欄（会員価格を消す）
  original-price      → 空欄（元値を出さないため）
  sale-period-start   → 販売期間の開始（YYYYMMDDHH）
  sale-period-end     → 販売期間の終了（YYYYMMDDHH）
  それ以外の列（code, sub-code, postage-set など）は1文字も変えない。

文字コード（Shift_JIS / cp932）と改行（CRLF）は元のCSVと同じにする。

使い方:
  python3 convert.py 入力.csv 出力.csv [--start 2026112500] [--end 2026113017]
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
    'original-price': lambda s, e: '',
    'sale-period-start': lambda s, e: s,
    'sale-period-end': lambda s, e: e,
}


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


def convert(src, dst, start=START, end=END):
    s, e = parse_period(start, '開始'), parse_period(end, '終了')
    if s >= e:
        raise ConvertError(f'開始 {start} が終了 {end} より後になっています')

    _, rows = read(src)
    header, data = rows[0], rows[1:]
    missing = [c for c in NEW_VALUES if c not in header]
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

    idx = {c: header.index(c) for c in NEW_VALUES}
    out = [list(header)]
    for r in data:
        r = list(r)
        for col, f in NEW_VALUES.items():
            r[idx[col]] = f(start, end)
        out.append(r)

    # 書き出す前に、変えた列は狙いどおり・ほかの列は元のまま、を確かめる
    for before, after in zip(data, out[1:]):
        for i, (b, a) in enumerate(zip(before, after)):
            col = header[i]
            want = NEW_VALUES[col](start, end) if col in NEW_VALUES else b
            if a != want:
                raise ConvertError(f'{before[header.index("code")]} の {col} が想定と違います')
    write(dst, out)

    # 書き出したものを読み直して、もう一度確かめる
    _, again = read(dst)
    if again != out:
        raise ConvertError('書き出したCSVを読み直すと内容が一致しません')
    return header, data, out


def main(argv=None):
    ap = argparse.ArgumentParser(description='商品CSVを閉店セール用（1円・販売期間）に書き換える')
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--start', default=START, help=f'販売期間の開始 YYYYMMDDHH（既定 {START}）')
    ap.add_argument('--end', default=END, help=f'販売期間の終了 YYYYMMDDHH（既定 {END}）')
    a = ap.parse_args(argv)
    if Path(a.src).resolve() == Path(a.dst).resolve():
        print('NG  入力と出力に同じファイルは指定できません'); return 1
    try:
        header, data, out = convert(a.src, a.dst, a.start, a.end)
    except ConvertError as e:
        print(f'NG  {e}（出力ファイルは作っていません）'); return 1
    print(f'OK  {len(data)}商品を書き換えて {a.dst} に保存しました')
    print(f'    価格 1円 / セール価格・会員価格・元値 空欄 / 販売期間 {a.start} 〜 {a.end}')
    print(f'    そのままの列: {[c for c in header if c not in NEW_VALUES]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
