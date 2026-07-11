# キャラクターwalkモーション動画

`source/` 配下の各キャラクター立ち絵(元画像から切り出し)を、Higgsfield(kling3_0_turbo / seedance_2_0)で
歩行(walk)アニメーション化した動画のリンク一覧です。動画本体はHiggsfield側にホストされています
(下記URL、90日程度で失効する可能性があるため、必要な場合は早めにダウンロードしてください)。

| # | キャラクター | 元画像 | 動画URL |
|---|---|---|---|
| 1 | 小石川光希 | `source/08_koishikawa_mitsuki.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_201202_1c277896-7adc-4d11-ac63-808022645c9e.mp4 |
| 2 | 秋月茗子 | `source/01_akizuki_meiko.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203508_761fa240-0f28-4e97-b3f5-e18788432260.mp4 |
| 3 | 土屋蛍 | `source/02_tsuchiya_hotaru.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203511_854ab813-7e8b-4aed-96dc-7291230e5a1b.mp4 |
| 4 | 須王銀太 | `source/03_suou_ginta.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_204618_2c4c4c80-80d9-4384-ab04-7d1d2b1a94d9.mp4 |
| 5 | 松浦遊 | `source/04_matsuura_yuu.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203514_cf425aa3-b71e-45a9-8e34-edc6a2a2ae63.mp4 |
| 6 | 佐久間すず | `source/05_sakuma_suzu.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203516_d899a613-7dc8-44ea-9fa0-f70bc3e65928.mp4 |
| 7 | 三輪悟史 | `source/06_miwa_satoshi.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_211346_dadfe988-0e04-4d79-8360-a7425881d477.mp4 |
| 8 | 名村慎一 | `source/07_namura_shinichi.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203517_47c807cf-3cf5-4d28-8c39-32f295ec51ce.mp4 |
| 9 | 鈴木亜梨実 | `source/09_suzuki_arimi.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203519_58e23770-7890-415f-9af9-423f16dd2cf3.mp4 |
| 10 | 六反田務 | `source/10_rokutanda_tsutomu.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203521_15ff94a9-f2e0-41a6-a194-91042642e8d6.mp4 |
| 11 | 小石川留美 | `source/11_koishikawa_rumi.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203523_180cb05b-d76f-4fb4-aa78-20bdc37a0b14.mp4 |
| 12 | 松浦要士 | `source/12_matsuura_youji.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_210342_2e46eee0-b4a2-48ca-98c0-71959c1b06fd.mp4 |
| 13 | 小石川仁 | `source/13_koishikawa_jin.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203525_a68dfa92-91a0-44b7-a750-121fd22ba4bd.mp4 |
| 14 | 松浦千弥子 | `source/14_matsuura_chiyako.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_203526_dc1814e6-5d3b-4196-a9f0-7f283eec7f37.mp4 |
| 15 | 北原杏樹 | `source/15_kitahara_anju.png` | https://d8j0ntlcm91z4.cloudfront.net/user_3FXRw0QbkyIIBK4oAfto9a5HESB/hf_20260711_212257_5bd6b9b3-a495-4327-bd9a-e6eaa691abf5.mp4 |

## 生成方法

- モデル: Higgsfield `kling3_0_turbo`(画像1枚→動画)。16番の北原杏樹のみ表情が安定しなかったため `seedance_2_0` に切り替え。
- 元画像はキャラクター一覧の立ち絵をトリミング・4倍拡大したもの。
- プロンプトは「ダンスではなく機械的な歩行のみ」「元の表情を変えない」ことを明示。
