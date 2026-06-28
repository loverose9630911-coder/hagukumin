# 営業ツール × Claude 連携マニュアル

HubSpot の記事『国内の主要SFAツール10選＆特徴や選び方を解説』
(https://blog.hubspot.jp/sales/sfa-comparison) で紹介されている主要SFA/CRMを対象に、
各サービスと Claude / MCP を連携する手順・活用例をまとめたマニュアルです。
**Word(.docx) と PDF をサービス別**に用意しています。

## 構成

| 区分 | ファイル(.docx / .pdf) | 内容 |
|---|---|---|
| 共通編 | `00_共通編_Claude×MCP連携の基礎` | MCPの基礎・3つの連携方式・準備・早見表・セキュリティ |
| 01 | `01_HubSpot_Sales_Hub` | HubSpot Sales Hub(HubSpot)― 公式リモートMCPで、CRMデータを自然言語で操作 |
| 02 | `02_Salesforce_Sales_Cloud` | Salesforce Sales Cloud(Salesforce)― 公式 Hosted MCP で、商談・ToDo・SOQLを会話操作 |
| 03 | `03_eSalesManager` | eセールスマネージャー(ソフトブレーン)― Web APIをMCP化し、日本式営業の入力負荷をAIで削減 |
| 04 | `04_SalesForceAssistant` | Sales Force Assistant(NIコンサルティング)― 日報・商談データをAPI経由でMCP化し、AI秘書的に活用 |
| 05 | `05_kintone` | kintone(サイボウズ)― 公式MCPサーバー(npx)で、業務アプリのレコードをAI操作 |
| 06 | `06_Zoho_CRM` | Zoho CRM(ゾーホー)― 公式MCPサーバー群で、リード〜商談をAIエージェント化 |
| 07 | `07_Mazrica_Sales` | Mazrica Sales(マツリカ)― REST APIとiPaaSで、案件ボードの“見える化”をAI拡張 |
| 08 | `08_Dynamics365_Sales` | Microsoft Dynamics 365 Sales(マイクロソフト)― Dataverse APIとiPaaSで、Copilotと併用しながらAI操作 |
| 09 | `09_GENIEE_SFA_CRM` | GENIEE SFA/CRM (旧ちきゅう)(ジーニー)― API連携で、定着率の高い国産SFAをAIで自動入力支援 |
| 10 | `10_Knowledge_Suite` | Knowledge Suite(ブルーテック)― グループウェア+SFAをAPI連携し、横断データをAIで要約 |

## 画面図について

実画面はネットワーク制限・ログイン要件のため取得できないため、各図は操作手順を再現した**イラスト(モックアップ)**です。各図および本文中に**「実スクリーンショット差込欄」**(オレンジ破線枠)を設けています。実環境で同じ操作を行い、該当箇所に実画面を貼り付けてご利用ください。

## 図の見方

- **赤枠** … 操作対象(クリック/入力する箇所)
- **番号バッジ ①②③** … 操作順序(右側の注釈に対応)
- **オレンジ破線枠** … 実スクリーンショットの差込位置

## 注意

各サービスのMCP対応状況・API仕様・画面構成・料金プランは変更される場合があります。
導入前に必ず各社の公式ドキュメントで最新情報をご確認ください。

## ファイル生成方法(再生成する場合)

```bash
pip install python-docx Pillow
python tools/build.py   # 図版生成→docx組版→PDF変換まで一括
```

## 生成物一覧

- `manuals/00_共通編_Claude×MCP連携の基礎.docx` / `manuals/00_共通編_Claude×MCP連携の基礎.pdf`
- `manuals/01_HubSpot_Sales_Hub.docx` / `manuals/01_HubSpot_Sales_Hub.pdf`
- `manuals/02_Salesforce_Sales_Cloud.docx` / `manuals/02_Salesforce_Sales_Cloud.pdf`
- `manuals/03_eSalesManager.docx` / `manuals/03_eSalesManager.pdf`
- `manuals/04_SalesForceAssistant.docx` / `manuals/04_SalesForceAssistant.pdf`
- `manuals/05_kintone.docx` / `manuals/05_kintone.pdf`
- `manuals/06_Zoho_CRM.docx` / `manuals/06_Zoho_CRM.pdf`
- `manuals/07_Mazrica_Sales.docx` / `manuals/07_Mazrica_Sales.pdf`
- `manuals/08_Dynamics365_Sales.docx` / `manuals/08_Dynamics365_Sales.pdf`
- `manuals/09_GENIEE_SFA_CRM.docx` / `manuals/09_GENIEE_SFA_CRM.pdf`
- `manuals/10_Knowledge_Suite.docx` / `manuals/10_Knowledge_Suite.pdf`
