# FORGE

社内の運用業務機能を束ねるポータル(コード名 table-maint v2)。
最初の機能は SQL Server のテーブルメンテナンス: 任意の接続先・任意のスキーマの
テーブルを admin が UI から動的に登録し、メタデータ(カラム/PK/型/rowversion)は
SQL Server のカタログ(INFORMATION_SCHEMA / sys.columns)から**実行時に取得**する。
テーブルを追加してもフロント・バックエンドの再ビルドは不要。

※「FORGE」は表示名(ブランド)。コード名(Go モジュール `tablemaint`、`app_` テーブル、
リポジトリ構成)は変更しない方針。表示名は i18n リソース(`common.systemName`)で差し替え可能。

## 技術スタック

| 層 | 技術 |
|---|---|
| frontend | Angular 21 (Nx monorepo)。UI は `libs/ui` に分離し Storybook で管理 |
| i18n | Transloco(実行時 ja/en 切替。辞書は `libs/ui/src/lib/i18n` にバンドル同梱) |
| backend | Go 1.22+ + gin。OpenAPI spec-first (oapi-codegen で gin サーバー生成) |
| 認証 | LDAP (AD, objectGUID キー)。開発は OpenLDAP (entryUUID) or モック |
| セッション | Redis。TTL 30分スライディング。httpOnly cookie `sid` (不透明ID) |
| 認可 | `app_user_auth`: 機能(action)ごとに admin / maintainer / user |
| 接続管理 | `app_connections`: 任意の SQL Server を admin が登録。パスワードは AES-256-GCM 暗号化 |
| 監査 | `app_operation_history` に全操作(ログイン含む)を記録。対象は `<接続名>:schema.table` 形式 |
| デプロイ | MIRACLE LINUX 9.6 + podman compose (nginx + backend + redis) |

## ディレクトリ

```
api/        OpenAPI 契約 (source of truth)。make generate で Go コード生成
backend/    Go サーバー (gen/api は生成物)
frontend/   Nx ワークスペース (apps/table-maint = アプリ, libs/ui = UI カタログ)
deploy/     compose / nginx / DB 初期化 / LDAP 初期データ
```

## DB テーブル(本ツール自身のもの。接頭辞 app_ で業務テーブルと区別)

| テーブル | 役割 |
|---|---|
| `app_users` | LDAP 初回ログイン時に MERGE で自動登録。キーは objectGUID |
| `app_actions` | 機能マスタ(ダッシュボードの機能カードの実体)。行の追加はコード実装 + シードとセットで行う。url 列は将来のテンプレート配布用の予約 |
| `app_user_links` | **ユーザー個人のリンクカード**。各自がダッシュボードから追加し、本人にだけ表示される |
| `app_user_auth` | 認可: (object_guid, action_id) → auth_level。行が無い機能は権限なし |
| `app_connections` | 接続先 SQL Server(admin が設定画面から追加。パスワードは AES-GCM 暗号化) |
| `app_managed_tables` | 管理対象テーブルの登録。`connection_id` NULL = 既定接続(アプリ自身のDB) |
| `app_operation_history` | 監査履歴(誰が/いつ/何を/対象/前後JSON/成否/IP) |

## 複数接続について

- 「既定接続」= アプリ自身の DB(env `MSSQL_DSN`)。app_connections には登録しない
  (資格情報を DB に複製しないため)。`connection_id` の NULL がこれを表す
- 追加接続のパスワードは `CONN_ENC_KEY`(base64 32byte)で AES-256-GCM 暗号化して保存。
  鍵を変更すると既存接続は復号できなくなる(502 connection_unavailable)。
  その場合は設定画面から各接続のパスワードを再入力する
- 接続先が落ちている場合、該当テーブルの操作は 502 を返す(他のテーブルには影響しない)

## 開発クイックスタート

前提: Go 1.22+, Node 20+, podman(+podman-compose)。

```bash
make dev-up        # SQL Server + OpenLDAP + Redis を起動(初回はDB初期化も走る)
make generate      # OpenAPI -> backend/gen/api
make run-dev       # バックエンド :8080 (LDAP_MOCK=true, admin/admin でログイン可)
make fe-install
make fe-serve      # http://localhost:4200 (/api は :8080 へプロキシ)
make fe-storybook  # http://localhost:4400 (UI カタログ)
```

### 開発用アカウント

| 経路 | ユーザー | パスワード | 備考 |
|---|---|---|---|
| `make run-dev` (モック) | admin | admin | 固定 GUID。initdb で admin 権限シード済み |
| `make run-dev-ldap` (OpenLDAP) | tanaka / suzuki / sato | Passw0rd! | 初回ログインで自動登録。権限は付与が必要(下記) |

### 初回 admin の付与(鶏と卵の解消)

権限を付与できるのは settings:admin だけなので、最初の管理者は SQL で付与する:

1. 対象ユーザーで一度ログイン(自動登録される)
2. `deploy/initdb/02_grant_admin.sql.example` の @username を書き換えて実行

```bash
podman exec -i tm-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost \
  -U sa -P 'DevPassw0rd!' -i /dev/stdin < deploy/initdb/02_grant_admin.sql
```

注意: `make dev-down` は LDAP のボリュームも消すため entryUUID が変わり、
付与済み権限との紐付けが切れる(再ログイン→再付与)。モックの GUID は固定。

## 権限モデル

機能(action)単位で auth_level を持つ。行が無ければその機能は使えない。

| 機能 code | user | maintainer | admin |
|---|---|---|---|
| table-maint | 行の閲覧・検索 | + 追加/編集/削除 | 同左 |
| settings | - | - | 設定全般(下記)と履歴閲覧 |

初回ログイン時は `AUTO_GRANT_TABLE_MAINT_VIEW=true`(既定) なら
table-maint:user が自動付与される。

## ダッシュボードと個人リンク

ダッシュボードには「権限のある機能カード」が並び、その後ろに**ユーザー個人の
リンクカード**が続く。各ユーザーは末尾の[リンクを追加]カードからタイトルと URL を
入力して自分だけのカードを追加できる(ホバーで編集/削除)。個人リンクは
`app_user_links` に本人紐付けで保存され、他のユーザーには表示されない。

将来構想(Sprint 3 以降): 管理者が配布する「ダッシュボードテンプレート」の選択、
自分のテンプレート保存・合成、カードの並べ替え・サイズ変更。

## 設定画面の構成

/settings は機能単位のカードで編集対象を選ぶ:

```
設定トップ
├─ テーブルメンテナンス設定   … タブ: 接続情報管理 / テーブル管理
├─ ダッシュボード設定         … 組込機能カードの表示編集(名称/アイコン/有効)
└─ ユーザー権限               … ユーザー x 機能の権限マトリクス
```

コード実装機能(組込)の「追加」はデプロイと不可分なため UI からは行えない。
新しい組込機能を作る場合は app_actions へのシード追加 + フロントのルート実装が必要。
任意 URL のカードは個人リンク(上記)として各ユーザーが自分で持つ。

## 本番デプロイ (MIRACLE LINUX 9.6 / podman)

SQL Server と AD は既存の社内サーバーを使う(コンテナ化しない)。

```bash
# 1) app_ テーブルを本番 SQL Server に作成(deploy/initdb/01_init.sql の app_ 部分)
# 2) deploy/.env に本番値を書く(deploy/compose.yaml 冒頭のコメント参照)
# 3) フロントをビルドして nginx にマウントさせる
make generate && make fe-install && make fe-build
podman compose -f deploy/compose.yaml up -d --build
```

- nginx が SPA 配信と `/api/` → backend:8080 のプロキシを行う(同一オリジン、CORS 不要)
- Redis はセッション専用(永続化なし。再起動 = 全員再ログイン)
- SELinux enforcing 環境向けにマウントへ `:z` 付与済み
- rootless podman で :80 が使えない場合は compose の ports を `8081:80` 等に変更

### 主要な環境変数(backend)

| 変数 | 既定値 | 説明 |
|---|---|---|
| `MSSQL_DSN` | 開発値 | `sqlserver://user:pass@host:1433?database=tablemaint` |
| `REDIS_ADDR` | localhost:6379 | セッションストア |
| `SESSION_TTL_MIN` | 30 | スライディング TTL(分) |
| `LDAP_URL` / `LDAP_BASE_DN` / `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | - | AD 接続 |
| `LDAP_USER_FILTER` | `(sAMAccountName=%s)` | 開発 OpenLDAP は `(uid=%s)` |
| `LDAP_ATTR_GUID` | objectGUID | 開発 OpenLDAP は `entryUUID` |
| `LDAP_GUID_FORMAT` | ad-binary | AD=バイナリ / OpenLDAP=`uuid-string` |
| `AUTO_GRANT_TABLE_MAINT_VIEW` | true | 初回ログインで閲覧権限を自動付与 |
| `CONN_ENC_KEY` | なし(必須) | 接続パスワードの暗号鍵。`openssl rand -base64 32` で生成 |
| `COOKIE_SECURE` | false | HTTPS 終端があるなら true |
| `LDAP_MOCK` | false | true で admin/admin のモック認証(開発専用) |

## 設計メモ

- **識別子のインジェクション対策**: 動的テーブルの schema/table/列名は登録時に
  カタログと突合した名前のみを `[ ]` 引用(`]` は二重化)で埋め込む。値は全て
  `@pN` プレースホルダ。orderBy 等のユーザー入力列名はイントロスペクション
  結果との突合を通ったものだけ使う。
- **楽観ロック**: rowversion 列を持つテーブルは `$rowVersion` 予約キーで
  base64 値を往復させ、不一致は 409 (row_version_mismatch)。持たないテーブルは
  主キーのみで更新(last-write-wins)。
- **権限の即時反映**: auth_level はセッションに入れず毎リクエスト DB から解決。
  admin の権限変更が再ログインなしで効く。
- **監査は best-effort**: 履歴の書込失敗で業務操作は失敗させない(ログのみ)。
  逆に業務がロールバックしても失敗の事実は履歴に残る。
- **対応外の列型**(varbinary/xml 等)は string + readonly に落とし、
  テーブル全体は使用可能なまま保つ。
