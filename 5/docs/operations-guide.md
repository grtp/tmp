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
- タイムゾーン: DB 保存は UTC,画面・CSV の日時表示は JST。

### 1.1 設定ファイル(backend)

設定は **`deploy/.env`** に集約する。開発機の **`deploy/.env.dev`** と
キーの並び・意味は完全に同じで,値だけが違う(本番=AD,開発=OpenLDAP の
差も `LDAP_*` の値で吸収する)。ひな形とキーごとの説明は
**`deploy/.env.example`** にあり,これをコピーして本番値を書く:

```bash
cp deploy/.env.example deploy/.env && vi deploy/.env
```

読み込み経路は本番と開発で違うが,ファイルの形は同じ:

- 本番: `compose.yaml` の `env_file:` が `.env` を読み backend へ渡す
- 開発: `make be_serve` が `ENV_FILE=../deploy/.env.dev` を指定し,
  backend 自身が読む(`backend/internal/config/envfile.go`)

`ADDR` と `REDIS_ADDR` はコンテナ構成上の固定値のため compose の
`environment:` が渡す(`environment` は `env_file` より優先されるので,
`.env` 側に同名キーがあっても本番の動作は変わらない)。
環境変数が設定済みならファイルより優先される — 一時的な切り替えは
`LDAP_MOCK=true make be_serve` のように環境変数で行う。

### 1.1b 環境変数一覧(backend)

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
| `TRUSTED_PROXIES` | (空) | `X-Forwarded-For` を信じる前段の CIDR/IP。本番は `10.89.0.0/24`(§1.3) |
| `LOG_FORMAT` / `LOG_LEVEL` | text / info | ログ形式(text/json)とレベル(§2.0) |

### 1.2 外部サーバー(AD / 設定用DBサーバー)への接続設定

AD と SQL Server(設定用のアプリDBを含む)はコンテナ外の既存サーバーを使う
構成が標準。別セグメント・別拠点のサーバーを使う場合は以下を設計・設定する。

#### a. ネットワーク要件(FW 申請の一覧)

| 通信 | 方向 | ポート | 備考 |
|---|---|---|---|
| backend → 設定用DB(アプリDB) | コンテナホスト → SQL Server | TCP 1433(または固定した任意ポート) | **動的ポートは使わず固定ポートにする**(SQL Browser UDP 1434 に依存させない) |
| backend → 業務DB(接続管理で登録する各サーバー) | 同上 | 各サーバーのポート | 接続を追加するたびに FW も追加 |
| backend → AD | コンテナホスト → DC | TCP 636(LDAPS 推奨)/ 389(LDAP+StartTLS) | 平文 389 は閉域でのみ |
| 利用者 → nginx | クライアント → コンテナホスト | `.env` の `FRONTEND_PORT`(環境A の例: 80 や 8031。環境B はホスト nginx の listen) | 下記「ホスト firewalld」参照 |

- **ホスト firewalld(内向き)**: podman の公開ポートは DNAT(PREROUTING)で
  転送されるため INPUT を通らず,**firewalld のゾーン設定に関係なく外から
  届くことが多い**(netavark が許可ルールを挿入する)。「開けなければ通らない」
  前提で待たず,**別 PC からの実測で判定する**こと
  (`curl http://<IP>:<PORT>/api/v1/auth/me` が 401 なら到達)。
  届かない場合のみ `firewall-cmd --permanent --add-port=<PORT>/tcp` +
  `firewall-cmd --reload`。SELinux 側の作業(semanage port 等)は不要
  (コンテナのポート公開は confined ホストサービスの制約を受けない)
- **外向き**は firewalld の既定では制限されない(ホスト側の作業なし)。
  上の表の FW 申請はサーバー間のネットワーク FW に対するもの
- コンテナからの**名前解決**: ホスト名(FQDN)を使う場合はコンテナが社内 DNS を
  引けること。引けない環境では `deploy/compose.yaml` の backend サービスに
  `extra_hosts:`(`"db.example.local:10.0.0.5"` 形式)を追加するか,IP 直書きにする
- 時刻同期: 監査履歴の整合のため,コンテナホストは NTP で同期しておく

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
  (この場合のみ SQL Browser UDP 1434 が必要になるため,可能なら固定ポート運用を推奨)
- **経路の暗号化**: 外部サーバーへは `encrypt=true` を付ける。サーバー証明書が
  社内 CA の場合はコンテナに CA を信頼させる(下記 d)。暫定として
  `&trustservercertificate=true` で検証をスキップできるが,恒久運用にはしない
- **本番の標準構成(2026-07時点)**: DB・スキーマの作成は DBA が行う。
  backend の接続アカウントは SQL Server 認証で,権限は DBA が用意した
  特定スキーマ内に閉じている(`CREATE SCHEMA` / `CREATE DATABASE` 権限は無い)。
  DB が `dbo` 以外の専用スキーマを割り当てた場合の初期セットアップ手順:
  1. DBA が DB とスキーマを作成し,接続アカウントへそのスキーマ内の
     `CREATE TABLE` / `ALTER TABLE` 権限(初期構築時のみ)と
     `db_datareader` + `db_datawriter`(通常運用)を付与
  2. `deploy/initdb/prod-app-schema.sql` を
     `sqlcmd -S <host> -d <db> -U <user> -P <password> -v APP_SCHEMA=<スキーマ名> -i prod-app-schema.sql`
     で適用する(`CREATE DATABASE` / `CREATE SCHEMA` / サンプルデータを含まない,
     ftool_app_* テーブルのみの DDL。`-v APP_SCHEMA=` の指定は必須で,省略時は
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
  - 業務DB用の接続アカウント(設定>接続情報管理で登録するもの)は,
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
- **DC の冗長化**: `LDAP_URL` は 1 つしか書けないため,単一 DC のホスト名ではなく
  **ドメイン名(例 `ldaps://example.local:636`)や DC 群を指すエイリアス**を使い,
  DNS 側で複数 DC に解決させるのを推奨(1台停止でログイン全滅を防ぐ)
- 2026 年以降の AD 既定では **LDAP 署名/チャネルバインディングが強制**される
  環境が多く,平文 `ldap://`(TLS なし)はバインド拒否されることがある。
  LDAPS か StartTLS を標準とする

#### d. 社内 CA 証明書の信頼(LDAPS / encrypt=true 共通)

LDAPS・SQL Server の TLS はコンテナ内の OS 信頼ストアで検証される。
社内 CA 発行の証明書を使っている場合は,backend イメージに CA を追加する:

```dockerfile
# backend の Dockerfile に追記(ベースが Debian/Ubuntu 系の場合)
COPY corp-root-ca.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
# Alpine 系: /usr/local/share/ca-certificates/ に置いて update-ca-certificates は同じ
```

追加後 `podman compose -f deploy/compose.yaml up -d --build` で再ビルド。
証明書エラーの典型ログ: `x509: certificate signed by unknown authority`。

### 1.3 既に nginx が動いているサーバーへ入れる場合

`deploy/compose.yaml` は nginx コンテナごと一式を持つが,ホスト側に別の
nginx が既にいる本番もある。その場合は **ホスト nginx を受け口にして
コンテナ nginx へ転送する**(2段のリバースプロキシ)。SPA の配信規則や
キャッシュはコンテナ側に閉じたままなので,環境ごとに書き写すのは
転送設定の1ファイルだけで済む。

1. `deploy/.env` を環境B の既定のままにする(`FRONTEND_BIND=127.0.0.1` /
   `FRONTEND_PORT=8081` / `NGINX_CONF=default.conf`)
   — コンテナ nginx はホストの 8081 で待つ。3項目の対応は §1.3a の表
2. ひな形をホスト nginx へ置き,listen / ホスト名 / 転送先を直す

```bash
cp deploy/nginx/host-frontend.conf.example /etc/nginx/conf.d/ftool.conf
vi /etc/nginx/conf.d/ftool.conf   # listen(既定 8082)/ server_name / proxy_pass のポート
nginx -t && systemctl reload nginx
```

ひな形の既定は IP アクセス想定(`listen 8082;` + `server_name _;`)なので,
利用者のアクセス先は `http://<IP>:8082/` になる。FQDN 運用にする場合は
`listen 80;` + `server_name <FQDN>;` へ差し替える(§1.3a)。

注意点:

- **サブパスに間借りさせない**。SPA は `<base href="/">`,セッション Cookie も
  `Path=/` のため,`/ftool/` のような配置は base href を変えた再ビルドが必要になり,
  Cookie も同居アプリと衝突する。専用のホスト名(バーチャルホスト)を割り当てる
- **`client_max_body_size` は両方の nginx に書く**。外側の上限が先に効くため,
  コンテナ側だけ広げても CSV 一括取込が 413 で弾かれる(既定 1MB)
- **`X-Forwarded-For` は各段で `$proxy_add_x_forwarded_for` を使う**。
  操作履歴の `client_ip` はこのヘッダから解決される(上書きすると実 IP が消える)
- CSV 出力はストリーミングのため `proxy_read_timeout` を延ばし
  `proxy_buffering off` にする(両方の nginx に同じ値)
- HTTPS をホスト nginx で終端するなら `.env` の `COOKIE_SECURE=true` を忘れない

#### 操作履歴の client_ip について(2026-07-29 本番想定試験で確認)

監査履歴の `client_ip` は `X-Forwarded-For` から解決される。backend は
前段プロキシを信頼する前提なので,**受け口の置き方で記録される IP が変わる**。

- **公開ポートは外部クライアントの送信元 IP を保持する**(podman rootful +
  netavark で実測。DNAT のみで masquerade されない)。したがってコンテナ
  nginx を単独で LAN へ出す構成でも,実クライアントの IP は取れる
  - 例外は **ホスト自身から**(`127.0.0.1`)と **同一ネットワークのコンテナから**
    のアクセスで,この2つだけ hairpin の masquerade が効いてブリッジの
    ゲートウェイ(例 `10.89.2.1`)になる。ホスト上で `curl localhost` して
    確認すると必ずゲートウェイに見えるので,**疎通確認の結果を
    「IP が取れていない」と誤読しないこと**
  - rootless podman はポート転送の方式(rootlesskit / pasta)によって
    送信元が書き換わることがある。構成を変えたら §2.1 の手順で実測する
- **`TRUSTED_PROXIES` で前段を限定する**(2026-07-29 追加)。ここに載っている
  相手から来た `X-Forwarded-For` だけを信じ,それ以外は無視して接続元を使う。
  本番は compose で固定したコンテナ用サブネット `10.89.0.0/24`,前段の無い
  開発は空(=どのプロキシも信じない)。**空だと gin の既定は全信頼になり,
  クライアントが送った値がそのまま監査に載る**ため必ず設定すること。
  設定値は起動ログに出る(`msg="trusted proxies" cidrs=...`)
  - **広げすぎない**。社内 LAN のアドレスを含めると(例 `10.0.0.0/8`),
    実クライアントをプロキシと誤認して読み飛ばし,その左にある
    クライアント申告値を採用してしまう。詐称対策が無効になる
  - compose はネットワークのサブネットを固定してある。podman の既定は
    プールから作成順に /24 を切り出すため,固定しないと作り直しで
    `10.89.1.x` 等へずれ,`TRUSTED_PROXIES` から外れる
  - 実測(2026-07-29): 外部ホストから `X-Forwarded-For: 192.0.2.77` を
    偽装してログインしたが,記録されたのは実際の送信元だった
  - 残る穴として,**コンテナホスト自身から**の要求は hairpin で送信元が
    ゲートウェイ(=信頼範囲内)になるため,偽装値が採用される。
    悪用にはサーバーへのシェルアクセスが要るため許容している
- **信頼境界では `X-Forwarded-For` を上書きする**。ひな形は
  `proxy_set_header X-Forwarded-For $remote_addr;` にしてある。
  ここを `$proxy_add_x_forwarded_for`(追記)にすると,クライアントが自分で
  送った偽の値が残る(`TRUSTED_PROXIES` を正しく設定していれば無視されるが,
  二重の防御として上書きしておく)
- **確認方法**: 別の PC からログインし,設定 > 操作履歴の `client_ip` が
  その PC の IP になっていることを見る。ホスト上からの `curl` では
  上記の理由でゲートウェイになるため確認にならない
- コンテナ nginx の公開先は既定で `127.0.0.1`(`FRONTEND_BIND`)。
  前段を経由せず直接叩かれる経路を塞ぐため。単独で LAN へ出す場合は
  下記「環境A」の3点セットで切り替える

### 1.3a 受け口の構成(環境A / 環境B)

前段にホスト nginx が居るかどうかで, `.env` の3項目をセットで切り替える。
**`X-Forwarded-For` の扱いが変わるため conf ファイルを手編集せず,
`NGINX_CONF` で丸ごと差し替える**(切り替え漏れによる詐称穴を防ぐ。
2つの conf の差分はその1行だけ)。

| | 環境A: コンテナ nginx が唯一の受け口 | 環境B: 前段にホスト nginx(既定) |
|---|---|---|
| `FRONTEND_BIND` | `0.0.0.0` | `127.0.0.1` |
| `FRONTEND_PORT` | `80` | `8081` |
| `NGINX_CONF` | `standalone.conf` | `default.conf` |
| `X-Forwarded-For` | `$remote_addr`(standalone.conf 内) | `$proxy_add_x_forwarded_for`(前段が確定済み) |
| 信頼境界 | コンテナ nginx | ホスト nginx |
| ホスト nginx 設定 | 不要 | `host-frontend.conf.example` を配置 |
| 利用者のアクセス先 | `http://<IP>/` | `http://<IP>:8082/` |

環境A で `FRONTEND_PORT=80` が使えない場合 — ホストの別スタック(既存の
podman nginx 等)に取られている, または rootless podman で 1024 未満を
直接使えない — は, 空いているポート(例 8031)を `FRONTEND_PORT` に指定する。
**変更はこの1箇所だけ**: nginx conf の `listen 80` はコンテナ内ポートなので
触らない(compose の `"BIND:PORT:80"` の右辺と対応)。利用者のアクセス先と
ヘルスチェックの URL が `http://<IP>:8031/` に変わるだけ。
空きの確認: `ss -ltnp | grep -E ':(80|8031)\b'`

環境B のホスト nginx 側は次の手順:

```bash
# 置く前に include 構造を確認(conf.d ではなく sites-enabled の場合がある)
nginx -T | grep -E "include|server_name|listen" | head -30

cp deploy/nginx/host-frontend.conf.example /etc/nginx/conf.d/ftool.conf
vi /etc/nginx/conf.d/ftool.conf    # listen / server_name / 転送先ポートを確認
nginx -t && systemctl reload nginx
```

既存ファイルへ追記するのではなく**独立した conf として置く**(F-tool の変更・
撤去が1ファイルで済み, 既存アプリの設定を触らずにすむ)。

**DNS を使わず IP でアクセスする場合**: ひな形は `listen 8082;` +
`server_name _;`(任意のホスト名にマッチ)にしてある。既存アプリと同じ
IP の `:80` を共有すると, ホスト名が無いため nginx が振り分けられない
(既存 server が `default_server` なら IP アクセスはそちらへ吸われる)。
そのため専用ポートで受ける。サブパス(`/ftool/`)での相乗りは SPA の
`<base href="/">` 再ビルドとセッション Cookie の衝突を招くため不可。
将来 DNS 名を割り当てる場合は `listen 80;` + `server_name <FQDN>;` に
書き換えるだけでよい(base href と Cookie はホスト名に依存しない)。

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

### 2.0 ログの読み方

backend のログは `key=value` 形式(`LOG_FORMAT=json` で JSON へ切替可)。
**1リクエストに1つ `request_id` が振られ**,アクセスログとハンドラ内の
エラーログが同じ ID で並ぶ。応答ヘッダ `X-Request-Id` にも同じ値が入るため,
利用者から「エラーが出た」と言われたら,ブラウザの開発者ツールで
このヘッダを控えてもらうと該当リクエストだけを追える。

```
time=... level=INFO  msg=request request_id=f30c11af1d5f452f method=POST path=/api/v1/auth/login status=200 duration_ms=25 client_ip=10.0.0.12
time=... level=ERROR msg="handler failed" request_id=ab12... op="list users" err="..."
```

- ステータス 4xx は WARN,5xx は ERROR で出るので `level=ERROR` を追えば異常だけ拾える
- 業務データそのもの(SQL の引数・行の中身)はログに出さない方針。
  「誰が何をしたか」は操作履歴(§5)側で追う
- `LOG_LEVEL`(既定 info)を debug にすると量が増える。常用しない


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

ビルド環境と本番環境を分けた**通しのコマンド列**は README の
「本番デプロイ」節にまとまっている。ここは各手順の背景と注意点を述べる。

0. AD・SQL Server が外部サーバーの場合は,先に §1.2 に沿って
   FW・DNS・サービスアカウント・証明書(LDAPS / encrypt)を準備する。
1. DBA がアプリDB(例 `ftool`)とスキーマを作成した後,
   `deploy/initdb/prod-app-schema.sql` を
   `sqlcmd -v APP_SCHEMA=<スキーマ名> -i prod-app-schema.sql` で実行
   (スクリプトは冪等。再実行しても安全。`-v APP_SCHEMA=` は必須)。
   開発/検証環境(Podman)では代わりに `deploy/initdb/01_init.sql` を使う。
2. `CONN_ENC_KEY` を生成し安全に保管(§8.2):
   `openssl rand -base64 32`
3. `deploy/.env` に本番値を記入(§1.1。compose.yaml 冒頭のコメント参照)。
4. イメージを用意する。ネットワークのある環境なら
   `podman compose -f deploy/compose.yaml build`。
   本番がオフライン(npm/Go モジュール・レジストリへ出られない)なら §3.1。
5. `podman compose -f deploy/compose.yaml up -d`
   (この場でビルドし直す場合のみ `--build` を付ける)
6. 管理者となるユーザーで一度ログイン(ftool_app_users に自動登録される)
   → SQL で最初の admin 権限を直接付与:
   ```sql
   -- deploy/initdb/02_grant_admin.sql.example を参考に,
   -- 対象ユーザーへ table-maint / settings(/history) の admin を MERGE で付与
   ```
7. 以後の権限付与は画面(設定>ユーザー権限)から行える。

### 3.1 オフライン環境への配布(podman save / load)

本番サーバーが npm レジストリ・Go モジュールプロキシ・コンテナレジストリへ
出られない場合は, **ネットワークのある環境でイメージを作り, tar で持ち込む**。
backend も frontend もマルチステージビルドで完結しているので, 本番側に
必要なのは **podman と deploy/ 配下だけ**(Node も Go も git も不要)。

**タグは日付にする**(`:latest` にしない)。本番に何が入っているか追えなく
なるため。`.env` の `IMAGE_TAG` と, save/load で使う値を必ず一致させる。

ビルド環境(例: WSL)で:

```bash
IMAGE_TAG=2026-07-30_143005 podman compose -f deploy/compose.yaml build
```

```bash
podman save --multi-image-archive -o ftool-2026-07-30.tar localhost/ftool-backend:2026-07-30 localhost/ftool-frontend:2026-07-30 docker.io/valkey/valkey:8-alpine docker.io/minio/minio:latest
```

`--multi-image-archive` は必須。付けないと**最初の1イメージしか保存されない**
(サイズで気付ける: 4イメージなら約 278MB, backend だけだと約 17MB)。
MinIO を使わない構成(`MINIO_ENDPOINT` を空にする)なら
`docker.io/minio/minio:latest` を外してよい(-168MB)。

本番サーバーで:

```bash
podman load -i ftool-2026-07-30.tar
```

あとは `deploy/` 配下(`compose.yaml` / `nginx/` / `.env`)を配置し,
`.env` の `IMAGE_TAG` を tar と同じ日付にして `podman compose up -d` する
(**`--build` は付けない**。付けるとビルドを試みて失敗する)。

イメージサイズの実測(2026-07-30):

| イメージ | サイズ | 備考 |
|---|---|---|
| ftool-backend | 17.6 MB | distroless + Go バイナリ |
| ftool-frontend | 54.7 MB | nginx:alpine + SPA 成果物 |
| valkey | 42.7 MB | |
| minio | 176 MB | 既定で有効(§8.5) |
| **配布 tar 合計** | **278 MB** | MinIO 抜きなら 110 MB |

ビルド用の `golang:1.25-alpine`(228MB)や `node:24-alpine` は
ビルド環境にしか要らないので転送不要。

### 3.2 SQL Server の初期構築(スキーマ・専用ログイン・権限)

DB だけ用意され,**スキーマより下は自分で作る**場合の手順。スキーマも DBA が
用意してくれる運用なら,`prod-app-schema.sql` の適用だけでよい。

`deploy/initdb/00_setup_principals.sql.example` を使う(冪等。再実行可)。
CREATE SCHEMA / CREATE LOGIN / GRANT を行うため,**実行者には db_owner 相当と
サーバーレベルの CREATE LOGIN 権限が要る**(通常は DBA が実行)。

```bash
sqlcmd -S <host> -d <db> -U <管理アカウント> -P <password> -v DB_NAME=<db> APP_SCHEMA=<スキーマ名> APP_LOGIN=svc_ftool APP_PASSWORD='<強いパスワード>' BIZ_SCHEMA=<業務テーブルのスキーマ> -i deploy/initdb/00_setup_principals.sql
```

変数はすべて `-v` で必須にしてある(既定値を持たせると `dbo` 決め打ちでの
誤実行に気付けないため。指定を忘れると sqlcmd が停止する)。

**付与する権限**(`db_datareader` / `db_datawriter` は使わない — 対象外の
テーブルまで読み書きできてしまうため,スキーマ単位で絞る):

| 範囲 | 権限 | 理由 |
|---|---|---|
| アプリのスキーマ | SELECT / INSERT / UPDATE / DELETE | `ftool_app_*` の読み書き |
| アプリのスキーマ | ALTER, REFERENCES | `prod-app-schema.sql` をこのアカウント自身で適用するため。外部キーがあるので REFERENCES も要る |
| データベース | CREATE TABLE | **スキーマ単位ではなくDB単位の権限**。ALTER ON SCHEMA と両方揃って初めてテーブルを作成できる |
| 業務テーブルのスキーマ | SELECT / INSERT / UPDATE / DELETE | テーブルメンテナンスの対象。**構造は変更させない**(DDL は与えない) |

DDL を DBA が毎回代行する運用にできるなら,ALTER / REFERENCES / CREATE TABLE を
外して DML だけにしてよい(その場合 `prod-app-schema.sql` は DBA が実行する)。

**カタログ参照の権限は不要**。列定義・主キー・rowversion の有無は実行時に
`sys.columns` / `INFORMATION_SCHEMA` から取得するが,SQL Server はメタデータの
可視性を権限に連動させるため,SELECT 権限を持つオブジェクトは追加の GRANT なしで
見える。逆に権限の無いテーブルは**登録候補にも出ない**(意図した挙動)。
`VIEW DEFINITION` は与えない — 与えると権限の無いテーブルまで定義が見える。

**DENY は書かない**。SQL Server では DENY が GRANT より優先されるため,
「削除防止のつもりで」`DENY CONTROL ON SCHEMA` を書くと,CONTROL に含まれる
SELECT / INSERT なども巻き添えで拒否されアプリが動かなくなる。最小権限とは
**付与しないこと**であって,拒否を足すことではない。スキーマの所有者は
実行者(DBA)のままなので,アプリのアカウントから DROP SCHEMA はできない。

実機検証済み(2026-08-02, SQL Server 2022):

- svc_ftool 自身で `prod-app-schema.sql` を適用し 9 テーブルすべて作成できた
- 権限の無いスキーマのテーブルは `INFORMATION_SCHEMA.TABLES` に**現れず**,
  直接 SELECT すると `The SELECT permission was denied`
- 業務スキーマは INSERT / SELECT が通り,`DROP TABLE` は拒否された
- 業務スキーマが未作成の場合,GRANT はスキップされ警告を出して完走する
  (後から GRANT だけを単独で実行すればよい)

---

## 4. 日常運用

### 4.1 ユーザーと権限

- ユーザーは**初回ログイン時に自動登録**(AD 認証成功時)。事前登録は不要。
- `AUTO_GRANT_TABLE_MAINT_VIEW=true` なら閲覧権限(table-maint:user)が自動付与。
- 権限変更: 設定 > ユーザー権限(ユーザー×機能のマトリクス。
  admin > maintainer > user,空欄 = 権限なし)。
  - table-maint: user=閲覧,maintainer+=行の編集/CSV取込
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
- **スキーマ制限(任意)**: 発行アカウントの権限が特定スキーマ内に閉じている場合,
  登録ダイアログの「スキーマ制限」欄にそのスキーマ名を入力する。設定すると,
  この接続を使う管理テーブル登録は指定スキーマのテーブルしか候補に出ず(登録
  ダイアログのスキーマ絞り込みも固定表示・入力不可),他スキーマでの登録は
  API 側でも拒否される。空欄 = 制限なし(全スキーマ)。編集で空にして保存すると
  制限解除できる
- **変更**: 行の編集。**DB 側でパスワードをローテーションしたら,ここで
  新パスワードを再入力**する(保存値は自動では追従しない)
- **無効化**: 接続を無効にすると,その接続配下のテーブルは
  「接続先データベースに接続できません(502)」になる
- **削除**: 配下の管理テーブル登録が残っていると削除できない(先に登録解除)
- 既定DB(アプリ自身のDB)は常に使用可能で,この画面の管理対象外
  (変更は `.env` の `MSSQL_DSN`)

### 4.4 ダッシュボードテンプレートの配布

設定 > ホーム設定(テンプレート)。機能の有効/無効は 設定 > 機能設定 で行う。

- 作成/編集: 機能・テーブルカード・URL リンクを並べて保存。
  有効なテンプレートだけ利用者が選択できる
- ここで管理するのは**配布テンプレートのみ**。ユーザーの個人テンプレート
  (「現在の構成を保存」で作られる)は本人しか見えず,管理画面には出ない
- テンプレートを削除しても,選択していたユーザーは自動的に既定へ戻る

---

## 5. 接続先の変更(移設・切替)手順

### 5.1 業務DBサーバーの移設(接続先ホスト変更)

1. 移設先に同名スキーマ・テーブルを準備(データ移行は DB 管理者側の作業)
2. 設定 > 接続情報管理 で該当接続のホスト等を変更 → 接続テスト
3. 対象テーブルの画面を開き,データが見えることを確認
   (メタデータは毎回カタログから取得するため,列構成が同じなら追加作業なし)

### 5.2 アプリDB(ftool_app_ テーブル)の移設

1. 計画停止(backend 停止)
2. 旧サーバーの ftool_app_ テーブル群をバックアップ → 新サーバーへ復元
3. `.env` の `MSSQL_DSN` を新サーバーへ変更
4. `podman compose -f deploy/compose.yaml up -d` → ログイン・権限・履歴を確認

### 5.3 AD(認証基盤)の変更

`.env` の `LDAP_*` を変更して backend 再起動。
**注意**: ユーザーの同一性は GUID(`LDAP_ATTR_GUID`)で管理している。
ディレクトリ移行で GUID が変わる場合,権限・ダッシュボード項目
(`ftool_app_user_dash_items`)・個人テンプレートの紐付けが切れる。移行時は
`ftool_app_users.object_guid` の新旧対応表を作り UPDATE する計画を立てること
(未対応のまま移行するとユーザーは「初回ログイン扱い」になり閲覧権限のみ,
ダッシュボードは空になる)。

### 5.4 Valkey の変更

`REDIS_ADDR` を変更して再起動。セッションのみなので移行不要
(切替時点で全員再ログイン)。

---

## 6. 監査履歴(操作履歴)の運用

- 記録対象: ログイン/ログアウト(失敗含む),行の追加・更新・削除
  (**更新・削除は前後値**。1バッチ100行超は打ち切りフラグ),CSV 出力
  (rows.export / history.export = データ持ち出し),設定変更,権限変更,
  テンプレート・カード操作。履歴は**アプリからは削除・変更不可**
- 閲覧: 操作履歴画面(history:maintainer+)。全列フィルタ
  (日時は JST の期間指定)+ CSV 出力(summary 列 = 日本語要約,
  detail 列 = JSON 全文)
- Excel で detail(JSON)を分析する場合は Power Query の JSON 展開が使える
- **IP に IPv4/IPv6 が混在する**のは仕様(クライアントが接続に使った
  アドレスファミリーをそのまま記録。localhost は ::1 になりがち)
- 保持期間: 現状は無期限。規程が決まり次第,アーカイブテーブル+定期移動
  ジョブを実装予定(数百万行から COUNT/LIKE が重くなる見込み)。
  当面のサイズ監視: `SELECT COUNT(*) FROM dbo.ftool_app_operation_history;`

---

## 7. バックアップ・リストア

| 対象 | 方法 | 備考 |
|---|---|---|
| アプリDB(ftool_app_ テーブル群) | SQL Server の標準バックアップに含める | 設定・権限・**監査履歴**を含む。最重要 |
| `deploy/.env` | 安全な場所に複製 | 特に `CONN_ENC_KEY`(§8.2) |
| MinIO(`minio-data` ボリューム) | `podman volume export ftool_minio-data` 等 | 監査履歴 detail の 1MB 超過分の全文(§8.5)。含めないと**退避された全文だけが失われる**(履歴の行自体はDB側に残る) |
| 業務DB | 各DBの管理者運用に従う | 本ツールの管理外 |
| Valkey | 不要 | セッションのみ(消えても再ログインで済む) |
| コンテナイメージ | 配布 tar を保管(§3.1) | 無くてもソースから再ビルドできるが,日付タグの tar を残しておくと切り戻しが速い |

リストア: アプリDBを復元 → `.env` を配置 → (MinIO を使う構成なら
`minio-data` も復元) → compose up。
`CONN_ENC_KEY` が復元できない場合,接続パスワードだけは復号不能なので
全接続を UI から再入力する。

---

## 8. セキュリティ運用

### 8.1 データ分類(重要)

本ツールは**財務関連データ・個人情報を扱わない**前提で運用する。

- 個人情報・機微情報を含むテーブルは登録しない(登録ダイアログに注意文あり)
- 一部の列だけに個人情報が入りうる場合は,その列を**除外(hidden)**で登録する
  (画面・CSV・監査履歴のどこにも現れない)
- リンク名・テンプレート名などの自由入力欄に個人情報を書かない
  (入力値は監査履歴に残り,削除できない)
- 分類が変わる(財務・個人情報を扱う)場合は再設計が必要
  (前後値は記録済みだが,改ざん耐性・閲覧ログ・保持規程などの追加対応)
- **財務データを扱う場合の必須条件**: 対象テーブルを SQL Server の
  **Temporal Table(システムバージョン管理)にすること**。
  アプリの操作履歴は前後値を 1 バッチ 100 行までしか全量記録しない上,
  アプリ経由以外の変更を捕捉できず,改ざん耐性も DB エンジンに劣るため,
  アプリ側をどれだけ拡張しても値の完全な変更証跡は担保できない。
  役割分担は「誰が・いつ・どの操作で・どのキーを = アプリ監査 /
  全行の前後値・改ざん耐性 = temporal 履歴」とし,時刻+主キーで突合する。
  保持年限は `HISTORY_RETENTION_PERIOD` で規程に合わせて設定する

### 8.2 CONN_ENC_KEY の管理

- 接続パスワードの暗号鍵。**漏えいすると DB 資格情報が危険,紛失すると
  接続パスワードが全滅**(再入力すれば復旧は可能)
- パスワード管理庫等で保管し,`.env` の権限を絞る。
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

1. アクセスに使う FQDN(例 `ftool.example.local`)を決め,DNS 登録。
   社内CAに CSR を提出して発行(**SAN にその FQDN を含める**こと。
   有効期限と更新運用も確認)
2. 証明書と秘密鍵をホストに配置し,`deploy/compose.yaml` の nginx サービスに
   マウント+443 を公開:
   ```yaml
   ports:
     - "443:443"
     - "80:80"        # リダイレクト用に残す
   volumes:
     - ./nginx/certs:/etc/nginx/certs:ro,z
   ```
3. `deploy/nginx/default.conf` に 443 の server ブロックを追加し,
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
       # 以下,既存の location / と /api/ の設定をそのまま移す
   }
   ```
4. `.env` で `COOKIE_SECURE=true` にして再起動
   (`podman compose -f deploy/compose.yaml up -d --build`)
5. 確認: `https://ftool.example.local` に**証明書警告なし**でログインできること,
   `http://` が https へリダイレクトされること
6. 証明書の**期限切れ前更新**を運用カレンダーに登録(切れると全員アクセス不能)

### 8.4 その他

- HTTPS 終端を用意し `COOKIE_SECURE=true` にする(手順は §8.3)
- `LDAP_MOCK` は本番で必ず false
- 管理者(settings:admin)は最小人数に。付与・剥奪は監査履歴で追跡できる

### 8.5 監査履歴 detail の退避(MinIO。既定で有効)

監査履歴(`ftool_app_operation_history.detail`)は 1 バッチ 100 行までしか
前後値を全量記録しないが,それでも大量バッチの insert 内容(件数分の
リクエスト値そのもの)自体は detail に含まれるため,まれに 1MB を
超えることがある。超過分は claim check パターンで MinIO へ退避し,
detail 列には `{"truncated":true,"overflowKey":"..."}` という参照だけを
残す(履歴の[JSONをダウンロード]が backend 経由で全文を取得する。
利用者は退避された行かどうかを意識しなくてよい)。

`.env` の既定は `MINIO_ENDPOINT=minio:9000` で**有効**。空にすると機能ごと
無効化でき,その場合 1MB 超の detail は記録時点で破棄される(履歴の行自体は
残る)。無効化するなら配布 tar から minio イメージも外してよい(§3.1)。
運用上の注意点:

- **認証情報**: `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` は `CONN_ENC_KEY` と
  同様に扱う(コミットしない,`.env` 経由,パスワード管理庫で保管)
- **単一ノードなので可用性は限定的**: 開発/本番とも MinIO は1ノード構成。
  退避先が落ちている間は監査そのものは best-effort のまま止まらないが,
  該当分は退避もできず detail に `overflowError` が残り**全文は失われる**
  (本体の履歴行自体は残る)
- **アクセス経路**: ブラウザに直接 MinIO を触らせない。backend が
  サーバーサイドで Put/Get する設計のため,MinIO はネットワーク的に
  内部限定のままでよい(prod の compose では `expose` のみで `ports` は無い)
- **バックアップ**: MinIO のデータボリューム(`minio-data`)も
  SQL Server 同様にバックアップ対象に含めること(§7)。含めないと
  退避された全文だけが災害復旧で失われる
- **保持期間**: 現状ライフサイクルルール(自動削除)は未設定。
  本体の履歴保持期間の規程化(§8.1 に関連する残課題)と合わせて
  今後 MinIO バケットのライフサイクルルールも検討する
- **暗号化/機密性**: 現状のデータ分類(§8.1,財務・個人情報を扱わない前提)
  では必須要件にしていない。分類が変わる場合はサーバーサイド暗号化(SSE)を
  検討する

---

## 9. 障害対応(症状別)

| 症状 | 原因の当たり | 対処 |
|---|---|---|
| ログイン画面で「認証サービスに接続できません」等(502) | AD/LDAP に到達できない,バインド失敗 | backend ログの `ldap:` 行を確認。`LDAP_URL`/バインド資格情報/FW を確認 |
| 全ユーザーが一斉にログイン不能(502) | **バインド用サービスアカウントのパスワード失効/ロック** | AD 側で解除・再設定 → `.env` 更新 → backend 再起動(§1.2c) |
| ログに `x509: certificate signed by unknown authority` | LDAPS / `encrypt=true` の証明書がコンテナで未信頼 | 社内 CA をイメージに追加して再ビルド(§1.2d) |
| ログに `dial tcp ...: i/o timeout` / `no such host` | 外部サーバーへの FW 未開放 / コンテナから DNS が引けない | §1.2a のポート表で FW 確認。DNS 不可なら `extra_hosts` か IP 直書き |
| ログインは通るが権限が何もない | 初回ログイン扱い(GUID 変化)か権限未付与 | 設定>ユーザー権限で付与。AD 移行後なら §5.3 の GUID 突合 |
| 特定テーブルだけ「接続先データベースに接続できません」(502) | その業務DB接続が落ちている/無効/資格情報失効 | 設定>接続情報管理で接続テスト。パスワード失効なら再入力 |
| 全テーブルで 500/502 | アプリDB(MSSQL_DSN)に接続できない | backend ログ確認,SQL Server 稼働・資格情報を確認 |
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
3. DDL 追補(あれば)を適用 — 本番は `prod-app-schema.sql`,開発/検証は
   `01_init.sql` を再実行(いずれも追補ブロックは冪等)
4. 新しい日付タグでイメージをビルド(オフライン環境は §3.1 で持ち込む):
   `IMAGE_TAG=$(date +%Y-%m-%d_%H%M%S) podman compose -f deploy/compose.yaml build`
5. `.env` の `IMAGE_TAG` を新しい日付へ更新し
   `podman compose -f deploy/compose.yaml up -d`
6. 動作確認: ログイン → 主要画面 → 当該変更点 → 操作履歴に記録が残ること
7. 問題があれば **`.env` の `IMAGE_TAG` を前の日付へ戻して `up -d`**
   (旧タグのイメージを消していなければこれだけで切り戻せる。日付タグに
   している理由がこれ)。DDL は追加列/テーブルのみなら旧バージョンでも
   動作する設計 — 破壊的 DDL は原則行わない
