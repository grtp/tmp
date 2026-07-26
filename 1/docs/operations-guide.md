# F-tool 運用・保守手順書

本書は F-tool を本番運用・保守する管理者向けの手順書。
コード変更を伴う作業(画面・API・スキーマの改修)は
[修正・改修手順書](development-guide.md) を参照。

---

## 1. 本番構成

```
[利用者ブラウザ] ──HTTP──> [nginx コンテナ]  … SPA 配信 + /api/ → backend へプロキシ
                              │
                        [backend コンテナ] (Go, :8080)
                              ├──> SQL Server(既存社内サーバー)
                              │      ├─ アプリDB: ftool_app_ テーブル群(設定・権限・監査履歴)
                              │      └─ 業務DB : 管理対象テーブル(複数接続可)
                              ├──> Active Directory(LDAP 認証)
                              └──> [Valkey コンテナ] … セッション専用(永続化なし)
```

- コンテナは `deploy/compose.yaml`(rootless podman)。SQL Server と AD は
  コンテナ化しない(既存サーバーを利用)。
- 同一オリジン構成のため CORS 設定は不要。
- タイムゾーン: DB 保存は UTC，画面・CSV の日時表示は JST。

### 1.1 環境変数一覧(backend。`deploy/.env`)

| 変数 | 既定 | 説明 |
|---|---|---|
| `MSSQL_DSN` | 開発値 | アプリDB接続 `sqlserver://user:pass@host:1433?database=ftool` |
| `APP_DB_SCHEMA` | dbo | ftool_app_ テーブルを置くスキーマ(§1.2b)。initdb の `:setvar APP_SCHEMA` と揃える |
| `REDIS_ADDR` | localhost:6379 | Valkey(セッション) |
| `SESSION_TTL_MIN` | 30 | セッションのスライディング有効期限(分) |
| `LDAP_URL` / `LDAP_BASE_DN` / `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | - | AD 接続 |
| `LDAP_USER_FILTER` | `(sAMAccountName=%s)` | ユーザー検索フィルタ |
| `LDAP_ATTR_GUID` | objectGUID | ユーザー同一性キーの属性 |
| `LDAP_GUID_FORMAT` | ad-binary | AD=バイナリ / OpenLDAP=`uuid-string` |
| `LDAP_STARTTLS` | false | `ldap://` に対し StartTLS で暗号化(`ldaps://` を使う場合は不要) |
| `LDAP_ATTR_DISPLAY_NAME` | displayName | 表示名の属性 |
| `LDAP_ATTR_MAIL` | mail | メールアドレスの属性 |
| `REDIS_PASSWORD` / `REDIS_DB` | ""/0 | Valkey に認証を付ける場合 |
| `AUTO_GRANT_TABLE_MAINT_VIEW` | true | 初回ログインで table-maint:user を自動付与 |
| `CONN_ENC_KEY` | **必須** | 接続パスワードの暗号鍵(§8.2) |
| `COOKIE_NAME` / `COOKIE_SECURE` | sid / false | セッション Cookie 名 / HTTPS 終端があるなら true |
| `ADDR` | :8080 | backend の待受アドレス |
| `LDAP_MOCK` | false | 開発専用。**本番では必ず false** |

### 1.2 外部サーバー(AD / 設定用DBサーバー)への接続設定

AD と SQL Server(設定用のアプリDBを含む)はコンテナ外の既存サーバーを使う
構成が標準。別セグメント・別拠点のサーバーを使う場合は以下を設計・設定する。

#### a. ネットワーク要件(FW 申請の一覧)

| 通信 | 方向 | ポート | 備考 |
|---|---|---|---|
| backend → 設定用DB(アプリDB) | コンテナホスト → SQL Server | TCP 1433(または固定した任意ポート) | **動的ポートは使わず固定ポートにする**(SQL Browser UDP 1434 に依存させない) |
| backend → 業務DB(接続管理で登録する各サーバー) | 同上 | 各サーバーのポート | 接続を追加するたびに FW も追加 |
| backend → AD | コンテナホスト → DC | TCP 636(LDAPS 推奨)/ 389(LDAP+StartTLS) | 平文 389 は閉域でのみ |
| 利用者 → nginx | クライアント → コンテナホスト | 80/443 | |

- コンテナからの**名前解決**: ホスト名(FQDN)を使う場合はコンテナが社内 DNS を
  引けること。引けない環境では `deploy/compose.yaml` の backend サービスに
  `extra_hosts:`(`"db.example.local:10.0.0.5"` 形式)を追加するか，IP 直書きにする
- 時刻同期: 監査履歴の整合のため，コンテナホストは NTP で同期しておく

#### b. 設定用DB(アプリDB)が外部 SQL Server の場合

`MSSQL_DSN` の書式(go-mssqldb):

```
sqlserver://<user>:<password>@<host>:<port>?database=<db>&encrypt=true
```

- **認証は SQL Server 認証のサービスアカウント**を使う(Linux コンテナからの
  Windows 統合認証は運用しない)。専用アカウント例: `svc_ftool`
- パスワードに記号(`@ / ? # :` 等)を含む場合は **URL エンコード**して記載する
  (例: `p@ss` → `p%40ss`)
- 名前付きインスタンス: `sqlserver://user:pass@host/INSTANCE?database=...`
  (この場合のみ SQL Browser UDP 1434 が必要になるため，可能なら固定ポート運用を推奨)
- **経路の暗号化**: 外部サーバーへは `encrypt=true` を付ける。サーバー証明書が
  社内 CA の場合はコンテナに CA を信頼させる(下記 d)。暫定として
  `&trustservercertificate=true` で検証をスキップできるが，恒久運用にはしない
- **本番の標準構成(2026-07時点)**: DB・スキーマの作成は DBA が行う。
  backend の接続アカウントは SQL Server 認証で，権限は DBA が用意した
  特定スキーマ内に閉じている(`CREATE SCHEMA` / `CREATE DATABASE` 権限は無い)。
  DB が `dbo` 以外の専用スキーマを割り当てた場合の初期セットアップ手順:
  1. DBA が DB とスキーマを作成し，接続アカウントへそのスキーマ内の
     `CREATE TABLE` / `ALTER TABLE` 権限(初期構築時のみ)と
     `db_datareader` + `db_datawriter`(通常運用)を付与
  2. `deploy/initdb/prod-app-schema.sql` を
     `sqlcmd -S <host> -d <db> -U <user> -P <password> -v APP_SCHEMA=<スキーマ名> -i prod-app-schema.sql`
     で適用する(`CREATE DATABASE` / `CREATE SCHEMA` / サンプルデータを含まない，
     ftool_app_* テーブルのみの DDL。`-v APP_SCHEMA=` の指定は必須で，省略時は
     sqlcmd がエラーで停止する)
  3. backend の環境変数 `APP_DB_SCHEMA` に同じスキーマ名を設定
  4. 起動時の存在確認(VerifyAppTables)もこのスキーマを見る。不一致だと
     「required table <schema>.ftool_app_users not found」で fail-fast する
  - 開発/検証環境(Podman コンテナ)は `deploy/initdb/01_init.sql` を使う
    (CREATE DATABASE/SCHEMA・サンプル業務テーブル・demo DB を含む開発専用)
- 必要な DB 権限(最小権限):
  - 初期セットアップ/DDL 追補の適用時のみ: 割り当てられたスキーマ内の
    `CREATE TABLE` / `ALTER TABLE`(DB 全体の `db_ddladmin` は不要)
  - 通常運用: ftool_app_ テーブルへの `db_datareader` + `db_datawriter` で足りる
  - 業務DB用の接続アカウント(設定>接続情報管理で登録するもの)は，
    対象テーブルの SELECT/INSERT/UPDATE/DELETE のみ付与(DDL 不要)
- 疎通確認(コンテナから):
  ```bash
  podman exec <backend> sh -c 'timeout 3 sh -c "exec 3<>/dev/tcp/db.example.local/1433" && echo OK || echo NG'
  ```
  接続文字列レベルの失敗は backend ログ(起動時/初回クエリ時)に出る

#### c. AD が外部(別セグメント/別拠点)の場合

```
LDAP_URL=ldaps://dc.example.local:636          # 推奨(LDAPS)
#  または LDAP_URL=ldap://dc.example.local:389 + LDAP_STARTTLS=true
LDAP_BASE_DN=DC=example,DC=local               # ユーザーを含む範囲
LDAP_BIND_DN=CN=svc-ldap,OU=Service,DC=example,DC=local
LDAP_BIND_PASSWORD=***
LDAP_USER_FILTER=(sAMAccountName=%s)
LDAP_ATTR_GUID=objectGUID
LDAP_GUID_FORMAT=ad-binary
```

- **バインド用サービスアカウント**は読み取り専用の専用アカウントにする。
  `LDAP_BIND_DN` は DN 形式のほか UPN(`svc-ldap@example.local`)でも可。
  **パスワード無期限(または失効前ローテーション運用)にする** —
  失効すると全ユーザーがログイン不能になる(§9 の「502」参照)。
  ローテーション手順: AD 側で変更 → `.env` 更新 → backend 再起動
- **DC の冗長化**: `LDAP_URL` は 1 つしか書けないため，単一 DC のホスト名ではなく
  **ドメイン名(例 `ldaps://example.local:636`)や DC 群を指すエイリアス**を使い，
  DNS 側で複数 DC に解決させるのを推奨(1台停止でログイン全滅を防ぐ)
- 2026 年以降の AD 既定では **LDAP 署名/チャネルバインディングが強制**される
  環境が多く，平文 `ldap://`(TLS なし)はバインド拒否されることがある。
  LDAPS か StartTLS を標準とする

#### d. 社内 CA 証明書の信頼(LDAPS / encrypt=true 共通)

LDAPS・SQL Server の TLS はコンテナ内の OS 信頼ストアで検証される。
社内 CA 発行の証明書を使っている場合は，backend イメージに CA を追加する:

```dockerfile
# backend の Dockerfile に追記(ベースが Debian/Ubuntu 系の場合)
COPY corp-root-ca.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
# Alpine 系: /usr/local/share/ca-certificates/ に置いて update-ca-certificates は同じ
```

追加後 `podman compose -f deploy/compose.yaml up -d --build` で再ビルド。
証明書エラーの典型ログ: `x509: certificate signed by unknown authority`。

---

## 2. 起動・停止・ログ

```bash
# 起動(ビルド込み)
podman compose -f deploy/compose.yaml up -d --build
# 停止
podman compose -f deploy/compose.yaml down
# 状態
podman ps
# ログ(障害調査の基本)
podman logs -f <backendコンテナ名>
podman logs -f <nginxコンテナ名>
```

- **Valkey 再起動 = 全ユーザーのセッションが消える**(全員再ログイン)。
  データは失われない。計画停止はユーザーが少ない時間帯に。
- rootless podman で :80 が使えない場合は compose の ports を `8081:80` 等へ。

### 2.1 簡易ヘルスチェック

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<host>/api/v1/auth/me   # 401 なら正常(未認証応答)
```
200/401 以外(000, 502, 500)なら backend か依存先(§9)を疑う。

---

## 3. 初期セットアップ(新規環境)

0. AD・SQL Server が外部サーバーの場合は，先に §1.2 に沿って
   FW・DNS・サービスアカウント・証明書(LDAPS / encrypt)を準備する。
1. DBA がアプリDB(例 `ftool`)とスキーマを作成した後，
   `deploy/initdb/prod-app-schema.sql` を
   `sqlcmd -v APP_SCHEMA=<スキーマ名> -i prod-app-schema.sql` で実行
   (スクリプトは冪等。再実行しても安全。`-v APP_SCHEMA=` は必須)。
   開発/検証環境(Podman)では代わりに `deploy/initdb/01_init.sql` を使う。
2. `CONN_ENC_KEY` を生成し安全に保管(§8.2):
   `openssl rand -base64 32`
3. `deploy/.env` に本番値を記入(§1.1。compose.yaml 冒頭のコメント参照)。
4. フロントをビルド:
   `make generate && make fe_install && make fe_build`
5. `podman compose -f deploy/compose.yaml up -d --build`
6. 管理者となるユーザーで一度ログイン(ftool_app_users に自動登録される)
   → SQL で最初の admin 権限を直接付与:
   ```sql
   -- deploy/initdb/02_grant_admin.sql.example を参考に，
   -- 対象ユーザーへ table-maint / settings(/history) の admin を MERGE で付与
   ```
7. 以後の権限付与は画面(設定>ユーザー権限)から行える。

---

## 4. 日常運用

### 4.1 ユーザーと権限

- ユーザーは**初回ログイン時に自動登録**(AD 認証成功時)。事前登録は不要。
- `AUTO_GRANT_TABLE_MAINT_VIEW=true` なら閲覧権限(table-maint:user)が自動付与。
- 権限変更: 設定 > ユーザー権限(ユーザー×機能のマトリクス。
  admin > maintainer > user，空欄 = 権限なし)。
  - table-maint: user=閲覧，maintainer+=行の編集/CSV取込
  - history: maintainer+ で閲覧
  - settings: admin のみ(settings 機能自体の無効化は不可=ロックアウト防止)
- 変更は監査履歴(`user-auth.set`)に記録される。

### 4.2 管理対象テーブルの登録・変更

設定 > テーブルメンテナンス設定 > 管理テーブル。

- **登録**: [テーブルを登録] → 接続先 → 候補(主キーの無いテーブルは選択不可)
  → カラムプレビューで**列モード**を指定 → 表示名・説明 → 登録
  - 列モード: 編集可 / 編集不可(updated_at 等は自動提案) /
    **除外**(SELECT 自体から外す。個人情報が入りうる列は必ず除外)
  - NOT NULL・既定値なしの列を除外すると新規行が作れなくなる(警告表示。
    画面側は[新規][CSV取込]が自動でグレーアウト)
- **変更**: 一覧の行をクリック → 表示名・説明・列モードを編集
  (接続先・実テーブルは変更不可。変えたい場合は登録解除→再登録)
- **表示切替**: 行の「表示」チェック(無効化=利用者から見えなくなる。データは無関係)
- **登録解除**: ゴミ箱アイコン。物理テーブルには一切影響しない
  (関連するテーブルカード・テンプレート項目は自動で消える)

### 4.3 接続(業務DB)の管理

設定 > テーブルメンテナンス設定 > 接続情報管理。

- **追加**: [接続を追加] → ホスト/ポート/DB/ユーザー/パスワード →
  [接続テスト]で疎通確認 → 保存(パスワードは暗号化保存)
- **スキーマ制限(任意)**: 発行アカウントの権限が特定スキーマ内に閉じている場合，
  登録ダイアログの「スキーマ制限」欄にそのスキーマ名を入力する。設定すると，
  この接続を使う管理テーブル登録は指定スキーマのテーブルしか候補に出ず(登録
  ダイアログのスキーマ絞り込みも固定表示・入力不可)，他スキーマでの登録は
  API 側でも拒否される。空欄 = 制限なし(全スキーマ)。編集で空にして保存すると
  制限解除できる
- **変更**: 行の編集。**DB 側でパスワードをローテーションしたら，ここで
  新パスワードを再入力**する(保存値は自動では追従しない)
- **無効化**: 接続を無効にすると，その接続配下のテーブルは
  「接続先データベースに接続できません(502)」になる
- **削除**: 配下の管理テーブル登録が残っていると削除できない(先に登録解除)
- 既定DB(アプリ自身のDB)は常に使用可能で，この画面の管理対象外
  (変更は `.env` の `MSSQL_DSN`)

### 4.4 ダッシュボードテンプレートの配布

設定 > ダッシュボード設定 > テンプレート。

- 作成/編集: 機能・テーブルカード・URL リンクを並べて保存。
  有効なテンプレートだけ利用者が選択できる
- ここで管理するのは**配布テンプレートのみ**。ユーザーの個人テンプレート
  (「現在の構成を保存」で作られる)は本人しか見えず，管理画面には出ない
- テンプレートを削除しても，選択していたユーザーは自動的に既定へ戻る

---

## 5. 接続先の変更(移設・切替)手順

### 5.1 業務DBサーバーの移設(接続先ホスト変更)

1. 移設先に同名スキーマ・テーブルを準備(データ移行は DB 管理者側の作業)
2. 設定 > 接続情報管理 で該当接続のホスト等を変更 → 接続テスト
3. 対象テーブルの画面を開き，データが見えることを確認
   (メタデータは毎回カタログから取得するため，列構成が同じなら追加作業なし)

### 5.2 アプリDB(ftool_app_ テーブル)の移設

1. 計画停止(backend 停止)
2. 旧サーバーの ftool_app_ テーブル群をバックアップ → 新サーバーへ復元
3. `.env` の `MSSQL_DSN` を新サーバーへ変更
4. `podman compose -f deploy/compose.yaml up -d` → ログイン・権限・履歴を確認

### 5.3 AD(認証基盤)の変更

`.env` の `LDAP_*` を変更して backend 再起動。
**注意**: ユーザーの同一性は GUID(`LDAP_ATTR_GUID`)で管理している。
ディレクトリ移行で GUID が変わる場合，権限・ダッシュボード項目
(`ftool_app_user_dash_items`)・個人テンプレートの紐付けが切れる。移行時は
`ftool_app_users.object_guid` の新旧対応表を作り UPDATE する計画を立てること
(未対応のまま移行するとユーザーは「初回ログイン扱い」になり閲覧権限のみ，
ダッシュボードは空になる)。

### 5.4 Valkey の変更

`REDIS_ADDR` を変更して再起動。セッションのみなので移行不要
(切替時点で全員再ログイン)。

---

## 6. 監査履歴(操作履歴)の運用

- 記録対象: ログイン/ログアウト(失敗含む)，行の追加・更新・削除
  (**更新・削除は前後値**。1バッチ100行超は打ち切りフラグ)，CSV 出力
  (rows.export / history.export = データ持ち出し)，設定変更，権限変更，
  テンプレート・カード操作。履歴は**アプリからは削除・変更不可**
- 閲覧: 操作履歴画面(history:maintainer+)。全列フィルタ
  (日時は JST の期間指定)+ CSV 出力(summary 列 = 日本語要約，
  detail 列 = JSON 全文)
- Excel で detail(JSON)を分析する場合は Power Query の JSON 展開が使える
- **IP に IPv4/IPv6 が混在する**のは仕様(クライアントが接続に使った
  アドレスファミリーをそのまま記録。localhost は ::1 になりがち)
- 保持期間: 現状は無期限。規程が決まり次第，アーカイブテーブル+定期移動
  ジョブを実装予定(数百万行から COUNT/LIKE が重くなる見込み)。
  当面のサイズ監視: `SELECT COUNT(*) FROM dbo.ftool_app_operation_history;`

---

## 7. バックアップ・リストア

| 対象 | 方法 | 備考 |
|---|---|---|
| アプリDB(ftool_app_ テーブル群) | SQL Server の標準バックアップに含める | 設定・権限・**監査履歴**を含む。最重要 |
| `deploy/.env` | 安全な場所に複製 | 特に `CONN_ENC_KEY`(§8.2) |
| 業務DB | 各DBの管理者運用に従う | 本ツールの管理外 |
| Valkey | 不要 | セッションのみ(消えても再ログインで済む) |
| フロント成果物 | 不要 | ソースから再ビルド可能 |

リストア: アプリDBを復元 → `.env` を配置 → compose up。
`CONN_ENC_KEY` が復元できない場合，接続パスワードだけは復号不能なので
全接続を UI から再入力する。

---

## 8. セキュリティ運用

### 8.1 データ分類(重要)

本ツールは**財務関連データ・個人情報を扱わない**前提で運用する。

- 個人情報・機微情報を含むテーブルは登録しない(登録ダイアログに注意文あり)
- 一部の列だけに個人情報が入りうる場合は，その列を**除外(hidden)**で登録する
  (画面・CSV・監査履歴のどこにも現れない)
- リンク名・テンプレート名などの自由入力欄に個人情報を書かない
  (入力値は監査履歴に残り，削除できない)
- 分類が変わる(財務・個人情報を扱う)場合は再設計が必要
  (前後値は記録済みだが，改ざん耐性・閲覧ログ・保持規程などの追加対応)
- **財務データを扱う場合の必須条件**: 対象テーブルを SQL Server の
  **Temporal Table(システムバージョン管理)にすること**。
  アプリの操作履歴は前後値を 1 バッチ 100 行までしか全量記録しない上，
  アプリ経由以外の変更を捕捉できず，改ざん耐性も DB エンジンに劣るため，
  アプリ側をどれだけ拡張しても値の完全な変更証跡は担保できない。
  役割分担は「誰が・いつ・どの操作で・どのキーを = アプリ監査 /
  全行の前後値・改ざん耐性 = temporal 履歴」とし，時刻+主キーで突合する。
  保持年限は `HISTORY_RETENTION_PERIOD` で規程に合わせて設定する

### 8.2 CONN_ENC_KEY の管理

- 接続パスワードの暗号鍵。**漏えいすると DB 資格情報が危険，紛失すると
  接続パスワードが全滅**(再入力すれば復旧は可能)
- パスワード管理庫等で保管し，`.env` の権限を絞る。
  ローテーションする場合は「新鍵で起動 → 全接続のパスワード再入力」

### 8.3 HTTPS 化の手順(社内CAがある場合)

HTTPS 化で必要なのは TLS 証明書まわりのみ(ユーザー認証=LDAP のロジックは
無変更)。関係する方向は3つある:

| 方向 | 必要な作業 |
|---|---|
| ① F-tool がサーバー(利用者→nginx) | **社内CA(AD CS 等)にサーバー証明書を発行してもらい nginx に設定**(下記) |
| ② 利用者PCが社内CAを信頼 | ドメイン参加PCなら GPO で配布済みが通常。**確認のみ** |
| ③ F-tool がクライアント(backend→LDAPS / SQL encrypt) | コンテナに社内CAを追加(§1.2d)。①②とは別作業 |

①の具体手順:

1. アクセスに使う FQDN(例 `ftool.example.local`)を決め，DNS 登録。
   社内CAに CSR を提出して発行(**SAN にその FQDN を含める**こと。
   有効期限と更新運用も確認)
2. 証明書と秘密鍵をホストに配置し，`deploy/compose.yaml` の nginx サービスに
   マウント+443 を公開:
   ```yaml
   ports:
     - "443:443"
     - "80:80"        # リダイレクト用に残す
   volumes:
     - ./nginx/certs:/etc/nginx/certs:ro,z
   ```
3. `deploy/nginx/default.conf` に 443 の server ブロックを追加し，
   80 は 443 へリダイレクト:
   ```nginx
   server {
       listen 80;
       server_name ftool.example.local;
       return 301 https://$host$request_uri;
   }
   server {
       listen 443 ssl;
       server_name ftool.example.local;
       ssl_certificate     /etc/nginx/certs/ftool.crt;
       ssl_certificate_key /etc/nginx/certs/ftool.key;
       # 以下，既存の location / と /api/ の設定をそのまま移す
   }
   ```
4. `.env` で `COOKIE_SECURE=true` にして再起動
   (`podman compose -f deploy/compose.yaml up -d --build`)
5. 確認: `https://ftool.example.local` に**証明書警告なし**でログインできること，
   `http://` が https へリダイレクトされること
6. 証明書の**期限切れ前更新**を運用カレンダーに登録(切れると全員アクセス不能)

### 8.4 その他

- HTTPS 終端を用意し `COOKIE_SECURE=true` にする(手順は §8.3)
- `LDAP_MOCK` は本番で必ず false
- 管理者(settings:admin)は最小人数に。付与・剥奪は監査履歴で追跡できる

### 8.5 監査履歴 detail の退避(MinIO，任意機能)

監査履歴(`ftool_app_operation_history.detail`)は 1 バッチ 100 行までしか
前後値を全量記録しないが，それでも大量バッチの insert 内容(件数分の
リクエスト値そのもの)自体は detail に含まれるため，まれに 1MB を
超えることがある。超過分は claim check パターンで MinIO へ退避し，
detail 列には `{"truncated":true,"overflowKey":"..."}` という参照だけを
残す(履歴画面の「全文を表示」で backend 経由取得できる)。

`MINIO_ENDPOINT` を設定しない限りこの機能は無効(従来通り超過分は破棄)。
有効化する場合の注意点:

- **認証情報**: `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` は `CONN_ENC_KEY` と
  同様に扱う(コミットしない，`.env` 経由，パスワード管理庫で保管)
- **単一ノードなので可用性は限定的**: 開発/本番とも MinIO は1ノード構成。
  退避先が落ちている間は監査そのものは best-effort のまま止まらないが，
  該当分は退避もできず detail に `overflowError` が残り**全文は失われる**
  (本体の履歴行自体は残る)
- **アクセス経路**: ブラウザに直接 MinIO を触らせない。backend が
  サーバーサイドで Put/Get する設計のため，MinIO はネットワーク的に
  内部限定のままでよい(prod の compose では `expose` のみで `ports` は無い)
- **バックアップ**: MinIO のデータボリューム(`minio-data`)も
  SQL Server 同様にバックアップ対象に含めること(§7)。含めないと
  退避された全文だけが災害復旧で失われる
- **保持期間**: 現状ライフサイクルルール(自動削除)は未設定。
  本体の履歴保持期間の規程化(§8.1 に関連する残課題)と合わせて
  今後 MinIO バケットのライフサイクルルールも検討する
- **暗号化/機密性**: 現状のデータ分類(§8.1，財務・個人情報を扱わない前提)
  では必須要件にしていない。分類が変わる場合はサーバーサイド暗号化(SSE)を
  検討する

---

## 9. 障害対応(症状別)

| 症状 | 原因の当たり | 対処 |
|---|---|---|
| ログイン画面で「認証サービスに接続できません」等(502) | AD/LDAP に到達できない，バインド失敗 | backend ログの `ldap:` 行を確認。`LDAP_URL`/バインド資格情報/FW を確認 |
| 全ユーザーが一斉にログイン不能(502) | **バインド用サービスアカウントのパスワード失効/ロック** | AD 側で解除・再設定 → `.env` 更新 → backend 再起動(§1.2c) |
| ログに `x509: certificate signed by unknown authority` | LDAPS / `encrypt=true` の証明書がコンテナで未信頼 | 社内 CA をイメージに追加して再ビルド(§1.2d) |
| ログに `dial tcp ...: i/o timeout` / `no such host` | 外部サーバーへの FW 未開放 / コンテナから DNS が引けない | §1.2a のポート表で FW 確認。DNS 不可なら `extra_hosts` か IP 直書き |
| ログインは通るが権限が何もない | 初回ログイン扱い(GUID 変化)か権限未付与 | 設定>ユーザー権限で付与。AD 移行後なら §5.3 の GUID 突合 |
| 特定テーブルだけ「接続先データベースに接続できません」(502) | その業務DB接続が落ちている/無効/資格情報失効 | 設定>接続情報管理で接続テスト。パスワード失効なら再入力 |
| 全テーブルで 500/502 | アプリDB(MSSQL_DSN)に接続できない | backend ログ確認，SQL Server 稼働・資格情報を確認 |
| 全員が突然ログアウトされた | Valkey 再起動/接続断 | 仕様(セッション非永続)。Valkey の稼働を確認 |
| 突然英語/日本語が混ざる・生キー表示 | フロント資産のキャッシュ不整合 | ハードリロード(Ctrl+F5)。続くなら再ビルド・再デプロイ |
| タブのファビコンが出ない | favicon.svg が壊れている(不正 XML) | `/favicon.svg` を直接開いてエラーが出ないか確認 |
| 画面は出るが API が全部 401 | セッション切れ(TTL 30分) | 再ログイン。頻発するなら `SESSION_TTL_MIN` を見直し |
| 保存時に「主キー(または一意制約)が重複しています」 | データ起因(重複キー) | 利用者操作の問題。CSV 取込ならマージ画面で該当行を除去 |
| 「他のユーザーが先に変更しています」(409) | 楽観ロック衝突(rowversion) | 再読込してやり直し(正常動作) |

調査の基本手順:
1. `podman ps` でコンテナ稼働確認
2. `podman logs <backend>` でエラー行(`httpapi:` / `ldap:` / SQL エラー)を確認
3. 操作履歴画面で failure 行を確認(誰の・どの操作で失敗したか)
4. 依存先(SQL Server / AD / Valkey)へ個別に疎通確認

---

## 10. バージョンアップ(改修版の反映)

1. リリース物を確認(修正・改修手順書 §6 のチェックがすべて済んでいること)
2. アプリDBをバックアップ
3. DDL 追補(あれば)を適用 — 本番は `prod-app-schema.sql`，開発/検証は
   `01_init.sql` を再実行(いずれも追補ブロックは冪等)
4. `make generate && make fe_install && make fe_build`
5. `podman compose -f deploy/compose.yaml up -d --build`
6. 動作確認: ログイン → 主要画面 → 当該変更点 → 操作履歴に記録が残ること
7. 問題があれば: 旧イメージへ戻す + (DDL は追加列/テーブルのみなら
   そのままでも旧バージョンは動作する設計。破壊的 DDL は原則行わない)
