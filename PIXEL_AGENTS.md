# Pixel Agents でオフィスを見る(ローカル導入手順)

[Pixel Agents](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents)(Pablo De Lucca氏, MIT license)は、
実際に動いているClaude Codeのエージェントを、VS Code上のピクセルアートオフィスでキャラクターとして可視化するオープンソース拡張機能です。

`.claude/agents/` に定義した松浦商事の15人のサブエージェントは、この拡張機能がそのまま検知できる**実在のClaude Codeサブエージェント**です。
以下はご自身のPC(ローカル環境)での導入手順です ― この拡張機能は完全にローカル動作のため、リモートセッションからは実行できません。

## 前提条件

- VS Code 1.109.0 以降
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がローカルにインストール・ログイン済みであること

## 導入手順

1. VS Codeの拡張機能タブで **Pixel Agents** を検索してインストール(または[マーケットプレイスページ](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents)からInstall)。
2. このリポジトリ(`hagukumin`)をローカルにクローンし、VS Codeで開く。
   ```bash
   git clone https://github.com/loverose9630911-coder/hagukumin.git
   cd hagukumin
   git checkout claude/character-animations-alutga
   code .
   ```
3. VS Code下部のパネルエリアに **Pixel Agents** タブが表示されるので開く(表示されない場合はコマンドパレットから `Pixel Agents: Show Panel`)。
4. パネル内の **+ Agent** をクリック ― Claude Code用のターミナルと、そのキャラクターが1体生成される。
5. 生成されたターミナルで `claude` を実行し、Claude Code CLIをこのリポジトリ内で起動する。
6. 通常どおり指示を出す。特定の担当に任せたいときは、たとえば次のように頼む:
   - 「`yuu-ceo`エージェントとして、この2案の優先順位を判断して」
   - 「`anju-secretary`に今週のタスクを整理してもらって」
   - 「`tsutomu-accounting`エージェントでこの家計簿の計算を確認して」
7. Claude CodeがTask toolでサブエージェントを呼び出すと、Pixel Agents側に**親キャラクターに紐づいた別キャラクターが自動生成**され、作業内容(コード読み書き・コマンド実行など)に応じてアニメーションする。

## 現時点でできないこと(実際のソースコードで確認済み)

- **キャラクターの見た目・名前は現状カスタマイズ不可。** 6種類の固定ドット絵キャラクターが割り当てられる仕組みで、「遊」「光希」のように名前付き・専用スキンで表示することは**まだできません**(作者のRoadmapに「Agent creation and definition(カスタム名前・スキン)」として今後の予定として明記されています)。
- **家具フル装備には有料タイルセットが必要です**(Donarg氏の Office Interior Tileset、itch.ioで$2、ライセンス上リポジトリ非同梱)。無くても拡張機能自体は動作し、基本レイアウト+デフォルトキャラクターで使えます。
- **Windows以外での動作は未検証**と作者自身が明記しています(macOS/Linuxで挙動が異なる可能性があります)。
- **エージェント⇔ターミナルの紐付けはやや不安定**(頻繁な開閉やセッション復元時にズレることがあると作者が明記)。

## 参考

- 15人分のサブエージェント定義: [`.claude/agents/`](.claude/agents/README.md)
- Pixel Agents 本体: https://github.com/pablodelucca/pixel-agents
