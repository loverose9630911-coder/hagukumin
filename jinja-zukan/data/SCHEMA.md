# 神社データの形式（data/src/*.json）

1 ファイル = 1 地方。中身は神社オブジェクトの配列です。
**公式に確認できた内容だけ**を入れ、確認できない項目は `null` か空配列にして `notes` に理由を書きます。
記憶や推測で埋めることは禁止です。

```json
{
  "id": "01-1",
  "prefCode": "01",
  "pref": "北海道",
  "name": "北海道神宮",
  "kana": "ほっかいどうじんぐう",
  "officialUrl": "https://www.hokkaidojingu.or.jp/",
  "sourceType": "official",
  "address": "北海道札幌市中央区宮ヶ丘474",
  "deities": ["大国魂神", "大那牟遅神"],
  "benefitsOfficial": ["開拓", "国土経営"],
  "history": "由緒の要約（2〜4文。公式の由緒ページに書かれていることだけ）",
  "access": ["地下鉄東西線「円山公園駅」から徒歩約15分"],
  "hours": "6:00〜17:00（季節により変動）",
  "festivals": [{ "name": "例祭（札幌まつり）", "date": "6月14日〜16日" }],
  "officialNotes": ["公式に書かれている参拝の決まりや注意（あれば）"],
  "sources": [
    { "label": "公式サイト トップ", "url": "https://..." },
    { "label": "公式サイト 由緒", "url": "https://..." }
  ],
  "fieldSources": {
    "address": [0], "deities": [1], "benefitsOfficial": [1],
    "history": [1], "access": [0], "hours": [0], "festivals": [0], "officialNotes": []
  },
  "notes": "確認できなかった項目・代替に差し替えた理由など。なければ空文字"
}
```

| 項目 | ルール |
|---|---|
| `id` | `都道府県コード-連番`（1〜3） |
| `sourceType` | `official`＝神社自身の公式サイト／`jinjacho`＝神社本庁・都道府県神社庁の公式サイト／`municipal`＝自治体・自治体の公式観光サイト |
| `benefitsOfficial` | 公式が「ご利益」「御神徳」として挙げている語句を、そのままの言葉で。書かれていなければ `[]` |
| `access` | 公式の交通案内の記載どおり。所要時間などの数字は公式に書いてある場合だけ |
| `hours` | 公式に参拝時間の記載がある場合だけ。なければ `null` |
| `festivals` | 例祭・主な祭事。公式に日付の記載があるものだけ |
| `fieldSources` | 各項目の根拠が `sources` の何番目か（0 始まり） |
