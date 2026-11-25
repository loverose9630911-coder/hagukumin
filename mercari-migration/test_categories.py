"""categories.py のテスト。  実行:  python3 -m unittest mercari-migration/test_categories.py -v"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import categories as cat  # noqa: E402


def item(leaf, name='', specs=None, catch='', desc=''):
    return {'code': 'x', 'name': name, 'catch_copy': catch, 'description': desc,
            'category_path': ['ファッション', 'レディースファッション', 'トップス', leaf], 'specs': specs or {}}


class SleeveTest(unittest.TestCase):
    def test_spec_wins(self):
        self.assertEqual(cat.detect_sleeve(item('ニット、セーター', '半袖', {'袖タイプ': ['長袖']})), ('長袖', '仕様「袖タイプ」'))

    def test_name_words(self):
        self.assertEqual(cat.detect_sleeve(item('x', 'トップス 七分袖 春'))[0], '五分袖・七分袖')
        self.assertEqual(cat.detect_sleeve(item('x', 'ノースリーブ'))[0], 'ノースリーブ')
        self.assertEqual(cat.detect_sleeve(item('x', '長袖 長袖'))[0], '長袖')

    def test_falls_back_to_description(self):
        self.assertEqual(cat.detect_sleeve(item('x', 'ニット', desc='袖：半袖です'))[0], '半袖')

    def test_conflicting_words_are_unknown(self):
        self.assertEqual(cat.detect_sleeve(item('x', '長袖 半袖 2タイプ')), (None, '袖の表記が複数（長袖・半袖）'))

    def test_no_words_is_unknown(self):
        self.assertEqual(cat.detect_sleeve(item('x', 'ニット')), (None, '袖の表記なし'))


class ProposeTest(unittest.TestCase):
    def test_knit_long_sleeve(self):
        p = cat.propose(item('ニット、セーター', '長袖 ニット'))
        self.assertEqual(p['path'], 'トップス > ニット・セーター > 長袖')
        self.assertFalse(p['check'])

    def test_tshirt_short_sleeve_uses_mercari_label(self):
        self.assertEqual(cat.propose(item('Tシャツ、カットソー', '半袖'))['path'], 'トップス > Tシャツ・カットソー > 半袖(Tシャツ)')

    def test_unknown_sleeve_needs_check_and_defaults_to_long(self):
        p = cat.propose(item('シャツ、ブラウス', 'ブラウス OL'))
        self.assertEqual(p['path'], 'トップス > シャツ・ブラウス > 長袖')
        self.assertTrue(p['check'])

    def test_knit_vest(self):
        self.assertEqual(cat.propose(item('ベスト、ジレ', 'セーター ニット ベスト'))['path'], 'トップス > ベスト・ジレ・ビスチェ > ニットベスト')
        self.assertEqual(cat.propose(item('ベスト、ジレ', 'ベスト ノースリーブ'))['path'], 'トップス > ベスト・ジレ・ビスチェ > ベスト・ジレ')

    def test_skirt_length_and_shape(self):
        p = cat.propose(item('スカート', 'ロングスカート プリーツスカート'))
        self.assertEqual(p['path'], 'スカート > ロングスカート > プリーツスカート')
        self.assertFalse(p['check'])
        p = cat.propose(item('スカート', 'スカート 膝丈 Aライン', {'スカートシルエット': ['Aライン']}))
        self.assertEqual(p['path'], 'スカート > ひざ丈スカート > フレアスカート')

    def test_skirt_without_length_needs_check(self):
        p = cat.propose(item('スカート', 'スカート おしゃれ', {'スカートシルエット': ['タイト']}))
        self.assertTrue(p['check'])
        self.assertTrue(p['path'].endswith('タイトスカート'))

    def test_wide_and_gaucho_pants(self):
        self.assertEqual(cat.propose(item('ワイド、バギーパンツ', 'ワイドパンツ'))['path'], 'パンツ > ワイドパンツ・イージーパンツ')
        self.assertEqual(cat.propose(item('ガウチョパンツ', 'ワイドパンツ ガウチョパンツ'))['path'], 'パンツ > ガウチョパンツ')

    def test_category_and_name_disagree_needs_check(self):
        p = cat.propose(item('ワイド、バギーパンツ', 'スカート 膝下丈 Aライン'))
        self.assertTrue(p['check'])
        self.assertIn('スカート', p['reason'])

    def test_coat_without_exact_match_needs_check(self):
        p = cat.propose(item('ステンカラーコート', 'ロングアウター 春秋物'))
        self.assertTrue(p['check'])
        self.assertTrue(p['path'].startswith('ジャケット・アウター > '))

    def test_simple_leaves(self):
        self.assertEqual(cat.propose(item('タンクトップ', 'タンクトップ'))['path'], 'トップス > タンクトップ')
        self.assertEqual(cat.propose(item('パーカー', 'パーカー'))['path'], 'トップス > パーカー')
        self.assertEqual(cat.propose(item('タイツ', 'タイツ'))['path'], 'レッグウェア > タイツ')

    def test_dress_word_in_top_needs_check(self):
        self.assertTrue(cat.propose(item('ニット、セーター', '長袖 ニット ワンピース'))['check'])


if __name__ == '__main__':
    unittest.main()
