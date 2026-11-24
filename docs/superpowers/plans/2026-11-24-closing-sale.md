# 閉店セール（バナー・設定表・CSV書き換え） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office Casual Bura.bura（Yahoo!ショッピング）の閉店セール用に、バナー3種・設定表・投稿文・商品CSV書き換えスクリプトを用意する。

**Architecture:** バナーは1枚のHTMLテンプレートを Playwright で3サイズのPNGに書き出す。設定表と投稿文はMarkdown。CSV書き換えは依頼者の実物CSVが届いてから列名に合わせて Python で作る（Task 4）。

**Tech Stack:** HTML/CSS, Node.js + Playwright（環境に導入済み）, @fontsource のWebフォント, Python 3（標準ライブラリのみ）

**Spec:** `docs/superpowers/specs/2026-11-24-closing-sale-design.md`

## Global Constraints
- 文言（変更不可）: `CLOSING SALE` / `閉店セール` / `全商品` / `1円` / `＋送料1,500円（1点ごと）` / `11.24 TUE → 11.30 MON 17:00まで` / `長い間ありがとうございました` / `Office Casual Bura.bura`
- 配色: 黒×アイボリー。赤は「1円」だけ。
- 送料の文字は「1円」のすぐ近くに置き、高さは「1円」の数字の高さの 1/4 以上。
- 元値（定価→1円）は出さない。
- 出力サイズ: Yahoo看板 1180×260、LINE 1040×1040、スレッズ 1080×1350（px）。
- 期間の終わりは 17:00（15:00 ではない）。

## Review Focus
1. 横長で背の低いYahoo看板（1180×260）で文字がはみ出す → 全要素がキャンバス内に収まることをテストで確認（Task 1）。
2. Webフォントが読み込めず IPAゴシック等で黙って書き出される → `document.fonts` で指定フォントの読み込みを確認し、失敗なら書き出しを止める（Task 1）。
3. 送料が小さすぎて読めない（有利誤認の恐れ）→ 送料要素の高さ比をテスト（Task 1）。
4. 古い時刻（15:00）が残る → 出力HTMLのテキストに `17:00` があり `15:00` が無いことをテスト（Task 1）。
5. CSVの文字コード（Shift_JIS）や SKU の価格差列を壊す → Task 4 で実物CSVを使って往復テスト。

---

### Task 1: バナーのテンプレートと書き出し

**Files:**
- Create: `closing-sale/banner/banner.html`（`?v=yahoo|line|threads` で3レイアウト）
- Create: `closing-sale/banner/render.mjs`（3枚をPNGに書き出し、検査も行う）
- Create: `closing-sale/banner/package.json`（@fontsource の依存のみ）
- Output: `closing-sale/out/yahoo-kanban_1180x260.png`, `closing-sale/out/line_1040x1040.png`, `closing-sale/out/threads_1080x1350.png`

**Interfaces:**
- Produces: `node closing-sale/banner/render.mjs` → 3枚のPNGを `closing-sale/out/` に出力。検査に失敗したら終了コード1。

- [ ] Step 1: render.mjs に検査を先に書く（各バリアントで: キャンバス外にはみ出す要素が無い／`document.fonts.check` で指定フォントが読めている／送料要素の高さ ≥ 「1」の数字の高さ×0.25／本文テキストに `17:00` を含み `15:00` を含まない）。
- [ ] Step 2: テンプレートが無い状態で実行し、失敗することを確認。
- [ ] Step 3: banner.html を作る。
- [ ] Step 4: 実行して3枚が出力され、検査が全部通ることを確認。PNGのピクセル寸法を Python(PIL) で確認。
- [ ] Step 5: 画像を目で見て確認（Read で表示）。
- [ ] Step 6: Commit。

### Task 2: 設定表（管理画面での手順と値）

**Files:**
- Create: `closing-sale/README.md`

- [ ] Step 1: 値と手順を書く（価格1円、重量1、重量別送料表 1点1,500円〜、販売期間 〜11/30 17:00、商品説明に足す注意書き、終了後の非公開、要確認の項目）。
- [ ] Step 2: 金額表（点数×1,500円）を計算スクリプトで出し、手計算しない。
- [ ] Step 3: Commit。

### Task 3: LINE・スレッズ投稿文

**Files:**
- Create: `closing-sale/posts.md`

- [ ] Step 1: 投稿文を書く（文言は Global Constraints と一致させる）。
- [ ] Step 2: Commit。

### Task 4: 商品CSV書き換えスクリプト（依頼者のCSVが届いてから）

**Files:**
- Create: `closing-sale/csv/convert.py`
- Test: `closing-sale/csv/test_convert.py`

- [ ] Step 1: 実物CSVの文字コード・列名・SKU（価格差）列を調べる。
- [ ] Step 2: 実物CSVを入力にしたテストを先に書く（価格列が全行1／重量列が全行1／他の列は一字一句変わらない／文字コードが入力と同じ）。
- [ ] Step 3: convert.py を作る。
- [ ] Step 4: テストと実行を通す。
- [ ] Step 5: Commit。
