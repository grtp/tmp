# F-tool 修正・改修手順書

本書は F-tool(コード名 `f-tool`，アプリDBの既定データベース名 `ftool`)へ
機能追加・変更を行う開発者向けの手順書。
運用作業(ユーザー権限付与・接続の登録・バックアップ等)は
[運用・保守手順書](operations-guide.md) を参照。

---

## 1. 全体像と変更フローの原則

```
リポジトリ構成
├─ api/        OpenAPI 仕様(openapi.yaml)= API 契約の正
├─ backend/    Go 1.25 + gin
│   ├─ gen/api/          oapi-codegen の生成物(手編集禁止)
│   └─ internal/
│       ├─ httpapi/      HTTP ハンドラ(認可・監査・DTO 変換)
│       ├─ repo/         アプリDB(app_ テーブル)のリポジトリ
│       ├─ store/        動的テーブル CRUD(業務DB側)
│       ├─ meta/         カタログのイントロスペクション+列モード
│       ├─ conn/         マルチ接続(プール・暗号化)
│       ├─ auth/ authz/ audit/ session/ config/
├─ frontend/   Angular 21 (Nx, standalone + signals)
│   ├─ libs/ui/          表示専用コンポーネント(Storybook 対象)
│   └─ apps/f-tool/       ルーティング・API 層・コンテナ(配線)
├─ deploy/     compose(dev/本番)，initdb/01_init.sql(開発DDL)・
│               initdb/prod-app-schema.sql(本番DDL，app_* のみ)
├─ e2e/        ブラウザ E2E(puppeteer-core + Edge headless)
└─ docs/       本書ほか
```

**変更フローの原則(spec-first)**: API に触れる変更は必ず

1. `api/openapi.yaml` を先に変更(契約の正はここ)
2. `make generate` で Go の生成コードを更新
3. backend 実装(repo → handler → 認可 → 監査)
4. frontend 実装(core/api → models → libs/ui → features)
5. E2E にチェックを追加して全通し
6. README・本書などドキュメント更新

の順で行う。生成物(`backend/gen/api`)は手で編集しない。

### 1.1 アーキテクチャの要約と設計思想

一行で言えば **OpenAPI 契約駆動・メタデータ駆動の3層モノリス**。

- **全体**: SPA(Angular)+ REST API(Go 単一バイナリ)+ SQL Server の3層。
  中核機能自体がメタデータ駆動(実行時にカタログをイントロスペクトして
  汎用 CRUD を導出する)
- **backend**: レイヤードアーキテクチャ。層の実体はディレクトリではなく
  **import グラフ**(`httpapi → {repo, store, meta, conn, audit, authz,
  session, auth} → appdb` の一方向・非循環。`go list` で検証可能)。
  利用側定義インターフェース(`auth.Authenticator` / `audit.BlobStore` /
  `meta.DBProvider` 等)+ main.go の Composition Root により
  ヘキサゴナルの本質(依存性逆転)だけを持ち，ディレクトリ儀式は持たない
- **frontend**: Container/Presentational。MVVM に対応させると
  View = `libs/ui`(input/output のみ。アプリの model を知らず，
  コンテナが詰め替えた表示用型を受ける。ゆえに Storybook で単体描画できる)，
  ViewModel = `features/` のコンテナ(API 呼び出し・signal 状態・エラー処理。
  「何を出すか」に責任を持ち「どう見えるか」には持たない)，
  Model = `core/models` + backend。境界は Nx のライブラリ境界が強制する
- **テストの対応**: 見た目 = Storybook，純粋ロジック = Vitest,
  配線(コンテナ)= E2E。コンテナ専用のテスト層は置かない
  (E2E が全コンテナのテストスイートを兼ねる)

**特定の様式(クリーン/ヘキサゴナル/DDD 等)には収めない。**
要素を取り込むか捨てるかの判定基準は「**検証可能な不変条件を増やすか，
儀式を増やすだけか**」: 前者(import 非循環 = コンパイラ，ui→apps 禁止 =
Nx 境界，契約からの逸脱 = 生成物のコンパイルエラー)だけを採用し，
後者(層ディレクトリ・命名様式・レイヤ数の規定)は拒否する。

---

## 2. 開発環境の準備と起動

### 2.1 前提

- Windows + WSL(`alma9` ディストリ)+ podman(コンテナは WSL 側で動く)
- Go 1.25 / Node.js(frontend/e2e 用)/ Microsoft Edge(E2E 用)

### 2.2 起動手順(毎回)

```bash
# 1) 開発コンテナ(SQL Server / OpenLDAP / Valkey)
wsl -d alma9 -- podman start ft-mssql ft-redis ft-ldap
#   初回や作り直しは: make dev_up  (podman compose -f deploy/compose.dev.yaml up -d)
#   ft-mssql が (healthy) になるまで待つ:
wsl -d alma9 -- podman ps

# 2) バックエンド(:8080)
make be_serve            # OpenLDAP 実物で認証(通常はこちら)
# make be_serve_mock      # モック認証 admin/admin(LDAP 不要の簡易確認用)

# 3) フロントエンド開発サーバー(:4200。/api は :8080 へプロキシ)
make fe_serve
```

開発ユーザー(OpenLDAP): `local` / `suzuki` / `sato`(パスワード共通 `Fidev01!`)。
local に admin×3(table-maint / settings / history)を付与して使うのが基本。

### 2.3 開発環境の既知の注意点

| 事象 | 対処 |
|---|---|
| WSL 再起動でコンテナが止まる | `podman start ft-mssql ft-redis ft-ldap` で再開 |
| コンテナ再作成で **LDAP の entryUUID が変わり権限が消える** | 権限を再付与(設定>ユーザー権限，または MERGE の SQL)。`make dev_down` はボリュームごと消すので特に注意 |
| dev サーバーが**リビルドを止めて古いバンドル**を配る(i18n が生キー表示等) | :4200 のプロセスを kill して `make fe_serve` し直す。判定は必ずフレッシュなブラウザで行う |
| ブラウザの HMR 残骸でディレクティブが動いていないように見える | ページを開き直す/シークレットウィンドウで確認 |
| Git Bash から curl で日本語 JSON を送ると CP932 で化ける | ブラウザの fetch か Python(urllib)で送る |
| sqlcmd へのインライン SQL が PowerShell 経由で壊れる | ファイルに書いて `podman cp` → `sqlcmd -i` で実行 |

---

## 3. 共通ルール(全改修に適用)

1. **HTML/CSS は外部ファイル**(`templateUrl` / `styleUrl`，同フォルダ同名)。
   インライン `template:` / `styles:` は使わない。
2. **`<select [value]="...">` は禁止**。option の描画と競合して先頭項目に落ちる
   既知バグがある。必ず `<option [selected]="...">` で選択状態を指定する。
3. **i18n は ja/en 同時に追加**(`libs/ui/src/lib/shared/i18n/{ja,en}.json`)。
   組込機能の表示名は `functions.<code>` キー。ユーザー入力値(リンク名・
   テーブル表示名など)は翻訳しない。
4. **モーダルは画面外クリックで閉じない**。閉じるのは Esc / キャンセル / 確定 / ×。
   複数画面を持つダイアログは「単一ダイアログ内のビュー切替+←戻る」方式
   (バックドロップを開き直すとちらつくため)。
5. **バックエンドの全操作は認可+監査**:
   - 認可: ハンドラ冒頭で `s.require(c, authz.Action〇〇, authz.Level〇〇)`
   - 監査: 成功・失敗とも `s.audits.Write(...)`(5W1H。detail に内容を残す。
     update/delete は前後値。個人情報は書かない)
   - **例外(データ最小化)**: 本人専用データ(個人リンク `user-link.*` 等)は
     イベントの発生(操作種別・id・kind)だけを残し，名前・URL などの内容は
     detail に書かない(実質ブックマークであり，管理者が全ユーザーの登録内容を
     閲覧できてしまうため。2026-07-19 決定)
   - detail が 1MB を超える場合，`internal/audit.Recorder` が MinIO
     (`internal/blobstore`)へ自動退避する(claim check パターン，§S11)。
     ハンドラ側は何も意識しなくてよい(`Entry.Detail` を渡すだけ)。
     `MINIO_ENDPOINT` 未設定の環境では従来通り超過分を破棄する
6. **SQL の識別子は必ず `meta.QuoteIdent`** を通す(動的テーブル)。値は常に
   `@pN` プレースホルダ。ユーザー入力の列名は def との突合を通ったものだけ使う。
7. **app_ テーブルの DDL は `deploy/initdb/01_init.sql`(開発/検証，CREATE
   DATABASE/SCHEMA・サンプルデータ込み)と `deploy/initdb/prod-app-schema.sql`
   (本番，app_* のみ・CREATE DATABASE/SCHEMA 無し)の**両方**に同じ内容を
   反映する。新規 CREATE と，既存DB向けの**冪等 ALTER 追補**
   (`IF COL_LENGTH(...) IS NULL` 等)を必ずセットで書く。
   - app_ テーブルのスキーマは `$(APP_SCHEMA)` 変数で書く(`dbo.app_x` と
     直書きしない)。01_init.sql は冒頭の `:setvar APP_SCHEMA dbo` で既定値を
     持つが，prod-app-schema.sql は `:setvar` を持たず `sqlcmd -v APP_SCHEMA=`
     の指定を必須にしている(本番での dbo 決め打ち誤実行を防ぐため)
   - **ALTER 追補は必ず対象テーブルの CREATE より後に置く**(新規構築時に
     未作成テーブルへの ALTER で落ちる)。念のため
     `IF OBJECT_ID(...) IS NOT NULL AND COL_LENGTH(...) IS NULL` の
     二重ガードを推奨
   - サンプル業務テーブル(products/customers)・demo DB は開発専用。
     prod-app-schema.sql には追加しない
8. **アプリDBへの SQL は `dbo.app_xxx` と書き，必ず appdb.Q を通す**
   (repo/conn は Repo の `query/queryRow/exec` ヘルパ経由，tx 内は
   `appdb.Q(...)` を明示)。実行時に `dbo.` が `APP_DB_SCHEMA` の設定スキーマへ
   書き換えられる。アプリDBの SQL に app_ 接頭辞以外の意味で `dbo.` を
   書いてはならない(業務DB側の SQL は無関係)。
8. 表示専用ロジックは `libs/ui`(入出力は input/output のみ)，API 呼び出し・
   状態は `apps/.../features` のコンテナに置く。libs/ui から HttpClient を
   注入しない。
9. **コメント規約**(2026-07-20 全数精査でリポジトリ全域に統一済み):
   - **可能な限り少なく**。残す価値があるのは「コードから導出できないこと」
     だけ: why(設計理由)，制約(変えると壊れる)，ドメイン事実
     (mixed-endian 等)，罠の警告。名前・次の行をなぞるだけのコメントは
     書かない。嘘になったコメントは直すか消す
   - **全て日本語**で書く。doc コメントは godoc 形式(識別子名で始める。
     例: `// Configure は APP_DB_SCHEMA の値を検証して設定する。`)
   - **句読点は ，と 。**(読点に「、」は使わない)
   - **区切りコメント(`// ----` 等)は禁止**(ラベル無しは情報量ゼロ，
     ラベル付きも IDE のアウトラインで代替。長くなったらファイルを分ける)。
     **例外**: 分割できない巨大な単一ファイル(`api/openapi.yaml`，
     `deploy/initdb/01_init.sql` 等)はラベル付き区切りを統一形式で許可
   - doc は自明でないものにだけ書く(コンストラクタや OpenAPI が正の
     ハンドラには重複させない — 嘘化リスクの方が高い)
   - コメント内の日付は「いつから適用か」が意味を持つ決定事項
     (監査データ最小化等)のみ。単なる経緯メモには書かない(git blame の仕事)

---

## 4. ケース別の改修手順

### 4.1 既存画面(UI)の変更

対象例: ボタン追加，表示項目の変更，ダイアログの項目追加。

1. 変更箇所の特定
   - 見た目・DOM: `frontend/libs/ui/src/lib/<機能>/<component>/*.html|css|ts`
     (`<機能>` は `shared`/`login`/`dashboard`/`table-maint`/`settings`/`history`。
     `app/features/*` と対応させている。複数機能で使い回すものは `shared/`)
   - データ取得・保存・遷移: `frontend/apps/f-tool/src/app/features/<機能>/`
2. libs/ui 側に input/output を追加し，コンテナ側で配線する
   (コンポーネントから直接 API を呼ばない)。
3. 文言は i18n キーで追加(ja/en 両方)。
4. Storybook のストーリー(`*.stories.ts`)を新 input に合わせて更新。
5. 検証:
   ```bash
   cd frontend
   npx nx build f-tool --skip-nx-cache
   npx nx build-storybook ui --skip-nx-cache
   ```
6. `e2e/e2e.mjs` に該当画面のチェックを追加して全通し(§5.3)。

よく触る画面と実体:

| 画面 | libs/ui | コンテナ |
|---|---|---|
| ダッシュボード | dashboard-page, add-feature-dialog, link-dialog | features/dashboard |
| テーブルメンテ(グリッド) | data-table-page, row-edit-dialog, csv-export/merge-dialog | features/table-maint |
| テーブル選択 | table-select-page | features/table-maint/table-select-container |
| 操作履歴 | history-page | features/history |
| 設定 | settings-page, managed-table-dialog, connection-dialog, template-editor-dialog | features/settings |
| 共通 | page-header, user-menu, lang-select, confirm-dialog, resize-columns(列幅) | - |

### 4.2 新しい画面(ルート)の追加

1. `apps/f-tool/src/app/features/<name>/` にコンテナ(ts/html)を作成。
2. `app.routes.ts` にルートを追加。**必ず `authGuard` + 必要なら
   `actionGuard('<code>', '<level>')`** を付ける(ガードが無いと誰でも直 URL で
   入れてしまう)。
3. 画面へ入る導線を追加:
   - サイドバー: `dashboard-container.ts` の `menuItems`(権限チェック付き)
   - カード: 機能として出すなら §4.5 の手順
4. ヘッダーは `tm-page-header` を使う(戻る/ホーム/ログアウトが共通化されている)。

### 4.3 API の追加・変更

1. **`api/openapi.yaml` を編集**(パス・スキーマ・説明。既存スキーマ変更時は
   required / nullable の互換に注意)。
   - YAML の値に「`: `(コロン+空白)」を含む日本語説明を書くときは
     `>-` や `|` のブロックスカラーにする(素のスカラーだと構文エラー)。
2. `make generate` — backend(gen/api，oapi-codegen)と frontend
   (core/gen/api-types.ts，openapi-typescript)の両方を再生成する。
   生成型のフィールドはポインタになりがちなので nil チェックを忘れない。
3. backend 実装:
   - データアクセス: `internal/repo/`(app_ テーブル)または `internal/store/`
     (動的テーブル)
   - ハンドラ: `internal/httpapi/` に生成インターフェースのメソッドを実装。
     冒頭で認可，成功・失敗の監査，エラーは `abortErr` /
     `writeRepoError` / `writeStoreError` で HTTP へ写像
   - `go build ./... && go test ./...`
4. frontend 実装:
   - 型: `core/gen/api-types.ts` は手順2の `make generate` で再生成済み
     (**手編集禁止・コミットする**)。`core/models.ts` は生成型の
     再エクスポート窓口なので，新スキーマはエイリアス1行
     (`export type Xxx = S['Xxx'];`)を足すだけ。
     手写しでの型同期は禁止(ドリフトはコンパイルエラーで検出される)
   - HTTP 層: `core/api/*.ts`(薄いラッパのみ。判断はコンテナ側)
5. **curl / ブラウザ fetch で API 単体を検証**してから UI を繋ぐ
   (ログイン → Cookie 付きで叩く)。
6. E2E 追加 → 全通し → README の該当節を更新。

#### openapi.yaml / api.gen.go の肥大化について

- `api.gen.go` は生成物なので行数は問題にしない(手編集禁止。レビューは
  openapi.yaml の差分で行う)。必要になれば oapi-codegen の config を分けて
  models / server を別ファイルに生成できるが，当面不要
- `openapi.yaml` は**単一ファイルを維持**する(現状の規模では分割の管理コストの
  方が高い)。目安として **4,000〜5,000 行を超える/複数人で同時に触り始めたら**，
  機能単位に `api/paths/*.yaml` + `api/components/*.yaml` へ `$ref` 分割し，
  codegen の前に `npx @redocly/cli bundle` で 1 ファイルに結合する方式
  (バンドル方式)へ移行する(Makefile の generate を bundle → codegen の
  2 段にする)。将来の分割がしやすいよう，openapi.yaml 内の機能単位の
  セクションコメントは崩さないこと

### 4.4 DB スキーマ(app_ テーブル)の変更

1. `deploy/initdb/01_init.sql` **と** `deploy/initdb/prod-app-schema.sql` の
   両方を変更(app_ テーブル部分は内容を同一に保つ):
   - 新規環境向け: CREATE TABLE 本体を更新
   - **既存環境向け: 冪等な追補ブロックを追記**
     (`IF COL_LENGTH(N'dbo.x', N'col') IS NULL ALTER TABLE ...` /
      `IF OBJECT_ID(...) IS NULL CREATE ...`)
2. 開発DBへ適用:
   ```bash
   # SQL をファイルにして実行(インラインは引用符事故が多い)
   wsl -d alma9 -- podman cp <file.sql> ft-mssql:/tmp/x.sql
   wsl -d alma9 -- podman exec ft-mssql /opt/mssql-tools18/bin/sqlcmd \
     -S localhost -U sa -P 'Fidev01!' -C -d ftool -b -i /tmp/x.sql
   ```
3. Go の repo(scan/INSERT/UPDATE の列リスト)と DTO，OpenAPI，フロント型を
   合わせて更新。
4. FK 設計の注意(SQL Server):
   - **複数カスケードパス**があると FK 作成自体が失敗する
     (例: users→templates を CASCADE にすると users→user_dash と衝突)。
     その場合は NO ACTION にする
   - UNIQUE 制約を変える場合は旧制約の DROP を追補に含める
5. 監査履歴テーブル(`app_operation_history`)は**後方互換のまま**にする
   (既存行の書き換え・削除はしない)。

### 4.5 新しい組込機能(アクション)の追加

「機能」= app_actions の行 + ルート + 権限。UI からは追加できない(意図的)。

1. `01_init.sql` の app_actions MERGE シードに行を追加
   (`code`, 表示名, Tabler アイコン名, sort_order, `is_builtin=1`)。
   code はルートパスと監査 action_code に使われるので **kebab-case・変更不可**。
2. backend: `internal/authz/authz.go` に `Action<Name>` 定数を追加し，
   対象ハンドラで `require`。
3. frontend:
   - ルート + `actionGuard('<code>', ...)`(§4.2)
   - i18n に `functions.<code>` を ja/en 追加(言語切替に追従させるため)
   - ダッシュボードのカードは権限があれば自動で出る。サイドバー専用にする
     場合は `dashboard-container.ts` の `SIDEBAR_ONLY` に追加
   - 「機能リンク」階層にも自動で並ぶ。テーブル指定のようなサブ階層が必要なら
     `ShortcutFunction.hasTables` 相当のフラグを拡張
4. 権限付与は設定>ユーザー権限で(admin/maintainer/user の3段)。

### 4.6 接続まわりの改修

#### a. 業務DBの接続追加・変更(コード変更不要)
運用作業。設定 > テーブルメンテナンス設定 > 接続情報管理 で行う
(運用・保守手順書 §4.3)。接続にスキーマ制限(`schema_name`)を設定すると，
その接続を使う管理テーブル登録は指定スキーマのテーブルに限定される
(`internal/httpapi/managed_tables.go` の `connSchemaLimit`。登録候補 API/作成 API
双方でサーバー側に強制される。フロントの絞り込み欄は表示上のガードに過ぎない)。

#### b. 既定接続(アプリ自身のDB)の変更
- 開発: `make be_serve*` の環境変数(`DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`
  または `MSSQL_DSN`)
- 本番: `deploy/.env` の `MSSQL_DSN` を変更して backend を再起動
- **app_ テーブルを dbo 以外のスキーマに置く場合**: `APP_DB_SCHEMA` を設定し，
  本番は `prod-app-schema.sql` を `-v APP_SCHEMA=<同じ値>` で，開発は
  `01_init.sql` の `:setvar APP_SCHEMA` を同じ値にして実行(運用・保守手順書 §1.2b)
- アプリDB(app_ テーブル群)を移設する場合はデータ移行が必要
  (運用・保守手順書 §5)

#### c. LDAP/AD 設定の変更
`LDAP_URL / LDAP_BASE_DN / LDAP_BIND_DN / LDAP_BIND_PASSWORD /
LDAP_USER_FILTER / LDAP_ATTR_GUID / LDAP_ATTR_USERNAME / LDAP_GUID_FORMAT /
LDAP_STARTTLS`。
本番 AD は `(sAMAccountName=%s)` + `objectGUID` + `ad-binary`，
開発 OpenLDAP は `(uid=%s)` + `entryUUID` + `uuid-string`。
`ldaps://` は URL だけで有効(TLS 検証はコンテナの信頼ストア)。
外部 AD / 外部 SQL Server への接続設計(FW・DNS・サービスアカウント・
社内 CA 証明書の信頼)は運用・保守手順書 §1.2 を参照。
**ユーザーの同一性は GUID で管理**しているため，ディレクトリを移行して GUID が
変わると権限・個人カード・個人テンプレートの紐付けが切れる(移行時は
app_users.object_guid の突合・更新計画を立てること)。

#### d. 接続暗号鍵(CONN_ENC_KEY)
接続パスワードは AES-256-GCM で暗号化して保存される。鍵を変えると
**既存の接続パスワードは復号できなくなる**ので，変更時は全接続のパスワードを
UI から再入力する。鍵は `openssl rand -base64 32` で生成し，安全に保管する。

### 4.7 言語(ロケール)の追加

1. `libs/ui/src/lib/shared/i18n/<lang>.json` を追加(ja.json を複製して翻訳)。
2. `provide-i18n.ts` の対応言語に追加。
3. `tm-lang-select` の選択肢に追加。
以上で全画面に反映される(コンポーネント側の変更は不要)。

### 4.8 監査ログに新しい操作を追加する

1. `audit.Entry` で `ActionCode`(機能)+ `Operation`(`xxx.yyy` 形式)+
   `Target` + `Detail` を記録。件数だけでなく**内容が特定できる detail** にする
   (行編集は before/after。1バッチ100行で打ち切り `changesTruncated`)。
2. 履歴 CSV の人間可読要約が必要なら
   `backend/internal/httpapi/history_csv.go` の `summarizeDetail` に分岐を追加。
3. 履歴画面の「機能」フィルタ select は
   `libs/ui/src/lib/history/history-page/history-page.ts` の `actionCodes` 既定値に追加。

---

## 5. テストと検証

### 5.0 一括検証(推奨)
```bash
make check   # gofmt / vet / test_race / 生成物同期 / vitest / nx build / storybook
```
E2E(§5.3)以外の全検証を1コマンドで実行する。**フル実行の正は CI**
(push すれば使い捨てコンテナで全部走る)。ローカルは環境制約で分担になる:
Windows 側は be_test_race 以外(-race が cgo を要求)，alma9 側は
backend 系のみ(frontend/node_modules は Windows 用バイナリを含むため
共有できない)。含まれる不変条件:
- `go test -race`
- **アーキテクチャテスト**(`backend/internal/archtest`): 内部パッケージ間の
  import を許可リストで凍結。新しい依存辺は allowed への追記 = 設計判断として
  レビューに現れる
- **生成物同期**: `make generate` を再実行して gen が openapi.yaml と
  一致することを確認(手編集・再生成漏れの検出)

### 5.1 バックエンド(個別)
```bash
cd backend
go build ./...
go test ./...        # 高速な普段用。race 込みは make test_race
# ファジング(任意。シードは通常テストで常時実行される)
go test -fuzz=FuzzCoerceValue -fuzztime=30s ./internal/store/
```
プロパティテスト: 境界入力を扱う関数は生成入力でも検証する。
Go 側は native fuzz(adguid/meta/store の Fuzz*)，フロントは fast-check
(`csv.property.spec.ts`。ユーザー持ち込みファイルの入口 parseCsv が対象)。

### 5.2 フロントエンド
```bash
cd frontend
npm test                                 # Vitest ユニットテスト(core/ の純粋関数)
npx nx build f-tool --skip-nx-cache      # 型チェック込み
npx nx build-storybook ui --skip-nx-cache     # ストーリーの破壊検知
```

ユニットテストの対象は純粋関数のみ(設定は `frontend/vitest.config.ts`，
spec は対象と同じフォルダに `<name>.spec.ts`)。コンポーネント・DOM の
挙動は E2E(§5.3)が実ブラウザで検証する方針なので，ユニットテストは
追加しない。

**モジュールの置き場所ルール(libs/ui の shared/ と同じ基準)**:
`core/` に置けるのは **2機能以上で使うもの**(models / api-errors / csv /
fn-label / api/ / auth/)だけ。1機能専用のロジックはその feature フォルダに
置く(例: `features/table-maint/csv-import.ts`，
`features/dashboard/dash-cards.ts`)。純粋かどうかとどこに属すかは別の軸。
コンテナ内のロジックをテストしたくなったら，まず純粋関数として `core/` に
抽出してからテストを書くこと(TestBed + モックの山になるならそれは
抽出すべきサイン)。

### 5.2.5 監査履歴 overflow(MinIO，任意機能)の検証

既定では無効(`MINIO_ENDPOINT` 未設定)なので `e2e/e2e.mjs` には含めていない。
有効化して確認する場合:
```bash
make dev_seed  # 済んでいなければ
# backend起動時に MINIO_ENDPOINT=localhost:9000 MINIO_ACCESS_KEY=devminio
# MINIO_SECRET_KEY=Fidev01! を追加で渡す
```
1MB を超える成功バッチ(例: 数万行の小さな insert をまとめて送る)を投げ，
`GET /history?operation=rows.batch` で該当行の `detail` が
`{"truncated":true,"overflowKey":"..."}` になること，
`GET /history/{id}/overflow` で元の内容が全量取得できることを確認する。
画面側は展開行の[全文をダウンロード]ボタン(数万行規模になり得るため
画面には展開表示せず，`history-<id>-detail.json` としてファイルダウンロード
させる設計。ユーザーフィードバックにより表示ではなくDL方式に変更済み)。

### 5.3 ブラウザ E2E(リグレッション一式)

`e2e/e2e.mjs`(130+ チェック)。前提: コンテナ+backend(:8080)+
fe_serve(:4200)が起動済み，かつ `make dev_seed` で demoDB 接続 +
bigdata/wide/codes/audit_demo の管理テーブル登録が済んでいること
(クリーン環境ではこれが無いと多数のチェックが失敗する。
`deploy/initdb/dev-seed-connections.mjs` 参照)。

```powershell
# Edge headless を毎回フレッシュなプロファイルで起動(前回セッションの Cookie 排除)
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force $env:TEMP\edgeprof2 -ErrorAction SilentlyContinue
Start-Process msedge -ArgumentList '--headless=new','--remote-debugging-port=9223',"--user-data-dir=$env:TEMP\edgeprof2",'--no-first-run'
```
```bash
cd e2e && npm install && npm run e2e   # === N/N passed === を確認
```

注意:
- E2E は開始時に **local のダッシュボード設定・個人カードをリセット**する。
  手動検証と並走させない(データが競合して誤爆する)
- シードデータに依存するチェックがある。シード元は2系統:
  - `01_init.sql` が自動登録: products / customers，配布テンプレート `seizo-std`
    (パスワード等の秘密情報を含まないデータは，接続と違い直接 SQL でシードできる)
  - `make dev_seed` が demoDB 接続経由で登録: bigdata / wide / codes / audit_demo
    (接続のパスワードは暗号化必須のため，API 経由でしかシードできない)
  - `seizo-std` には kind='action'(table-maint)の項目が必須: テンプレート選択中は
    カードがテンプレート項目だけに置き換わる(既定の fn: カードとはマージされない)
    仕様のため，リンク項目だけでは非個人 fn: カードの非表示/復元チェックが通らない
- **`make dev_seed` は登録順が固定**(bigdata→wide→codes→audit_demo)。
  products/customers が id 1/2 を使う前提で，この順で登録すると
  audit_demo が id 6 になり，e2e.mjs がハードコードしている
  `/table-maint/6` と一致する。順序を変えたり間に別テーブルを挟むと
  E2E が壊れるので，増やす場合は末尾に追加すること
- 改修したら**必ず対応するチェックを追加**する(過去の全機能が資産になっている)

### 5.3.5 CI(ローカル Gitea + 使い捨てジョブコンテナ)

push ごとに `make check` を実行する CI。ソース管理は
「社内 GitLab から取得 → ローカル Gitea で開発(CI が回る)→
適度なタイミングで GitLab へ反映」というハブ運用を前提とする。

構成(`deploy/compose.ci.yaml`，WSL の podman 上):
- **ft-gitea**: Gitea 1.24(SQLite 内蔵，http://localhost:3300，登録無効)
- **ft-ci-runner**: act_runner。ジョブはホスト podman のソケット経由で
  **ジョブごとの使い捨てコンテナ**(`localhost/ftool-ci` = Go 1.25 + Node 20)
  で実行する。ワークフローは `.gitea/workflows/check.yaml`
  (checkout → npm ci → make check の薄いシム。GitLab 移行時は
  .gitlab-ci.yml に同じシムを書き直すだけ)

**以下のコマンドは全て WSL(alma9)に入ってプロジェクトルートで実行する。**

初期構築(初回のみ。再実行しても安全):
```bash
make ci_init
```
イメージビルド → Gitea 起動 → 管理ユーザー作成 → ランナー登録まで行う。
管理ユーザーは **local / Fidev01!**(開発専用の固定値。localhost bind・
登録無効のため committed で問題ない — DEV_CONN_ENC_KEY と同じ扱い)。

日常運用:
```bash
make ci_up      # 起動(ソケット有効化込み。WSL 再起動後もこれだけでよい)
make ci_down    # 停止(データは volume に残る)
```
- リポジトリ作成は Web UI(Windows 側ブラウザで localhost:3300)か API。
  push すれば check が走る
- 既知の罠: ソケット起動前に runner を作ると，マウント先
  `/run/podman/podman.sock` が**ディレクトリとして生成されて**ソケットを
  塞ぐ。`rmdir` してソケット起動 → runner コンテナを作り直す
  (`make ci_up` の順序ならこの罠は踏まない)

完全撤去(リポジトリ・ユーザー・ランナー登録・イメージごと消える):
```bash
make ci_clean
```

### 5.4 API 単体の検証(例)
```bash
cj=/tmp/cookies.txt
curl -s -c $cj -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"local","password":"Fidev01!"}'
curl -s -b $cj http://127.0.0.1:8080/api/v1/managed-tables | python -m json.tool
```

---

## 6. リリース手順(改修の本番反映)

1. すべてグリーンであること: `go test` / `nx build` / `build-storybook` / E2E 全通し
2. DDL 変更がある場合: `prod-app-schema.sql` の**追補ブロックだけ**を本番
   SQL Server へ適用(冪等なので再実行可。事前に app_ テーブルをバックアップ)
3. ビルドと反映:
   ```bash
   make generate && make fe_install && make fe_build
   podman compose -f deploy/compose.yaml up -d --build
   ```
4. 動作確認(ログイン → 対象機能 → 操作履歴に記録が残ること)
5. README / docs を更新した状態でコミット

---

## 7. 改修チェックリスト

- [ ] OpenAPI を先に変更し `make generate` した(API 変更時)
- [ ] 認可(`require`)と監査(`audits.Write`)を入れた
- [ ] DDL は CREATE 本体+冪等追補の両方を書き，開発DBに適用した
      (`01_init.sql` / `prod-app-schema.sql` の app_ 部分を同一に保った)
- [ ] i18n を ja/en 両方に追加した(`select [value]` を使っていない)
- [ ] HTML/CSS を外部ファイルにした / libs・features の責務を守った
- [ ] Storybook ストーリーを更新した
- [ ] E2E にチェックを追加し全通しした
- [ ] go build / go test / nx build / build-storybook すべてグリーン
- [ ] README・本書・運用手順書の該当箇所を更新した
