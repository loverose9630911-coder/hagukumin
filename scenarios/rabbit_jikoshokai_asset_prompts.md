# うさぎ「もも」4分自己紹介動画 ― 素材生成プロンプト集

台本（`rabbit_jikoshokai_4min.md`）を動画化するための、画像・音声・動画の生成プロンプト一式です。
Higgsfield（または同等の生成サービス）でそのまま使えます。生成物を編集ソフト（CapCut等）で合成してください。

---

## A. 画像生成（各カットの立ち絵・背景）

> 推奨モデル: `nano_banana_pro` ／ アスペクト比: 16:9 ／ 共通スタイル指定（各プロンプト末尾に付与）：
> `soft kawaii anime style, bright cheerful pastel colors, thick clean outlines, simple rounded shapes, wholesome, looks like a frame from a popular preschool cartoon.`

| カット | 用途 | プロンプト（英語） |
|---|---|---|
| A-1 | タイトル/登場 | A cute shy white rabbit girl named Momo standing in a beautiful flower field by a gently flowing stream, long soft white rabbit ears, fluffy cream floral-pattern dress, sandals, pink ribbon at her neck, bashful smile, big sparkly eyes, holding a small colorful flower bouquet, warm morning light, floating sparkles, butterflies. Full body, centered. |
| A-2 | 演奏会の回想 | The same white rabbit girl Momo gently playing a tiny bell / xylophone on a small forest stage at night, soft spotlights, music notes floating, audience of cute forest animals clapping in the background, happy nervous expression. |
| A-3 | にんじん | The same rabbit girl Momo happily holding one big bright orange carrot with both hands, sparkly eyes, a "yummy" expression, carrots and sparkles around her, plain soft pastel background. |
| A-4 | お花・花束 | The same rabbit girl Momo in a field of red, yellow and pink flowers, offering a big colorful flower bouquet toward the viewer with a kind smile. |
| A-5 | 家族大集合 | A big happy family of white rabbits in a flower meadow: a gentle papa rabbit, a warm mama rabbit, and many (about 20) cute baby/sibling rabbits of different sizes hopping around Momo, lively and cheerful, everyone smiling. |
| A-6 | おわり | The rabbit girl Momo waving goodbye in the flower field at golden sunset, petals drifting, gentle smile. |

---

## B. 音声生成（TTS・読み上げ）

> ツール: `generate_audio` ／ モデル候補: `text2speech_v2_elevenlabs`（自然さ重視）/ `text2speech_v2_minimax` 等
> パラメータ: `voice_type` と `voice_id` が必須 → `list_voices` で日本語が話せる声を選ぶ。
> ナレーション=落ち着いた女性アナウンス声、もも=やさしく少し恥ずかしがりな女の子の声。

### B-0 ナレーション（冒頭）
```
きのう、えんそうかいを おえた、うさぎさんの しょうかいです。
```

### B-1 もも：ごあいさつ
```
えへへ。こんにちは。わたしの なまえは、もも、です。しろい うさぎの、もも。よろしくね。ちょっぴり はずかしがりやさん、なの。
```

### B-2 もも：演奏会のおはなし
```
あのね、きのうね、もりの えんそうかいが あったの。どきどき したけど、さいごまで がんばったよ。みんなが パチパチ してくれて、うれしかったなあ。
```

### B-3 もも：好きな食べ物（にんじん）
```
わたしの すきな たべものは…じゃーん！にんじん！オレンジいろで、ぽりぽりして、あまいの。まいにち たべても、だいすき。みんなは なにが すき？
```

### B-4 もも：大好きなこと（お花）
```
それからね、わたし、おはなを そだてるのが だいすき。あかい おはな、きいろい おはな、ピンクの おはな。たくさん さいたら、はなたばに して、みんなに プレゼント するの。
```

### B-5 もも：家族のしょうかい
```
わたしの かぞくをね、しょうかい するね。やさしい パパと、あったかい ママ。そして、おにいちゃん、おねえちゃん、いもうと、おとうと。ぜんぶで、にじゅっぴき！たーくさん なの！まいにち にぎやかで、たのしいんだよ。
```

### B-6 もも：おわりのごあいさつ
```
きょうは、わたしの おはなしを きいてくれて、ありがとう。また、おはなばたけで あおうね。もも でした。ばいばーい！
```

---

## C. 動画生成（立ち絵を動かす）

> ツール: `generate_video` ／ モデル: `kling3_0_turbo`（単一始点画像のアニメ化）
> `medias`: 該当画像の job_id を `role: start_image` で渡す ／ duration: 5〜10秒 ／ 16:9

各カット共通の動き指示（プロンプト）例：
```
Wholesome preschool cartoon, gentle slow toddler-friendly motion. The cute rabbit girl Momo blinks, her ears wiggle softly, she sways a little and smiles warmly as she talks. Soft sparkles and flower petals drift gently in warm light. Calm, smooth, no fast or scary movement. Subtle camera push-in.
```
口の動き（リップシンク）が必要な場合は、台本の各セリフ尺に合わせてクリップを分割し、後工程で音声と合わせてください。

---

## D. 合成（最終仕上げ）

1. 各音声（B）と各クリップ（C）を、台本のタイムライン順（#0→#6）に並べる。
2. 〔SE〕指示（拍手・ぽりぽり・キラキラ・オルゴール等）と BGM を別途用意して重ねる。
   ※ BGM・効果音・歌は本ツール群では作れないため、外部の音楽生成/フリー素材を使用。
3. ひらがな字幕を大きめに（歌・呼びかけ部分はカラオケ風に色変え）。
4. 全体が約4分になるよう、間（ま）とリピートで調整。
```
タイムライン: #0ナレ(12秒) → #1あいさつ(33秒) → #2演奏会(40秒) → #3にんじん(45秒) → #4お花(45秒) → #5家族(45秒) → #6おわり(20秒)
```
