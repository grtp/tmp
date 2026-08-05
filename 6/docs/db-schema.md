# DB スキーマ(ftool_app_\* テーブル)

本ツール自身のテーブルの全体像。DDL の正は
[`deploy/initdb/01_init.sql`](../deploy/initdb/01_init.sql)(開発)と
[`deploy/initdb/prod-app-schema.sql`](../deploy/initdb/prod-app-schema.sql)
(本番。内容は同一に保つ)。管理対象の業務テーブル(`dbo.products` 等)は
含まない — それらは `ftool_app_managed_tables` に「登録」されるだけで,
スキーマ自体は本ツールの管理外(実行時にカタログから読む)。

## ER 図の確認方法(DBeaver)

ER 図は静的ファイルとしては持たない(2026-07-24 決定: 手動同期の図は DDL と
乖離するため廃止)。確認は DBeaver(無料版)で**実 DB からリバース表示**する
— 現物から生成するので乖離が構造的に起きない:

1. 接続を新規作成 → SQL Server:
   `localhost:1433` / Database `ftool` / user `sa` / pass `Fidev01!`
   (要 `make dev_up`。ドライバ設定で Trust server certificate を有効にする)
2. ナビゲータで `ftool > スキーマ > dbo` を開く
3. ダブルクリックして **ER Diagram タブ** — dbo 内の全テーブル
   (ftool_app_\* + サンプル業務テーブル)が FK 線付きで表示される。
   特定テーブルだけ見たい場合はテーブルを複数選択 → 右クリック →
   「ER ダイアグラムを表示」

レビュー等で画像が必要な場合は DBeaver のダイアグラムから
エクスポート(PNG/SVG)する。

## テーブルの役割

| テーブル | 役割 |
|---|---|
| `ftool_app_users` | LDAP 認証成功時に自動登録されるユーザー台帳。キーは AD の objectGUID |
| `ftool_app_actions` | 機能マスタ。サイドバー/ホームの機能一覧の元になる。行の追加・削除は API に無い(コード実装+シードのみ。全行が常に組込) |
| `ftool_app_user_auth` | ユーザー×機能ごとの権限レベル(admin/maintainer/user)。行が無い機能は権限なし |
| `ftool_app_connections` | 管理対象テーブルの接続先(既定接続=アプリ自身のDBは含まない)。パスワードは AES-GCM 暗号化 |
| `ftool_app_managed_tables` | テーブル管理の管理対象登録。実テーブルのメタデータは毎回カタログから取得 |
| `ftool_app_operation_history` | 全操作の監査履歴(追記専用) |
| `ftool_app_user_settings` | ユーザー個人の設定(キー・値。本人だけが参照・変更。行が無い=既定値)。現在のキー: `header_clock` / `header_clock_format` |
| `ftool_app_home_config` | ホーム画面のウィジェット構成(全ユーザー共通の単一行 JSON,id=1 固定)。JSON の構造の正はフロントで,バックエンドは「有効な JSON・64KB 以下」だけ検証(DB でも `ISJSON` CHECK)。行が無い = 未設定(組込の既定表示) |

## 廃止テーブル(S48, 2026-08-04)

旧ダッシュボード機能の廃止にともない,以下の3テーブルを削除した
(`ftool_app_dash_templates` / `ftool_app_dash_template_items` /
`ftool_app_user_dash_items`)。ログイン後の着地ページは `/home` になり,
単一のグローバル JSON 設定(`ftool_app_home_config`,上記)駆動の
ウィジェットページに置き換える。

監査履歴の `action_code = 'dashboard'` や op `dash-template.*` /
`user-link.*` の**過去行はそのまま残る**(追記専用のため)。履歴 CSV の
表示整形コードも過去行のために残置している
(`backend/internal/httpapi/history_csv.go` 参照)。
