# -*- coding: utf-8 -*-
"""content.py — マニュアル本文データ。

対象: HubSpot 記事「国内の主要SFAツール10選＆特徴や選び方を解説」
(https://blog.hubspot.jp/sales/sfa-comparison) で取り上げられている主要SFA/CRMを基準に、
各サービスと Claude / MCP の連携手順・活用例を記載する。

連携方式(mode):
  official = サービス公式のMCPサーバーが提供されている
  ipaas    = Zapier / Make 等の iPaaS 経由でMCP/自動化連携
  custom   = 公開APIをMCP化(自作/OSSのMCPサーバー)して連携
"""

DISCLAIMER = (
    "本マニュアルの画面図は、ネットワーク制限およびログイン要件のため実画面を取得できないことから、"
    "操作手順を再現した「イラスト(モックアップ)」です。各図には「実スクリーンショット差込欄」を設けています。"
    "運用時は実環境で同じ操作を行い、該当箇所のスクリーンショットを差し込んでください。"
    "なお、各サービスのMCP対応状況・API仕様・画面構成・料金プランは変更される場合があります。"
    "導入前に必ず各社の公式ドキュメントで最新情報をご確認ください。"
)

COMMON = {
    "title": "営業ツール × Claude 連携マニュアル【共通編】",
    "subtitle": "MCP(Model Context Protocol)で SFA/CRM と Claude をつなぐ基礎",
    "intro": (
        "本シリーズは、HubSpot の記事『国内の主要SFAツール10選＆特徴や選び方を解説』で紹介されている"
        "主要な営業支援ツール(SFA/CRM)を、AIアシスタント Claude と連携させるための実務マニュアルです。"
        "本書(共通編)では全ツールに共通する考え方・準備・注意点を解説し、各サービス編で個別の手順と活用例を示します。"
    ),
    "mcp_what": (
        "MCP(Model Context Protocol)は、AIアプリ(Claude)と外部ツール/データソースを安全につなぐための"
        "オープンな標準規格です。MCPサーバーが『ツール(操作)』を公開し、Claude がユーザーの自然言語の指示に応じて"
        "そのツールを呼び出します。これにより『顧客を検索して』『この商談を更新して』といった指示を、"
        "Claude が SFA/CRM のデータに対して直接実行できるようになります。"
    ),
    "patterns": [
        ("① 公式MCPサーバー", "サービス提供元が公式のMCPサーバーを用意している場合。最も安全・簡単で推奨。"
         "認証・権限はサービス側で制御される。例: kintone, Salesforce, Zoho CRM, HubSpot。"),
        ("② iPaaS経由 (Zapier / Make)", "公式MCPが無い、または複数SaaSを横断したい場合。"
         "Zapier 等が提供するMCPエンドポイントをClaudeに登録し、各SFAのコネクタを呼び出す。ノーコードで広範囲をカバー。"),
        ("③ カスタムMCP (公開APIをMCP化)", "公式MCPもiPaaSコネクタも無い場合。サービスの公開REST APIを"
         "ラップする小さなMCPサーバーを自作/OSS利用して接続する。最も自由度が高いが構築・保守が必要。"),
    ],
    "client_prep": [
        ("Claude Desktop を使う場合", "公式サイトからアプリを導入し、設定ファイル "
         "claude_desktop_config.json に mcpServers を記述してローカル/リモートのMCPを登録する。npx等で起動するMCPに最適。"),
        ("Claude(Web / アプリ)のコネクタを使う場合", "設定 > コネクタ から、公式リモートMCPサーバーのURLを"
         "追加して接続する。サーバー管理が不要で、チームでの利用に向く(プラン要件あり)。"),
    ],
    "security": [
        "最小権限の原則: Claudeに渡すAPIトークン/接続アプリには、必要な操作(参照のみ等)の範囲だけを付与する。",
        "秘匿情報の管理: APIトークン・クライアントシークレットは設定ファイルや環境変数で管理し、共有・コミットしない。",
        "書き込み操作の確認: レコードの作成・更新・削除は、まず参照のみで動作確認し、影響範囲を理解してから許可する。",
        "監査ログ: 誰がいつどのデータにアクセスしたかを追えるよう、SFA側の監査ログ/APIログを有効化する。",
        "個人情報・機密データ: 顧客情報を扱うため、社内のデータ取扱規程・各社の利用規約に準拠して運用する。",
    ],
}

# 早見表(共通編に掲載)
OVERVIEW_TABLE = [
    # name, vendor, mode_label, official_mcp, 主な接続方法
    ("HubSpot Sales Hub", "HubSpot", "公式MCP", "あり", "公式リモートMCP / Zapier / CData"),
    ("Salesforce Sales Cloud", "Salesforce", "公式MCP", "あり", "公式 Hosted MCP / DX MCP / Zapier"),
    ("eセールスマネージャー Remix Cloud", "ソフトブレーン", "カスタム/iPaaS", "なし", "Web API → 自作MCP / Zapier"),
    ("Sales Force Assistant", "NIコンサルティング", "カスタム/iPaaS", "なし", "API → 自作MCP / Zapier"),
    ("kintone", "サイボウズ", "公式MCP", "あり", "公式MCPサーバー(npx) / 公開MCP / CData"),
    ("Zoho CRM", "ゾーホー", "公式MCP", "あり", "公式MCPサーバー / CData"),
    ("Mazrica Sales", "マツリカ", "カスタム/iPaaS", "なし", "REST API → 自作MCP / Zapier"),
    ("Microsoft Dynamics 365 Sales", "マイクロソフト", "iPaaS/カスタム", "(Copilot系)", "Dataverse API / Zapier / CData"),
    ("GENIEE SFA/CRM (旧ちきゅう)", "ジーニー", "カスタム/iPaaS", "なし", "API → 自作MCP / Zapier"),
    ("Knowledge Suite", "ブルーテック", "カスタム/iPaaS", "なし", "API → 自作MCP / Zapier"),
]


def _uc(title, prompt, tool, reply, desc):
    return {"title": title, "prompt": prompt, "tool": tool, "reply": reply, "desc": desc}


SERVICES = [
    # ====================================================================== 1
    {
        "id": "01", "file": "01_HubSpot_Sales_Hub",
        "name": "HubSpot Sales Hub", "vendor": "HubSpot",
        "mode": "official", "connect": "connector",
        "tagline": "公式リモートMCPで、CRMデータを自然言語で操作",
        "summary": (
            "HubSpot Sales Hub は、コンタクト・会社・取引(ディール)・タスクなどを一元管理するSFA/CRMです。"
            "HubSpot は公式のリモートMCPサーバーを提供しており、Claude のコネクタとして登録するだけで、"
            "CRMデータの検索・作成・更新やレポート集計を自然言語で実行できます。無料プランでも多くのデータを扱えるため、"
            "スモールスタートに向いています。"),
        "method": (
            "推奨は公式リモートMCPサーバーの利用です。HubSpotアカウントで認証(OAuth)し、Claude側のコネクタにMCPの"
            "URLを登録します。ノーコードで広範に連携したい場合は Zapier MCP、SQL的な高度な参照には CData も選択肢です。"),
        "prereq": [
            "HubSpotアカウント(Sales Hub。無料版でも可、機能はプランに依存)",
            "Claude(Web/アプリ。コネクタ機能が使えるプラン)または Claude Desktop",
            "連携を許可するHubSpotユーザー権限(対象オブジェクトの参照/編集権限)",
            "(代替)Zapierアカウント、または CData Connect の利用環境",
        ],
        "token": {
            "panel_title": "HubSpot — 設定 > 連携 > プライベートアプリ",
            "rows": [("アプリ名", "Claude連携"), ("スコープ(権限)", "crm.objects.contacts.read / deals.write ..."),
                     ("アクセストークン", "pat-na1-********-****-****")],
            "annot_row": 1,
            "callouts": [(1, "Claudeに許可する権限(スコープ)を選択。まずは参照系から最小限で。"),
                         (2, "『作成』でアクセストークンを発行。これを連携設定で使用します。")],
            "ph": "実際のHubSpotプライベートアプリ作成画面/発行されたトークン画面を貼り付け",
        },
        "connect_params": {
            "url": "https://mcp.hubspot.com/  (公式リモートMCP)",
            "steps": [(1, "既に接続済みのコネクタはここに表示されます。"),
                      (2, "『カスタムコネクタを追加』からHubSpotのMCPを登録します。"),
                      (3, "公式MCPのURLを入力し、HubSpotアカウントで認証(OAuth)します。")],
            "ph": "実際のClaudeコネクタ追加画面/HubSpot認証画面を貼り付け",
        },
        "steps": [
            ("アカウント確認", "HubSpotにログインし対象権限を確認"),
            ("認証準備", "公式MCP用のOAuth、または\nプライベートアプリのトークンを用意"),
            ("Claudeに登録", "コネクタにHubSpot MCPを追加"),
            ("動作確認", "『コンタクトを5件表示』等\n参照系で接続テスト"),
            ("活用開始", "検索・作成・更新・要約を\n自然言語で実行"),
        ],
        "use_cases": [
            _uc("商談パイプラインの要約",
                "今月クローズ予定のディールを金額順に並べて、停滞しているものを教えて。",
                "hubspot.search_deals",
                ["今月クローズ予定のディールは8件・合計¥12,400,000です。",
                 "・A社 更新契約 ¥3,200,000(ステージ: 交渉中・7日間動きなし/要注意)",
                 "・B社 新規 ¥2,800,000(ステージ: 提案済み)",
                 "停滞している2件に次アクションの設定をおすすめします。"],
                "ディールの一覧取得・フィルタ・集計をClaudeに任せ、停滞案件の検知まで自動化できます。"),
            _uc("コンタクトへのフォローメール下書き",
                "山田様(A社)に、先週の打合せのお礼と次回日程調整のメール下書きを作って。",
                "hubspot.get_contact",
                ["山田様の直近の活動履歴を参照し、お礼+日程調整の下書きを作成しました。",
                 "件名: 先日はありがとうございました(次回日程のご相談)…"],
                "コンタクトの履歴を踏まえた文面をClaudeが生成。確認後そのまま送信・記録できます。"),
            _uc("レポート集計",
                "今四半期の担当者別の受注金額をまとめて、前四半期と比較して。",
                "hubspot.search_deals",
                ["担当者別 受注金額(今Q / 前Q):",
                 "・佐藤 ¥8.2M / ¥6.1M(+34%)",
                 "・鈴木 ¥5.4M / ¥7.0M(−23%)…"],
                "定例レポートの集計・比較を会話で実行。Excel出力前のたたき台づくりに有効です。"),
        ],
        "notes": [
            "公式MCPの提供範囲・URL・対応プランは変更されることがあるため、HubSpotの公式ドキュメントを確認する。",
            "プライベートアプリのトークンは強力な認証情報。スコープを絞り、定期的に再発行する。",
        ],
        "refs": [("HubSpot ナレッジベース(MCP/Breeze)", "https://knowledge.hubspot.com/ja/integrations"),
                 ("元記事(SFA比較)", "https://blog.hubspot.jp/sales/sfa-comparison")],
    },
    # ====================================================================== 2
    {
        "id": "02", "file": "02_Salesforce_Sales_Cloud",
        "name": "Salesforce Sales Cloud", "vendor": "Salesforce",
        "mode": "official", "connect": "connector",
        "tagline": "公式 Hosted MCP で、商談・ToDo・SOQLを会話操作",
        "summary": (
            "Salesforce Sales Cloud は世界トップシェアのSFA/CRMで、高いカスタマイズ性が特長です。"
            "Salesforce は公式のHosted MCP Servers(一般提供)を提供しており、MCP対応クライアントである"
            "Claude から、商談(Opportunity)・ToDo・レコードの参照/更新や SOQL 相当の照会を、"
            "エンタープライズグレードの認証・権限制御のもとで実行できます。"),
        "method": (
            "推奨は公式 Hosted MCP Servers(Enterprise Edition以上)です。Salesforce側で接続アプリ(OAuth)を構成し、"
            "Claudeのコネクタに登録します。開発者向けには 60以上のツールを備える Salesforce DX MCP もあります。"
            "ノーコード連携は Zapier、高度な参照は CData も利用できます。"),
        "prereq": [
            "Salesforce Sales Cloud(Hosted MCPは Enterprise Edition 以上が目安)",
            "システム管理者権限(接続アプリ/OAuth、権限セットの構成)",
            "Claude(コネクタ対応プラン)または Claude Desktop",
            "連携ユーザーのプロファイル/権限セット(対象オブジェクトのCRUD権限)",
        ],
        "token": {
            "panel_title": "Salesforce — 設定 > アプリケーション > 接続アプリ",
            "rows": [("接続アプリ名", "Claude Integration"),
                     ("OAuthスコープ", "api / refresh_token / offline_access"),
                     ("コールバックURL", "https://(Claude側で指定)")],
            "annot_row": 1,
            "callouts": [(1, "OAuthスコープで許可範囲を指定。最小権限で構成します。"),
                         (2, "保存後、Consumer Key/Secret を取得して連携に使用します。")],
            "ph": "実際のSalesforce接続アプリ作成画面/OAuth設定を貼り付け",
        },
        "connect_params": {
            "url": "Salesforce Hosted MCP Server エンドポイント(組織別)",
            "steps": [(1, "接続済みコネクタ一覧。Salesforceを追加します。"),
                      (2, "『カスタムコネクタを追加』でHosted MCPのURLを登録。"),
                      (3, "組織のMCPエンドポイントを入力し、OAuthで認証します。")],
            "ph": "実際のHosted MCP接続/Salesforceログイン認可画面を貼り付け",
        },
        "steps": [
            ("版/権限確認", "Edition と管理者権限を確認"),
            ("接続アプリ作成", "OAuthの接続アプリと\n権限セットを構成"),
            ("MCP有効化", "Hosted MCP Server を有効化"),
            ("Claudeに登録", "コネクタにMCPエンドポイントを追加"),
            ("活用開始", "商談・ToDo・照会を会話で実行"),
        ],
        "use_cases": [
            _uc("商談の更新",
                "ABC商事の商談ステージを『提案』から『最終交渉』に更新して、確度を70%にして。",
                "salesforce.update_opportunity",
                ["ABC商事の商談を更新しました。",
                 "ステージ: 最終交渉 / 確度: 70% / 完了予定日は据え置き。",
                 "次のToDo『見積最終版の送付』を作成しますか？"],
                "レコードIDを意識せず、会話で商談を更新。入力負荷を大きく下げられます。"),
            _uc("SOQL相当の照会",
                "先月作成された商談のうち、金額が100万円以上で未活動が5日以上のものを一覧にして。",
                "salesforce.run_query",
                ["条件に合致する商談は6件です(金額・最終活動日・担当を表で表示)。",
                 "うち3件は同一担当に集中しています。対応の平準化を提案します。"],
                "複雑な条件抽出をSOQLを書かずに依頼。レポート作成の前段に有効です。"),
            _uc("活動サマリ作成",
                "今日の私の商談活動を要約して、明日やるべきフォローを3つ挙げて。",
                "salesforce.search_tasks",
                ["本日の活動: 訪問2件・電話4件・メール6件。",
                 "明日の推奨フォロー: ①D社見積回答 ②E社の稟議状況確認 ③F社の再アポ"],
                "日次の活動ログを集約し、翌日のアクション提案まで自動化します。"),
        ],
        "notes": [
            "Hosted MCP のEdition要件・提供状況は変わる可能性があるため、最新の公式情報を確認する。",
            "本番組織への書き込みは、まずSandboxや参照のみで検証してから許可する。",
        ],
        "refs": [("Salesforce Hosted MCP Servers(公式)", "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html"),
                 ("Salesforce DX MCP", "https://github.com/salesforcecli/mcp")],
    },
    # ====================================================================== 3
    {
        "id": "03", "file": "03_eSalesManager",
        "name": "eセールスマネージャー", "vendor": "ソフトブレーン",
        "mode": "custom", "connect": "config",
        "tagline": "Web APIをMCP化し、日本式営業の入力負荷をAIで削減",
        "summary": (
            "eセールスマネージャー Remix Cloud は、日本の営業スタイルに適した国産SFAです。"
            "現時点で公式MCPは提供されていませんが、3種類のWeb API機能を備えており、これをMCP化(自作/OSSの"
            "MCPサーバーでラップ)することで、顧客・案件・活動報告(シングルインプット)のデータをClaudeから扱えます。"
            "iPaaS(Zapier/Make)経由での自動化も可能です。"),
        "method": (
            "Web APIをラップするカスタムMCPサーバーを用意し、claude_desktop_config.json に登録します。"
            "API利用にはプラン/契約条件があるため、事前に提供元へ確認します。ノーコードで始めるなら Zapier/Make の"
            "Webhook/HTTP連携を用いる方法もあります。"),
        "prereq": [
            "eセールスマネージャー Remix Cloud のアカウントとWeb API利用権限",
            "APIエンドポイント/認証情報(APIキー等)",
            "カスタムMCPサーバーの実行環境(Node.js または Python)",
            "Claude Desktop(ローカルMCPの起動に使用)",
        ],
        "token": {
            "panel_title": "eセールスマネージャー — システム設定 > Web API",
            "rows": [("API利用", "有効"), ("APIキー", "esm_********************"),
                     ("許可IP/スコープ", "参照: 顧客/案件/活動")],
            "annot_row": 1,
            "callouts": [(1, "Web APIを有効化し、APIキーを発行します(プラン要件あり)。"),
                         (2, "保存。発行値をカスタムMCPの環境変数に設定します。")],
            "ph": "実際のWeb API設定/APIキー発行画面を貼り付け",
        },
        "config_params": {
            "pkg": "node", "args": '["./esm-mcp-server/index.js"]',
            "envs": {"ESM_API_BASE": "https://(契約環境のAPIエンドポイント)",
                     "ESM_API_KEY": "esm_********************"},
            "note": "公式MCPが無いため、Web APIをMCP化する小さなサーバーを用意します。",
            "ph": "実際の設定ファイル/MCP起動ログを貼り付け",
        },
        "steps": [
            ("API有効化", "Web APIを有効化しキー発行"),
            ("MCP用意", "Web APIをMCP化\n(自作/OSSサーバー)"),
            ("Claudeに登録", "config.json にMCPを記述"),
            ("動作確認", "参照系で接続テスト"),
            ("活用開始", "案件・活動の要約/起票を自動化"),
        ],
        "use_cases": [
            _uc("活動報告(シングルインプット)の下書き",
                "本日訪問したG社の商談メモを、活動報告フォーマットに整えて登録して。",
                "esm.create_activity",
                ["G社の活動報告を作成しました(目的/結果/次回アクションを整形)。",
                 "案件『G社 更新提案』に紐付けて登録済みです。"],
                "口頭メモから報告を自動整形。現場の入力負荷を下げ、入力率を高めます。"),
            _uc("案件の進捗確認",
                "今週フェーズが進んでいない案件を担当者別に教えて。",
                "esm.search_opportunities",
                ["停滞案件は計5件。担当別: 田中3件・山本2件。",
                 "最長停滞はH社(11日)。リマインドの起票を提案します。"],
                "停滞案件の検知と是正アクションをClaudeが補助します。"),
            _uc("顧客情報の名寄せ確認",
                "『I商事』と『アイ商事株式会社』が重複していないか確認して。",
                "esm.search_customers",
                ["類似の顧客レコードが2件見つかりました。住所・電話が一致するため重複の可能性が高いです。"],
                "表記ゆれの重複候補を洗い出し、データ品質維持を支援します。"),
        ],
        "notes": [
            "Web APIの利用条件・レート制限・対象データは契約/プランに依存。提供元に必ず確認する。",
            "カスタムMCPは自社の保守対象。認証情報の管理と最小権限を徹底する。",
        ],
        "refs": [("eセールスマネージャー 公式", "https://www.e-sales.jp/"),
                 ("元記事(SFA比較)", "https://blog.hubspot.jp/sales/sfa-comparison")],
    },
    # ====================================================================== 4
    {
        "id": "04", "file": "04_SalesForceAssistant",
        "name": "Sales Force Assistant", "vendor": "NIコンサルティング",
        "mode": "custom", "connect": "config",
        "tagline": "日報・商談データをAPI経由でMCP化し、AI秘書的に活用",
        "summary": (
            "Sales Force Assistant(NIコンサルティング)は、AI秘書『アシスタント』が特長の国産SFAです。"
            "公式MCPは提供されていませんが、API連携機能を備えており、これをMCP化することで日報・商談・顧客データを"
            "Claudeから参照/集計できます。既存のAI秘書機能と、Claudeによる横断的な分析を組み合わせられます。"),
        "method": (
            "API をラップするカスタムMCPサーバーを用意して Claude Desktop に登録します。"
            "ノーコードで始める場合は Zapier/Make 経由のHTTP連携も選択肢です。"),
        "prereq": [
            "Sales Force Assistant のアカウントとAPI利用権限",
            "APIエンドポイント/認証情報",
            "カスタムMCPサーバーの実行環境(Node.js / Python)",
            "Claude Desktop",
        ],
        "token": {
            "panel_title": "Sales Force Assistant — 管理 > 外部連携(API)",
            "rows": [("API連携", "有効"), ("認証キー", "sfa_****************"),
                     ("公開範囲", "日報/商談/顧客 (参照)")],
            "annot_row": 1,
            "callouts": [(1, "API連携を有効化し、認証キーを取得します。"),
                         (2, "保存後、キーをカスタムMCPの環境変数に設定します。")],
            "ph": "実際のAPI連携設定/キー発行画面を貼り付け",
        },
        "config_params": {
            "pkg": "node", "args": '["./sfa-mcp-server/index.js"]',
            "envs": {"SFA_API_BASE": "https://(契約環境のAPIエンドポイント)",
                     "SFA_API_KEY": "sfa_****************"},
            "note": "公式MCPが無いため、APIをMCP化したサーバーを利用します。",
            "ph": "実際の設定ファイル/起動ログを貼り付け",
        },
        "steps": [
            ("API有効化", "外部連携(API)を有効化"),
            ("MCP用意", "APIをMCP化"),
            ("Claudeに登録", "config.json に記述"),
            ("動作確認", "参照系でテスト"),
            ("活用開始", "日報集計・分析を自動化"),
        ],
        "use_cases": [
            _uc("日報の自動要約",
                "今週のチーム日報を要約して、注目すべき商談と課題を3点に整理して。",
                "sfa.search_reports",
                ["今週の日報サマリ: 訪問38件・新規12件。",
                 "注目商談: J社(大型更新)/K社(競合切替の可能性)。",
                 "課題: 見積回答の遅延が3件。"],
                "大量の日報をClaudeが要約。マネージャーの確認工数を削減します。"),
            _uc("商談の勝ち筋分析",
                "直近で受注した商談に共通する特徴を分析して、ヨミ案件の優先度を提案して。",
                "sfa.search_deals",
                ["受注案件の共通点: 初回訪問→提案まで14日以内/キーマン接触あり。",
                 "この条件に近いヨミ案件を優先度高として5件提示します。"],
                "過去データから勝ちパターンを抽出し、次のアクションに反映します。"),
            _uc("顧客の対応漏れ検知",
                "30日以上接触のない既存顧客を、取引額の大きい順に教えて。",
                "sfa.search_customers",
                ["対応漏れの懸念がある顧客は12件。上位はL社/M社/N社。",
                 "フォロー用のToDo起票を提案します。"],
                "離反リスクのある顧客を可視化し、フォローの優先順位付けを支援します。"),
        ],
        "notes": [
            "API仕様・利用条件は提供元の規定に従う。導入前に対象データとレート制限を確認する。",
            "AI秘書機能とClaudeの役割分担を整理し、二重入力にならない運用設計を行う。",
        ],
        "refs": [("NIコンサルティング 公式", "https://www.ni-consul.co.jp/"),
                 ("元記事(SFA比較)", "https://blog.hubspot.jp/sales/sfa-comparison")],
    },
    # ====================================================================== 5
    {
        "id": "05", "file": "05_kintone",
        "name": "kintone", "vendor": "サイボウズ",
        "mode": "official", "connect": "config",
        "tagline": "公式MCPサーバー(npx)で、業務アプリのレコードをAI操作",
        "summary": (
            "kintone(サイボウズ)は、ノーコードで業務アプリを作れるクラウドプラットフォームです。"
            "公式のMCPサーバー(kintone/mcp-server)が提供されており、レコードの検索・取得・追加・更新などを"
            "Claudeから実行できます。自社の営業フローに合わせて作り込んだアプリを、そのままAIで操作できる点が強みです。"),
        "method": (
            "公式MCPサーバーを npx で起動し、Claude Desktop の設定ファイルに登録します。"
            "認証はkintoneのAPIトークン(アプリ単位)を使用します。MCPサーバーはREST APIを利用するため、"
            "Standard以上のプランが前提です(Lightプランは対象外)。"),
        "prereq": [
            "kintone(Standard 以上。REST API利用が前提)",
            "対象アプリの APIトークン(最大9個まで。1トークン=1アプリ運用も可)",
            "Node.js 実行環境(npx で公式MCPを起動)",
            "Claude Desktop",
        ],
        "token": {
            "panel_title": "kintone — アプリの設定 > APIトークン",
            "rows": [("APIトークン", "************************"),
                     ("アクセス権", "レコード閲覧 / 追加 / 編集"),
                     ("対象アプリ", "案件管理")],
            "annot_row": 1,
            "callouts": [(1, "操作を許可する権限にチェック。最小限から始めます。"),
                         (2, "『保存』後、アプリを『更新』して反映。トークンを控えます。")],
            "ph": "実際のAPIトークン生成画面/アプリ更新ダイアログを貼り付け",
        },
        "config_params": {
            "pkg": "npx", "args": '["-y", "@kintone/mcp-server"]',
            "envs": {"KINTONE_BASE_URL": "https://(サブドメイン).cybozu.com",
                     "KINTONE_API_TOKEN": "************************"},
            "note": "Standard以上が前提。1トークンで1アプリ、最大9アプリまで対応。",
            "ph": "実際のClaude Desktop設定/再起動後の接続確認を貼り付け",
        },
        "steps": [
            ("プラン/権限", "Standard以上とアプリ権限を確認"),
            ("トークン発行", "アプリでAPIトークンを生成し更新"),
            ("MCP登録", "config.json に公式MCPを記述"),
            ("再起動/確認", "Claude Desktopを再起動し接続確認"),
            ("活用開始", "レコード検索・登録・集計を実行"),
        ],
        "use_cases": [
            _uc("案件レコードの検索・集計",
                "案件管理アプリで、ステータスが『商談中』かつ金額50万円以上のレコードを金額順に出して。",
                "kintone.get_records",
                ["条件に合致するレコードは9件です(会社名・金額・担当・次回予定を表示)。",
                 "合計見込: ¥8,600,000。担当別の偏りもグラフ化できます。"],
                "複雑な条件のレコード抽出・集計を会話で実行。アプリのビュー作成が不要になります。"),
            _uc("レコードの新規登録",
                "新規の引き合い『O社・Webサイト改修・見込80万・担当=私』を案件管理に登録して。",
                "kintone.add_record",
                ["案件レコードを登録しました(レコード番号 #1042)。",
                 "初回フォローのリマインドを3営業日後に設定しますか？"],
                "メールやメモの内容からレコードを起票。転記作業をなくします。"),
            _uc("日次レポートの作成",
                "今週追加された案件を担当者別に集計して、先週との増減を教えて。",
                "kintone.get_records",
                ["今週の新規案件: 17件(先週比 +4)。",
                 "担当別: 私6・佐藤5・鈴木4・他2。最も伸びたのは私(+3)です。"],
                "定例の集計を自動化。複数アプリを横断した分析にも拡張できます。"),
        ],
        "notes": [
            "Lightプランは REST API 非対応のため公式MCPは利用不可。Standard以上が必要。",
            "APIトークンはアプリ単位。複数アプリを扱う場合はトークン設計(最大9)を計画する。",
            "初めての場合は kintone の公開MCP(セットアップ約10分)から試すのも有効。",
        ],
        "refs": [("kintone 公式MCPサーバー(GitHub)", "https://github.com/kintone/mcp-server"),
                 ("kintone MCP連携ガイド(サイボウズ)", "https://kintone-sol.cybozu.co.jp/integrate/pickup/m008637.html")],
    },
    # ====================================================================== 6
    {
        "id": "06", "file": "06_Zoho_CRM",
        "name": "Zoho CRM", "vendor": "ゾーホー",
        "mode": "official", "connect": "connector",
        "tagline": "公式MCPサーバー群で、リード〜商談をAIエージェント化",
        "summary": (
            "Zoho CRM は、コストパフォーマンスに優れた多機能CRMです。Zoho は公式のMCPサーバー(機能領域別に複数)を"
            "提供しており、構築・ホスティング不要で Claude などのMCP対応クライアントから接続できます。"
            "リード・取引先・商談などをAIエージェントのツールとして安全に操作できます。"),
        "method": (
            "Zoho が提供する事前構築済みMCPサーバーのエンドポイントを、Claudeのコネクタに登録し、"
            "Zohoアカウントで認証(OAuth)します。機能領域ごとにサーバーが分かれているため、必要なものだけ接続します。"),
        "prereq": [
            "Zoho CRM アカウント(対象機能を含むプラン)",
            "連携を許可するZohoユーザー権限",
            "Claude(コネクタ対応プラン)または Claude Desktop",
            "(代替)CData 等のMCP/ドライバ利用環境",
        ],
        "token": {
            "panel_title": "Zoho — API Console / MCP 設定",
            "rows": [("クライアント種別", "Self Client / Server-based"),
                     ("スコープ", "ZohoCRM.modules.ALL (必要分のみ)"),
                     ("OAuth", "認可コード発行")],
            "annot_row": 1,
            "callouts": [(1, "必要なスコープのみ選択(最小権限)。"),
                         (2, "OAuthで認可。Claudeのコネクタ登録時に使用します。")],
            "ph": "実際のZoho API Console/OAuth同意画面を貼り付け",
        },
        "connect_params": {
            "url": "https://(Zoho提供のMCPサーバーエンドポイント)",
            "steps": [(1, "接続済みコネクタ一覧。Zoho CRMを追加します。"),
                      (2, "『カスタムコネクタを追加』でMCPのURLを登録。"),
                      (3, "URL入力後、ZohoアカウントでOAuth認証します。")],
            "ph": "実際のコネクタ追加/Zoho認可画面を貼り付け",
        },
        "steps": [
            ("プラン/権限", "対象機能とユーザー権限を確認"),
            ("MCP選択", "必要な機能領域のMCPを選ぶ"),
            ("Claudeに登録", "コネクタにMCP URLを追加"),
            ("OAuth認証", "Zohoアカウントで認可"),
            ("活用開始", "リード/商談の操作・分析を実行"),
        ],
        "use_cases": [
            _uc("リードの優先順位付け",
                "未対応のリードを、スコアと作成日から優先度の高い順に10件出して。",
                "zoho.search_leads",
                ["優先度上位10件を表示しました(スコア・流入元・経過日)。",
                 "上位3件は本日中の架電を推奨。フォローToDoを作成できます。"],
                "リードの抽出・優先順位付けを自動化し、初動の早さを高めます。"),
            _uc("商談ステージの更新",
                "P社の商談を『見積提示』に進めて、次のフォロー日を3日後に設定して。",
                "zoho.update_deal",
                ["P社の商談を更新しました(ステージ=見積提示)。",
                 "フォロー活動を3日後に作成しました。"],
                "商談の更新と次アクション設定をまとめて実行します。"),
            _uc("週次パイプラインレポート",
                "今週のパイプラインをステージ別に集計して、先週からの変化を要約して。",
                "zoho.search_deals",
                ["ステージ別金額(今週/先週)を表示。",
                 "『交渉』が+¥3.1M、『提案』が−¥1.2M。全体では前進しています。"],
                "パイプラインの変化を定点観測し、ボトルネックを把握します。"),
        ],
        "notes": [
            "MCPサーバーは機能領域別。必要なものだけ接続し、スコープを最小化する。",
            "データセンター(.com/.jp等)により認証/エンドポイントが異なる場合があるため公式情報を確認する。",
        ],
        "refs": [("Zoho CRM MCP(公式)", "https://www.zoho.com/crm/developer/mcp.html"),
                 ("Zoho MCP 総合", "https://www.zoho.com/mcp/")],
    },
    # ====================================================================== 7
    {
        "id": "07", "file": "07_Mazrica_Sales",
        "name": "Mazrica Sales", "vendor": "マツリカ",
        "mode": "ipaas", "connect": "zapier",
        "tagline": "REST APIとiPaaSで、案件ボードの“見える化”をAI拡張",
        "summary": (
            "Mazrica Sales(旧 Senses)は、現場が使いやすいUIと案件ボードによる『見える化』、AIによる"
            "受注予測が特長のSFAです。公式MCPは提供されていませんが、REST API を備えており、"
            "Zapier等のiPaaS経由、またはAPIをMCP化することでClaudeと連携できます。"),
        "method": (
            "推奨は2通り。(A) Zapier のMCPエンドポイントをClaudeに登録し、Mazricaコネクタ/HTTPで操作する方法。"
            "(B) REST APIをラップするカスタムMCPを用意する方法。手軽さ重視なら(A)、自由度重視なら(B)です。"),
        "prereq": [
            "Mazrica Sales アカウントとAPI利用権限/APIキー",
            "(A)Zapierアカウント / (B)カスタムMCPの実行環境",
            "Claude(コネクタ対応)または Claude Desktop",
        ],
        "token": {
            "panel_title": "Mazrica Sales — 設定 > API連携",
            "rows": [("API連携", "有効"), ("APIキー", "mzr_****************"),
                     ("対象", "案件/取引先/行動 (参照)")],
            "annot_row": 1,
            "callouts": [(1, "API連携を有効化しAPIキーを発行します。"),
                         (2, "保存。Zapier/カスタムMCPの認証に使用します。")],
            "ph": "実際のAPI連携設定/APIキー画面を貼り付け",
        },
        "zapier_params": {"ph": "実際のZapier MCP設定/Mazricaアクション選択画面を貼り付け"},
        "steps": [
            ("API有効化", "API連携を有効化しキー発行"),
            ("経路選択", "Zapier または カスタムMCP"),
            ("Claudeに登録", "MCP URL/設定を登録"),
            ("動作確認", "参照系でテスト"),
            ("活用開始", "案件分析・起票を自動化"),
        ],
        "use_cases": [
            _uc("案件ボードの停滞分析",
                "案件ボードで、各フェーズに2週間以上滞留している案件を教えて。",
                "mazrica.search_deals",
                ["滞留案件は7件。『提案』フェーズに5件集中しています。",
                 "受注予測スコアの高い2件を優先フォロー対象として提示します。"],
                "Mazricaの予測スコアとClaudeの抽出を組み合わせ、優先順位付けを高度化します。"),
            _uc("行動履歴からの提案",
                "Q社の直近の行動履歴をまとめて、次の打ち手を提案して。",
                "mazrica.get_actions",
                ["Q社の履歴: 訪問2・電話3。最後の接触から9日経過。",
                 "提案: 導入事例の共有→意思決定者へのアポ打診。"],
                "行動履歴を踏まえた次アクションを提示し、商談を前進させます。"),
            _uc("受注見込のサマリ",
                "今月の受注見込を金額帯別に集計して、確度別の内訳も教えて。",
                "mazrica.search_deals",
                ["今月見込: ¥9.8M。確度A ¥4.2M / B ¥3.6M / C ¥2.0M。",
                 "確度Aの取りこぼし防止に、本日中の確認連絡を推奨します。"],
                "見込の集計と確度内訳を即時に把握し、月末の着地を管理します。"),
        ],
        "notes": [
            "API仕様・レート制限・対象データは提供元の規定に従う。",
            "Zapier経由は手軽だが、扱うデータの範囲とアクション権限を最小化する。",
        ],
        "refs": [("Mazrica(API連携)", "https://mazrica.com/product/senseslab/sfa/sfa-api/"),
                 ("Mazrica 公式", "https://product-senses.mazrica.com/")],
    },
    # ====================================================================== 8
    {
        "id": "08", "file": "08_Dynamics365_Sales",
        "name": "Microsoft Dynamics 365 Sales", "vendor": "マイクロソフト",
        "mode": "ipaas", "connect": "zapier",
        "tagline": "Dataverse APIとiPaaSで、Copilotと併用しながらAI操作",
        "summary": (
            "Microsoft Dynamics 365 Sales は、Microsoft 365 と統合された大規模向けSFAです。"
            "データは Dataverse に格納され、Web API で参照/更新できます。Microsoft 製品は Copilot を中心に"
            "MCP対応が進んでいますが、Claude からは Zapier/Make 等のiPaaS、または Dataverse Web API をMCP化して連携します。"),
        "method": (
            "推奨は2通り。(A) Zapier のMCPエンドポイント経由で Dynamics コネクタを操作。"
            "(B) Microsoft Entra ID(Azure AD)でアプリ登録し、Dataverse Web API をMCP化したサーバーで接続。"
            "既存のCopilotと役割分担しながら、Claudeで横断的な分析・整形を担わせる構成が現実的です。"),
        "prereq": [
            "Dynamics 365 Sales ライセンスと対象テーブルへの権限",
            "Microsoft Entra ID(Azure AD)でのアプリ登録(クライアントID/シークレット)",
            "(A)Zapierアカウント / (B)カスタムMCPの実行環境",
            "Claude(コネクタ対応)または Claude Desktop",
        ],
        "token": {
            "panel_title": "Microsoft Entra ID — アプリの登録",
            "rows": [("アプリ名", "Claude-Dynamics"),
                     ("APIアクセス許可", "Dynamics CRM user_impersonation"),
                     ("クライアントシークレット", "****************")],
            "annot_row": 1,
            "callouts": [(1, "Dataverse(Dynamics)へのAPIアクセス許可を付与します。"),
                         (2, "クライアントシークレットを発行し、連携の認証に使用します。")],
            "ph": "実際のEntra IDアプリ登録/API許可画面を貼り付け",
        },
        "zapier_params": {"ph": "実際のZapier(Dynamics)アクション設定画面を貼り付け"},
        "steps": [
            ("権限確認", "ライセンスとテーブル権限を確認"),
            ("アプリ登録", "Entra IDでアプリ登録・API許可"),
            ("経路選択", "Zapier または Dataverse API のMCP化"),
            ("Claudeに登録", "MCP URL/設定を登録"),
            ("活用開始", "商談・取引先の分析/更新を実行"),
        ],
        "use_cases": [
            _uc("パイプラインの健全性チェック",
                "今四半期の商談を確度別に集計して、失注リスクの高い大型案件を教えて。",
                "dynamics.query_opportunities",
                ["今Qの商談: 合計¥58M。確度別の内訳を表示。",
                 "失注リスク高の大型案件は3件(R社・S社・T社)。対策ToDoを提案します。"],
                "Dataverseの商談データを横断集計し、リスク案件を早期に発見します。"),
            _uc("取引先の関係性整理",
                "U社グループの関連取引先と進行中の商談を一覧にして。",
                "dynamics.query_accounts",
                ["U社グループの取引先6社と商談9件を関連付けて表示しました。",
                 "グループ全体の取引額と主要担当を整理しています。"],
                "複雑な取引先階層を整理し、アカウント戦略の検討を支援します。"),
            _uc("Copilotとの役割分担",
                "Copilotが作成した提案メモを取り込み、競合比較の観点で改善点を指摘して。",
                "dynamics.get_record",
                ["提案メモを取得しました。競合比較の観点で、価格根拠と差別化が不足しています。",
                 "補強用の論点を3つ提示します。"],
                "Copilotの生成物をClaudeでレビュー・補強する二段構えの活用ができます。"),
        ],
        "notes": [
            "認証はEntra IDのアプリ登録が前提。シークレットの失効管理と最小権限を徹底する。",
            "Microsoft純正のCopilot/MCP対応も進行中のため、最新の対応状況を確認して構成を選ぶ。",
        ],
        "refs": [("Dataverse Web API(Microsoft Learn)", "https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview"),
                 ("元記事(SFA比較)", "https://blog.hubspot.jp/sales/sfa-comparison")],
    },
    # ====================================================================== 9
    {
        "id": "09", "file": "09_GENIEE_SFA_CRM",
        "name": "GENIEE SFA/CRM (旧ちきゅう)", "vendor": "ジーニー",
        "mode": "custom", "connect": "zapier",
        "tagline": "API連携で、定着率の高い国産SFAをAIで自動入力支援",
        "summary": (
            "GENIEE SFA/CRM(旧ちきゅう)は、シンプルさと定着率の高さが評価される国産SFAです。"
            "公式MCPは提供されていませんが、API連携機能を備えており、外部システムとデータを即時共有できます。"
            "これをiPaaS(Zapier/Make)またはカスタムMCPでつなぐことで、Claudeから案件・行動の参照/起票が可能です。"),
        "method": (
            "推奨は (A) Zapier のMCPエンドポイント経由、(B) APIをMCP化したカスタムサーバー、のいずれか。"
            "現場の入力負荷軽減(自動起票)に効果が出やすい構成です。"),
        "prereq": [
            "GENIEE SFA/CRM のアカウントとAPI利用権限/APIキー",
            "(A)Zapierアカウント / (B)カスタムMCPの実行環境",
            "Claude(コネクタ対応)または Claude Desktop",
        ],
        "token": {
            "panel_title": "GENIEE SFA/CRM — 設定 > API連携",
            "rows": [("API連携", "有効"), ("APIキー", "gni_****************"),
                     ("対象", "案件/行動/顧客 (参照・追加)")],
            "annot_row": 1,
            "callouts": [(1, "API連携を有効化しAPIキーを発行します。"),
                         (2, "保存。Zapier/カスタムMCPの認証に使用します。")],
            "ph": "実際のAPI連携設定/APIキー画面を貼り付け",
        },
        "zapier_params": {"ph": "実際のZapier(GENIEE)アクション設定画面を貼り付け"},
        "steps": [
            ("API有効化", "API連携を有効化しキー発行"),
            ("経路選択", "Zapier または カスタムMCP"),
            ("Claudeに登録", "MCP URL/設定を登録"),
            ("動作確認", "参照系でテスト"),
            ("活用開始", "案件・行動の自動入力を実現"),
        ],
        "use_cases": [
            _uc("商談メモからの自動起票",
                "V社との電話メモを行動記録として登録し、案件の次回予定を更新して。",
                "geniee.create_action",
                ["V社の行動記録を登録しました(種別=電話/要点を整形)。",
                 "案件『V社 新規』の次回予定を更新済みです。"],
                "現場のメモから自動で起票・更新。入力の手間を最小化し定着を促します。"),
            _uc("行動量の可視化",
                "今週のメンバー別の行動件数を集計して、目標との差を教えて。",
                "geniee.search_actions",
                ["週次行動件数(目標比): 私 42/40 達成、W氏 28/40 未達。",
                 "未達メンバーへのフォローを提案します。"],
                "行動量を定点観測し、マネジメントの判断材料を提供します。"),
            _uc("案件の取りこぼし防止",
                "今月中にクローズ予定なのに次回予定が未設定の案件を教えて。",
                "geniee.search_deals",
                ["該当案件は4件。いずれも次アクション未設定です。",
                 "予定の一括起票を提案します。"],
                "対応漏れを検知し、確実なクロージングを支援します。"),
        ],
        "notes": [
            "API仕様・対象データ・レート制限は提供元の規定に従う。",
            "自動起票は便利な反面、誤登録防止のため重要操作は確認ステップを設ける。",
        ],
        "refs": [("GENIEE SFA/CRM 公式", "https://chikyu.net/"),
                 ("元記事(SFA比較)", "https://blog.hubspot.jp/sales/sfa-comparison")],
    },
    # ====================================================================== 10
    {
        "id": "10", "file": "10_Knowledge_Suite",
        "name": "Knowledge Suite", "vendor": "ブルーテック",
        "mode": "custom", "connect": "zapier",
        "tagline": "グループウェア+SFAをAPI連携し、横断データをAIで要約",
        "summary": (
            "Knowledge Suite(ブルーテック)は、グループウェア・SFA・名刺管理などを統合したオールインワン型サービスです。"
            "公式MCPは提供されていませんが、API連携を備えており、iPaaSまたはカスタムMCPでClaudeとつなぐことで、"
            "営業データとグループウェア情報を横断した要約・分析ができます。"),
        "method": (
            "推奨は (A) Zapier のMCPエンドポイント経由、(B) APIをMCP化したカスタムサーバー。"
            "複数機能を統合した特性を活かし、横断的な情報集約をClaudeに任せる構成が有効です。"),
        "prereq": [
            "Knowledge Suite のアカウントとAPI利用権限/認証情報",
            "(A)Zapierアカウント / (B)カスタムMCPの実行環境",
            "Claude(コネクタ対応)または Claude Desktop",
        ],
        "token": {
            "panel_title": "Knowledge Suite — 管理 > 外部連携(API)",
            "rows": [("API連携", "有効"), ("認証キー", "ks_****************"),
                     ("対象", "顧客/商談/日報 (参照)")],
            "annot_row": 1,
            "callouts": [(1, "API連携を有効化し認証キーを取得します。"),
                         (2, "保存。Zapier/カスタムMCPの認証に使用します。")],
            "ph": "実際のAPI連携設定/認証キー画面を貼り付け",
        },
        "zapier_params": {"ph": "実際のZapier(Knowledge Suite)アクション設定画面を貼り付け"},
        "steps": [
            ("API有効化", "API連携を有効化しキー発行"),
            ("経路選択", "Zapier または カスタムMCP"),
            ("Claudeに登録", "MCP URL/設定を登録"),
            ("動作確認", "参照系でテスト"),
            ("活用開始", "横断データの要約・分析を実行"),
        ],
        "use_cases": [
            _uc("商談+日報の横断要約",
                "X社に関する商談と日報を横断して、これまでの経緯を時系列でまとめて。",
                "ks.search_records",
                ["X社の経緯を時系列で整理しました(初回接触→提案→保留→再開)。",
                 "現在の論点は価格と納期。次アクションを2点提案します。"],
                "分散した情報を一つの物語として整理し、引き継ぎや上申に活用できます。"),
            _uc("名刺・顧客データの活用",
                "先月交換した名刺のうち、まだ商談化していない見込み客を教えて。",
                "ks.search_customers",
                ["未商談の見込み客は14名。役職・業種で分類して提示します。",
                 "優先アプローチ候補を5名抽出しました。"],
                "名刺データを商談機会に変換し、機会損失を防ぎます。"),
            _uc("週次の活動レポート",
                "今週の営業活動を部門横断で集計して、ハイライトを3点に整理して。",
                "ks.search_reports",
                ["今週ハイライト: ①大型受注(Y社) ②新規開拓12件 ③クレーム1件対応済。",
                 "詳細は部門別に表で表示します。"],
                "オールインワンの強みを活かし、横断的な週次サマリを自動生成します。"),
        ],
        "notes": [
            "API仕様・対象データは提供元の規定に従う。統合サービスのため対象範囲を明確化する。",
            "横断アクセスは情報集約に便利な反面、アクセス権限の設計を慎重に行う。",
        ],
        "refs": [("Knowledge Suite 公式", "https://www.bluetec.co.jp/knowledgesuite/"),
                 ("元記事(SFA比較)", "https://blog.hubspot.jp/sales/sfa-comparison")],
    },
]
