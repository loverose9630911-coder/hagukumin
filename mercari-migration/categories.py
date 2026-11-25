"""Yahoo!ショッピングのカテゴリ（と商品名・仕様）から、メルカリShops のカテゴリを提案する。

決まった規則で当てはめ、根拠が足りない・食い違うものは check=True（要確認）にする。
提案は「ファッション > レディース > 」より後ろの名前（path）で返し、ID は
メルカリShops のテンプレートの「カテゴリーマスタ」から引く（category_ids）。
"""
import re

PREFIX = 'ファッション > レディース > '

SLEEVE_WORDS = [  # (語, メルカリの袖区分)
    ('ノースリーブ', 'ノースリーブ'), ('袖なし', 'ノースリーブ'),
    ('半袖', '半袖'), ('フレンチ袖', '半袖'),
    ('五分袖', '五分袖・七分袖'), ('5分袖', '五分袖・七分袖'), ('六分袖', '五分袖・七分袖'),
    ('七分袖', '五分袖・七分袖'), ('7分袖', '五分袖・七分袖'), ('八分袖', '五分袖・七分袖'),
    ('長袖', '長袖'),
]

# Yahoo の末端カテゴリ → (メルカリの親, 袖で分けるか)
SLEEVED = {
    'ニット、セーター': 'トップス > ニット・セーター',
    'シャツ、ブラウス': 'トップス > シャツ・ブラウス',
    'Tシャツ、カットソー': 'トップス > Tシャツ・カットソー',
    'カーディガン、ボレロ': 'トップス > カーディガン・ボレロ・アンサンブル',
    'ポロシャツ': 'トップス > ポロシャツ',
}
SIMPLE = {
    'タンクトップ': 'トップス > タンクトップ',
    'パーカー': 'トップス > パーカー',
    'タイツ': 'レッグウェア > タイツ',
    'ガウチョパンツ': 'パンツ > ガウチョパンツ',
    'ワイド、バギーパンツ': 'パンツ > ワイドパンツ・イージーパンツ',
}


def _sleeve_from_text(text):
    """文中に出てくる袖区分を、出てくる順に重複なしで返す。"""
    hits = sorted((text.index(word), label) for word, label in SLEEVE_WORDS if word in text)
    found = []
    for _pos, label in hits:
        if label not in found:
            found.append(label)
    return found


def detect_sleeve(item):
    """(袖区分 or None, 根拠) を返す。仕様 → 商品名・キャッチコピー → 商品説明 の順に見る。"""
    spec = (item.get('specs') or {}).get('袖タイプ') or []
    if spec:
        found = _sleeve_from_text(' '.join(spec))
        if len(found) == 1:
            return found[0], '仕様「袖タイプ」'
    for label, text in (('商品名・キャッチコピー', item.get('name', '') + ' ' + item.get('catch_copy', '')),
                        ('商品説明', item.get('description', ''))):
        found = _sleeve_from_text(text)
        if len(found) == 1:
            return found[0], label
        if len(found) > 1:
            return None, f'袖の表記が複数（{"・".join(found)}）'
    return None, '袖の表記なし'


def _skirt(item):
    text = item.get('name', '') + ' ' + item.get('catch_copy', '')
    specs = item.get('specs') or {}
    shape_src = ' '.join(specs.get('スカートシルエット') or []) + ' ' + text
    if 'プリーツ' in text:
        shape = 'プリーツスカート'
    elif 'タイト' in shape_src:
        shape = 'タイトスカート'
    elif re.search(r'フレア|Aライン|Ａライン', shape_src):
        shape = 'フレアスカート'
    else:
        shape = 'その他'
    if re.search(r'ロング|マキシ', text):
        length, sure = 'ロングスカート', True
    elif re.search(r'ミニ', text):
        length, sure = 'ミニスカート', True
    elif re.search(r'膝丈|ひざ丈|ヒザ丈', text):
        length, sure = 'ひざ丈スカート', True
    elif re.search(r'膝下|ミモレ|ミディ', text):
        length, sure = 'ひざ丈スカート', False   # 膝下はロング寄りのこともあるため要確認
    else:
        length, sure = 'ひざ丈スカート', False
    reason = f'丈：{"商品名の表記" if sure else "表記から決めきれない（仮にひざ丈）"}／形：{shape}'
    return f'スカート > {length} > {shape}', reason, not sure


def propose(item):
    """{'path', 'reason', 'check'} を返す。"""
    leaf = (item.get('category_path') or [''])[-1]
    name = item.get('name', '') + ' ' + item.get('catch_copy', '')
    check, notes = False, []

    if leaf in SLEEVED:
        base = SLEEVED[leaf]
        if leaf == 'ニット、セーター' and 'ボレロ' in name:
            notes.append('商品名に「ボレロ」')
            check = True
        sleeve, why = detect_sleeve(item)
        if sleeve is None:
            sleeve, check = '長袖', True
            notes.append(f'{why}（仮に長袖）')
        else:
            notes.append(f'袖：{sleeve}（{why}）')
        if base.endswith('Tシャツ・カットソー') and sleeve == '半袖':
            sleeve = '半袖(Tシャツ)'
        if base.endswith('カーディガン・ボレロ・アンサンブル') and sleeve == 'ノースリーブ':
            sleeve, check = '半袖', True
            notes.append('カーディガンにノースリーブの区分が無い')
        path = f'{base} > {sleeve}'
    elif leaf == 'ベスト、ジレ':
        path = 'トップス > ベスト・ジレ・ビスチェ > ' + ('ニットベスト' if re.search(r'ニット|セーター', name) else 'ベスト・ジレ')
        notes.append('商品名の表記')
    elif leaf == 'スカート':
        path, why, check = _skirt(item)
        notes.append(why)
    elif leaf in SIMPLE:
        path = SIMPLE[leaf]
        notes.append('Yahoo のカテゴリと同じ')
        if leaf.endswith('パンツ') and 'スカート' in name and 'パンツ' not in name:
            check = True
            notes.append('Yahoo はパンツだが商品名はスカート')
    elif leaf == 'ステンカラーコート':
        path, check = 'ジャケット・アウター > トレンチコート・スプリングコート', True
        notes.append('メルカリに「ステンカラーコート」が無いため近いものを仮に選択')
    elif 'コート' in leaf or 'ジャケット' in leaf:
        path, check = 'ジャケット・アウター > その他', True
        notes.append('Yahoo のカテゴリが「その他」のため')
    else:
        path, check = 'トップス > その他', True
        notes.append(f'規則にないカテゴリ（{leaf}）')

    if re.search(r'ワンピース', name) and path.startswith('トップス'):
        check = True
        notes.append('商品名に「ワンピース」')
    return {'path': path, 'reason': '／'.join(notes), 'check': check}


def category_ids(rows):
    """テンプレートのカテゴリーマスタの行 (ID, 名前, フル名) から {path: ID} を作る（レディースだけ）。"""
    return {full[len(PREFIX):]: cid for cid, _name, full in rows if cid and full and full.startswith(PREFIX)}
