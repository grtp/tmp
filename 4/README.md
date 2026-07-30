# F-tool

社内の運用業務機能を束ねるポータル(コード名 f-tool)。
最初の機能は SQL Server のテーブルメンテナンス: 任意の接続先・任意のスキーマの
テーブルを admin が UI から動的に登録し,メタデータ(カラム/PK/型/rowversion)は
SQL Server のカタログ(INFORMATION_SCHEMA / sys.columns)から**実行時に取得**する。
テーブルを追加してもフロント・バックエンドの再ビルドは不要。

※コード名は表示名「F-tool」に合わせて統一済み(Go モジュール `f-tool`,
Nx アプリ `apps/f-tool`,npm スコープ `@f-tool/*`,テーブル接頭辞
`ftool_app_`)。アプリDBの既定データベース名は `ftool`(`MSSQL_DSN` の
`database=`。既存デプロイ・接続文字列との互換のため変更していない)。
表示名は i18n リソース(`common.systemName`)で差し替え可能。
favicon は `frontend/apps/f-tool/public/favicon.svg`(シンプルな "F",SVG)。
同じロゴをヘッダー左上のブランドマークにも使用(青地のため白抜きのインライン SVG。
page-header / dashboard-page の `.brand-logo`)。

## 技術スタック

| 層 | 技術 |
|---|---|
| frontend | Angular 21 (Nx monorepo) + Angular Material(M3 テーマ,`libs/ui/src/styles/material-theme.scss` でブランドトークンに合わせて配色)。アイコンは Material Symbols(npm 同梱,LAN 利用前提で CDN 不使用)。UI は `libs/ui` に分離し Storybook で管理。各コンポーネントは template/styles を外部ファイル(`*.html` / `*.css`)に分離。`libs/ui/src/lib` 配下は `app/features/*` と対応させて機能別サブフォルダ(`shared/`/`login/`/`dashboard/`/`table-maint/`/`settings/`/`history/`)に分けている |
| i18n | Transloco(実行時 ja/en 切替。辞書は `libs/ui/src/lib/shared/i18n` にバンドル同梱) |
| backend | Go 1.25+ + gin。OpenAPI spec-first (oapi-codegen で gin サーバー生成) |
| 認証 | LDAP (AD, objectGUID キー)。開発は OpenLDAP (entryUUID) or モック |
| セッション | Valkey (Redis 互換)。TTL 30分スライディング。httpOnly cookie `sid` (不透明ID) |
| 認可 | `ftool_app_user_auth`: 機能(action)ごとに admin / maintainer / user |
| 接続管理 | `ftool_app_connections`: 任意の SQL Server を admin が登録。パスワードは AES-256-GCM 暗号化 |
| 監査 | `ftool_app_operation_history` に全操作(ログイン含む)を記録。対象は `<接続名>:schema.table` 形式 |
| デプロイ | MIRACLE LINUX 9.6 + podman compose (nginx + backend + valkey) |

## ディレクトリ

```
api/        OpenAPI 契約 (source of truth)。make generate で Go コード生成
backend/    Go サーバー (gen/api は生成物)
frontend/   Nx ワークスペース (apps/f-tool = アプリ, libs/ui = UI カタログ)
deploy/     compose / nginx / DB 初期化 / LDAP 初期データ
e2e/        ブラウザ E2E 一式 (puppeteer-core + Edge headless。npm run e2e)
docs/       手順書
```

## 手順書

- **[修正・改修手順書](docs/development-guide.md)** … 画面の変更 / API の追加・変更 /
  DB スキーマ変更 / 機能追加 / 接続・LDAP まわりの改修 / テスト・リリースの手順と
  コーディング規約
- **[運用・保守手順書](docs/operations-guide.md)** … 本番の起動・停止 / 権限・テーブル・
  接続の日常運用 / 接続先の移設 / 監査履歴 / バックアップ / 障害対応 / セキュリティ運用

## DB テーブル(本ツール自身のもの。接頭辞 `ftool_app_` で業務テーブルと区別)

詳細な ER 図・命名規約・ダッシュボード実体化コピー方式の設計は
[docs/db-schema.md](docs/db-schema.md) を参照。

| テーブル | 役割 |
|---|---|
| `ftool_app_users` | LDAP 初回ログイン時に MERGE で自動登録。キーは objectGUID |
| `ftool_app_actions` | 機能マスタ(ダッシュボードの機能カードの実体)。行の追加・削除は API に無い(コード実装+シードのみ。全行が常に組込) |
| `ftool_app_user_auth` | 認可: (object_guid, action_id) → auth_level。行が無い機能は権限なし |
| `ftool_app_dash_templates` | admin が配布する**ダッシュボードテンプレート**,または本人専用の個人テンプレート(名前/説明/有効) |
| `ftool_app_dash_template_items` | テンプレートのカード構成(機能参照 / 任意リンク / テーブル参照。position 順) |
| `ftool_app_user_dash_items` | ユーザー個人の**現在のダッシュボードの実体化コピー**(position 順のカード実体。旧 `app_user_dash` + `app_user_links` を統合) |
| `ftool_app_connections` | 接続先 SQL Server(admin が設定画面から追加。パスワードは AES-GCM 暗号化) |
| `ftool_app_managed_tables` | 管理対象テーブルの登録。`connection_id` NULL = 既定接続(アプリ自身のDB) |
| `ftool_app_operation_history` | 監査履歴(誰が/いつ/何を/対象/前後JSON/成否/IP) |

## 複数接続について

- 「既定接続」= アプリ自身の DB(env `MSSQL_DSN`)。ftool_app_connections には登録しない
  (資格情報を DB に複製しないため)。`connection_id` の NULL がこれを表す
- 追加接続のパスワードは `CONN_ENC_KEY`(base64 32byte)で AES-256-GCM 暗号化して保存。
  鍵を変更すると既存接続は復号できなくなる(502 connection_unavailable)。
  その場合は設定画面から各接続のパスワードを再入力する
- 接続先が落ちている場合,該当テーブルの操作は 502 を返す(他のテーブルには影響しない)
- **接続のスキーマ制限**(`ftool_app_connections.schema_name`,任意): 発行アカウントの権限が
  特定スキーマ内に閉じている場合に設定する。空 = 制限なし。設定すると,その接続を使う
  管理テーブル登録は指定スキーマのテーブルしか候補に出せず(登録ダイアログのスキーマ
  絞り込みも固定表示・入力不可になる),API 側でも他スキーマでの登録を拒否する
  (`validation_failed`)

## 開発クイックスタート

前提: Go 1.25+(go.mod の go ディレクティブに合わせる), Node 20+, podman(+podman-compose)。

```bash
make dev_up        # SQL Server + OpenLDAP + Valkey を起動(初回はDB初期化も走る)
make generate      # OpenAPI -> backend/gen/api
make be_serve_mock # バックエンド :8080 (LDAP_MOCK=true, admin/admin でログイン可)
make dev_seed      # demoDB 接続 + bigdata/wide/codes/audit_demo の管理テーブル登録(E2E前提。冪等)
make fe_install
make fe_serve      # http://localhost:4200 (/api は :8080 へプロキシ)
make fe_storybook  # http://localhost:4400 (UI カタログ)
```

### 開発用アカウント

| 経路 | ユーザー | パスワード | 備考 |
|---|---|---|---|
| `make be_serve_mock` (モック) | admin | admin | 固定 GUID。initdb で admin 権限シード済み |
| `make be_serve` (OpenLDAP) | local / suzuki / sato | Fidev01! | 初回ログインで自動登録。権限は付与が必要(下記) |

### 初回 admin の付与(鶏と卵の解消)

権限を付与できるのは settings:admin だけなので,最初の管理者は SQL で付与する:

1. 対象ユーザーで一度ログイン(自動登録される)
2. `deploy/initdb/02_grant_admin.sql.example` の @username を書き換えて実行

```bash
podman exec -i ft-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost \
  -U sa -P 'Fidev01!' -i /dev/stdin < deploy/initdb/02_grant_admin.sql
```

注意: `make dev_down` は LDAP のボリュームも消すため entryUUID が変わり,
付与済み権限との紐付けが切れる(再ログイン→再付与)。モックの GUID は固定。

## 権限モデル

機能(action)単位で auth_level を持つ。行が無ければその機能は使えない。

| 機能 code | user | maintainer | admin |
|---|---|---|---|
| table-maint | 行の閲覧・検索 | + 追加/編集/削除 | 同左 |
| settings | - | - | 設定全般(下記) |
| history | - | 操作履歴の閲覧 | 同左 |

初回ログイン時は `AUTO_GRANT_TABLE_MAINT_VIEW=true`(既定) なら
table-maint:user が自動付与される。

- 操作履歴は Sprint 3 で settings から独立した専用権限になった
  (user は自動付与されうるため **maintainer 以上**で閲覧可)。
  移行シードで settings:admin 保持者には history:admin が自動付与される
- **settings 機能自体の無効化は不可**(ロックアウト防止)。設定画面に
  無効化操作が存在せず,API も 409 で拒否する

## ダッシュボード(テンプレート / 並べ替え / 個人リンク / テーブルカード)

サイドバーには ホーム / **テーブルメンテ(table-maint:user+)** /
操作履歴(history:maintainer+) / 設定(settings:admin) が並ぶ
(権限が無ければ表示されず,直 URL もルートガードが弾く)。
**ログアウトはヘッダーのユーザー名を押して開くドロワー**(トップへ戻る / ログアウト)
にあり,ヘッダーのタイトル押下でもダッシュボードへ戻れる。カード面の構成:

ダッシュボードは**実体化コピー方式**(2026-07-22 決定,S41)。`ftool_app_user_dash_items`
がユーザー本人の「今表示すべきカードそのもの」を position 順で持つ:

- **項目0件 = 空のダッシュボード**(2026-07-23 改定): 権限のある全機能への自動
  フォールバックはしない。ユーザーが明示的に操作(カード追加・テンプレート選択)
  するまで表示は変わらない。テンプレート選択の「**既定**」で,その時点で権限の
  ある全機能(サイドバー系を除く)を実体化コピーできる
- **項目1件以上**: サーバーの項目を position 順にそのまま表示
  (権限を失った機能/テーブル項目は描画時に除外するだけで削除はしない。権限が
  戻れば再表示される)

右下の丸い FAB(＋)から**[機能の選択]** モーダルを開く。モーダルは**単一ダイアログ
内の階層ビュー**で,サブ画面では左上の **←** で前画面へ戻れる(Esc も1つ戻る。
バックドロップを開き直さないため画面はちらつかない):

- **機能リンク** … カード追加をまとめた階層:
  - **〈機能名〉**(権限のある機能が並ぶ) … 「〈機能名〉画面」(機能トップへの
    カード。kind='action')と,テーブルメンテではさらに「**テーブルを指定**」→
    テーブル一覧(kind='table',押下でそのテーブルへ直行)を選べる
  - **URLリンクを追加**(最下部) … タイトルと URL のフォーム(同ダイアログ内。
    ← で戻れる)でリンクカードを追加
- **テンプレート** … カード構成の操作をまとめた階層:
  - **テンプレートを選択** … 既定 / admin 配布 / 自分の個人テンプレートから選び,
    選んだ内容を**現在の項目へコピーして全置換**する(一度きりの適用。持続的な
    「選択中」状態は持たないため一覧に✓は付かない)。個人テンプレートはゴミ箱
    アイコンで削除できる(削除しても適用済みのコピーには影響しない)
  - **現在の構成を保存** … 表示中のカード構成をそのまま
    **自分専用の個人テンプレート**として保存する(現在の表示は変更しない。
    `ftool_app_dash_templates.owner_guid` = 本人。他のユーザーには見えない)
  - **画面編集** … 編集モードに入る。カードが破線枠になり D&D で並べ替え・
    ×で削除ができ,**変更は操作ごとに即保存**される(2026-07-23 決定:
    削除が即保存のため並び替えも統一。確定/キャンセルの概念は無い)。
    右下は FAB の代わりに**[戻る]**(モード終了のみ)に切り替わる

個人テンプレートの API 上の扱い: `POST /dash-templates` に `personal: true` を
付けると認可は本人のみ(settings:admin 不要)で owner 付きで作成される。
参照・変更・削除・選択はすべて「配布 or 本人所有」でフィルタされ,他人の個人
テンプレートは 404 になる。設定画面のテンプレートタブは配布分だけを管理する。

**組込機能の表示名は言語切替に追従**する(辞書キー `functions.<code>`。
キーの無いカスタム機能は機能マスタの名前のまま)。リンクカードの名前や
テーブルの表示名などユーザー入力値は翻訳しない。

**カードの×は実削除**(画面編集モード中のみ表示)。以前の「非個人カードは
非表示・個人カードは削除」という区別は実体化コピー方式で撤廃され,
全カードが等しくユーザー自身のデータになった。削除の取り消しは
テンプレート再適用か手動での再追加による。

カードの表記は種別によらず **[アイコン] [機能] [詳細] [権限]** の4段で統一:
機能カード = 機能名のみ,テーブルカード = 機能名 + 詳細にテーブル表示名,
リンクカード = タイトル + 詳細に URL。

並び順はサーバー(`ftool_app_user_dash_items.position`)に保存される。
並べ替え・カード追加・削除・テンプレート適用はすべて `PUT /me/dash-items`
の全置換で実装している(部分更新 API は無い)。

将来構想(Sprint 5 以降): カードのサイズ変更。

## 列モード(編集不可 / 除外)

テーブル登録ダイアログのカラムプレビューで,列ごとに **編集可 / 編集不可 / 除外** を
指定できる(`ftool_app_managed_tables.readonly_columns / hidden_columns`):

- **編集不可(readonly)** … 表示はするが編集させない。`updated_at` / `updated_by` の
  ような監査系の命名は登録時に**編集不可を初期提案**する(変更可)。
  IDENTITY・計算列・対応外型は従来どおり自動で編集不可(変更不可)
- **除外(hidden)** … **SELECT 文自体から外す**。画面・CSV 出力・CSV 取込・
  操作履歴(前後値)のどこにも現れない。**個人情報が入りうる列を構造的に
  遮断する**ための指定
- 主キー列は指定不可(バックエンドでも拒否)。NOT NULL かつ既定値なしの列を
  除外すると**新規行が作れなくなる**ため,警告を表示した上で許可する。
  その状態のテーブルでは**[新規]と[CSV取込]がグレーアウト**され,ホバーで
  「必須項目(列名)が管理対象外(除外)になっているため登録できません」と表示する
  (meta の `insertBlockedColumns`。batch も SQL エラーではなく日本語の
  validation エラーで事前拒否する)
- バックエンドは meta 構築時に hidden 列を定義ごと除去,readonly はフラグを
  重ねるため,batch / CSV / フィルタ / 並べ替えの全経路で防衛される。
  DB 側で列名が変わった場合,該当の指定は黙って無効になる(テーブルは壊れない)
- **登録後の変更**: 設定 > テーブルメンテナンス > 管理テーブルの**行をクリック**
  すると編集ダイアログが開き,**表示名・説明・列モード**を変更できる
  (接続先と実テーブルは固定表示で変更不可。変更が必要な場合は登録し直す)

## 検索とチップフィルタ(テーブルメンテナンス)

- 検索は**チップフィルタ**に一本化(旧・列ごとの検索窓行は 2026-07-28 撤去。
  API の `q` は残置)
- ツールバー下の **[+フィルタ]** → 列選択 → 型別の演算子+値 → **[適用]でチップ化**。
  演算子は列型で出し分け: 文字列=含む/等しい,数値=比較(>, ≥, <, ≤)/範囲,
  日付=その日/以降/以前/範囲,bool・enum=選択。**カンマ区切りで列内 OR**,
  **「条件を否定(除外)」**で NOT(NULL 行は「一致しない」側に含む)
- チップは**クリックで再編集**(値入りで開く),× で個別解除,2件以上で
  [すべて解除]。表記例: `code: B-0012` / `val > 97` / `day: 7/1〜7/31` / `…(除外)`
- 述語はクライアントで組み立てて `preds`(JSON)で送り,
  **サーバー側で WHERE を組み直して再検索**する(解釈と検証はサーバー。
  backend/internal/predicate が共通変換器)
- 件数カウントは**正確な COUNT(*)** を返す(2026-07-23 に 10,000 件カップを
  廃止。カップがあると末尾ページへ到達できず,追加した行が見えなかったため)
- テーブルは画面内で内部スクロールし,**ヘッダーと件数/ページャは
  常に見える**(sticky)
- **表示件数はフッターで選択**(10 / 20 / 50 / 100 / 500 / 1000。既定 50)。その左の
  **[ページ]プルダウンで任意ページへジャンプ**できる(数字キー入力でも移動可)
- [まとめて保存][まとめて削除]など**動的に現れるボタンはツールバーの余白側
  (固定ボタン群の左)に積む**(固定ボタンの位置がずれない)
- **[複数選択]トグル**(書込権限者のみ)を押している間だけ各行にチェックボックスが
  出る。モード中は**行クリック = 選択のトグル**(編集ダイアログは開かない),
  **行のドラッグで範囲選択**(チェックボックス列の上からでも可),ヘッダーで全選択。
  チェックすると[新規]の右に**[まとめて削除]** が出て,確認(キャンセル / OK)後に
  **単一 Tx で一括削除**する(1件でも失敗すれば全件ロールバック。rowversion 列が
  あれば楽観ロックも効く)。トグル解除で選択も破棄
- **列幅は内容に合わせて最小化**される(90〜480px。均等割りしない)。全ての実列は
  内容幅(または手動調整幅)で固定され,**末尾の疑似カラム(フィラー列)が余白を
  吸収して右端まで届く**。実列とフィラーの間には区切り線が出て「もう1列ある」見た目
  になる。列合計がコンテナ幅を使い切っている間はフィラー幅 0(実質不可視)
- **リサイズはドラッグした列だけが変わる**(伸縮はフィラーが引き受けるため,他の列と
  テーブル全幅は動かない)。フィラーが 0 の状態でさらに広げるとテーブル幅ごと伸びて
  **横スクロール**になる(検証用に 20 列の `demo.dbo.wide` をシード)。ウィンドウの
  伸縮はブラウザの fixed レイアウトが自動追従する(縮めれば余白が先に縮み,実列合計を
  下回ったときだけ横スクロールが出る)。ダブルクリックで内容幅にリセット。
  履歴/設定のテーブル(autoFit なし)は従来どおりペアリサイズ

## CSV 出力/取込(テーブルメンテナンス)

### 出力
ツールバーの **[CSV出力]** → モーダルで **[Excel互換]** チェックと 3 つのスコープを選ぶ:

- **選択範囲出力** … チェック中の行だけ(複数選択モードで選択がある時のみ有効)
- **表示範囲出力** … 現在ページの表示行
- **全件出力** … 現在の列フィルタ条件に一致する全行(サーバー側で
  `encoding/csv` ストリーム生成。`/managed-tables/{id}/rows/export`)

文字コードは既定 UTF-8(BOM なし),**[Excel互換]ON のときだけ BOM 付き**。
全列(readonly 含む,`$rowVersion` 除く),NULL=空,bool=true/false,日付=ISO 8601。
出力は操作履歴に記録される(データ持ち出しの監査。op=rows.export)。

### 取込(2 段階: マージ画面 → (*)行 → まとめて保存)
ツールバーの **[CSV取込]**(書込権限のみ)でファイルを選ぶと精査が走る:

1. **精査**: ヘッダー(列名)を meta と突合。未知列 / 必須列欠落 / 10,000 行超 /
   列数不一致はエラーバナーで中止。各セルを型検証。取込は UTF-8(BOM 有無どちらも可)。
   **自動付与列(IDENTITY 等の readonly 列)は取込では無視**され,マージ画面にも
   表示されない(CSV に含まれていてもエラーにはならない)
2. **マージ画面**(モーダル): 全取込行を表示し,**赤 = 取得済み行と主キー重複** /
   **オレンジ = 無効な行**(型エラー。理由はツールチップ)。行はクリック +
   **ドラッグで範囲選択**。
   - **[重複を排除]** … 赤行を取込予定から除く
   - **[選択行を排除]** … 選択(ドラッグ)行を除く
   - **[適応]** … 無効な行を自動排除して確定
   - 主キー自動採番のテーブルでは重複判定自体を行わない(常に新キーで登録される
     ため。その旨の注記を表示)
3. **(*)行**: 適応した行は**テーブル先頭に,先頭列(通常 ID)へ `*` を付けて**並ぶ
   (DB 未反映。メモリのみ,リロード/画面遷移で破棄)。行クリック(編集)は無効
4. **まとめて保存**: (*)行を複数選択して,[新規]の右の **[まとめて保存]** で
   単一 Tx で insert。重複キー等は「主キーが重複しています(取込 N 行目)」と表示し
   全ロールバック((*)行は残る)。(*)行の[まとめて削除]は API を呼ばずローカル破棄

## UI 共通の挙動

- **全テーブルで列幅をドラッグ調整**できる(`TmResizeColumnsDirective`)。
  境界のドラッグは**ペアリサイズ**(左列 +Δ / 右列 −Δ でテーブル全幅は不変。
  掴んだ境界がマウスに追従する)。右端(最終列)の境界だけはテーブル幅ごと伸縮。
  ドラッグ中は縦のガイドライン表示,境界ホバーでハイライト。
  幅はテーブルごとの localStorage キー(`ftool.colw:*`)に保存され,
  ダブルクリックでリセット(autoFit テーブルは内容幅を再計算)。列には縦の区切り線を表示
- **操作履歴もテーブルメンテと同じ共有グリッド+チップフィルタ**
  (2026-07-28 に共通化。設定>ユーザー権限も同じグリッド)。**全列がフィルタ対象**:
  ユーザー・機能・操作・対象・IP = 文字列,結果 = enum(success/failure),
  日時 = **JST** の 1 日境界で解釈(その日/以降/以前/範囲)。日時列の表示も JST。
  行クリックで detail を展開(共有グリッドの行展開テンプレート)。
  フッターにはページジャンプと表示件数のプルダウン(データテーブルと同じ)。
  ツールバーの **[CSV出力]** で現在のフィルタ条件に一致する全履歴を CSV 出力できる
  (`GET /history/export`。日時 JST,**summary 列 = detail の日本語要約**,
  detail JSON 込み。持ち出し自体も監査記録)
- **行編集の前後値を記録**: rows.batch の履歴 detail に,update/delete 対象行の
  **変更前の値(before)と適用内容(after)** を `changes` として記録する
  (実行前にトランザクション内で SELECT)。insert は要求値そのもの + 採番キー。
  before の全量記録は **1 バッチ 100 行まで**(超過分はキーのみ +
  `changesTruncated: true`。detail の肥大防止)。除外列は SELECT されないため
  前後値にも構造的に載らない
- **言語切替はプルダウン**(日本語 / English。言語追加は provide-i18n と辞書に閉じる)
- **モーダルは画面外クリックでは閉じない**(誤操作防止)。閉じるのは
  Esc / キャンセル / 確定 / × のみ

## 設定画面の構成

/settings は機能単位のカードで編集対象を選ぶ:

```
設定トップ
├─ テーブルメンテナンス設定   … タブ: 接続情報管理 / テーブル管理
├─ ホーム設定                 … 配布テンプレートの管理
├─ 機能設定                   … 機能マスタ(機能の有効/無効)
└─ ユーザー権限               … ユーザー x 機能の権限マトリクス
```

ホーム設定では配布テンプレートの作成/編集/有効切替/削除ができる。
エディタでは機能(サイドバー専用の settings/history は除く)・**テーブルカード
(任意の管理対象テーブルへの直行カード)**・任意リンクを混在で並べ,↑↓ で順序を決める。
テーブルカードは閲覧側で table-maint 権限が無ければ表示されない。

コード実装機能(組込)の「追加・削除」はデプロイと不可分なため UI/API からは
行えない(全行が常に組込)。新しい組込機能を作る場合は ftool_app_actions への
シード追加 + フロントのルート実装が必要。任意 URL のカードは各ユーザーが
自分のダッシュボードにリンクカードとして持つ(上記)。

## 本番デプロイ (MIRACLE LINUX 9.6 / podman)

SQL Server と AD は既存の社内サーバーを使う(コンテナ化しない)。

**ビルド環境と本番環境で作業が分かれる**。backend も frontend もイメージ内で
ビルドが完結するため, 本番サーバーに必要なのは **podman と `deploy/` 配下だけ**
(Node も Go も git もリポジトリ本体も不要)。本番がレジストリへ出られない
場合でもそのまま通用する手順にしてある。

配置先は `/opt/f-tool` を推奨(`/home/<user>/` は避ける — アカウント寿命に
依存し, 秘密情報の権限設計・SELinux コンテキスト・バックアップ方針のいずれも
サービス用途に向かないため)。

### 0) 事前準備(一度だけ)

DB まわりは **SQL クライアントから本番 SQL Server へ直接実行する**
(本番サーバーに sqlcmd は不要。`deploy/initdb/` も転送しない)。

```bash
# DBA にアプリDB(例 ftool)とスキーマを作成してもらう

# ftool_app_ テーブルを作成(-v APP_SCHEMA= は必須。スクリプトは冪等)
sqlcmd -S <host> -d <db> -U <user> -P <password> -v APP_SCHEMA=<スキーマ名> \
    -i deploy/initdb/prod-app-schema.sql
#   (CREATE DATABASE/SCHEMA・サンプルデータは含まない。開発は 01_init.sql)

# 接続パスワードの暗号鍵を生成し,パスワード管理庫へ保管(手順書 §8.2)
openssl rand -base64 32

# MinIO の認証情報を生成し,パスワード管理庫へ保管
# ACCESS_KEY / SECRET_KEY は別々の値にする(2回実行する)。
# MinIO 側の制約: ACCESS_KEY は3文字以上,SECRET_KEY は8文字以上。
# この値で MinIO 自身が初期化される(外部から発行されるものではない)。
openssl rand -base64 24    # -> MINIO_ACCESS_KEY
openssl rand -base64 24    # -> MINIO_SECRET_KEY
```

### 1) ビルド環境(ネットワークのある環境。例: WSL)

```bash
# .env を用意する。転送してそのまま本番で使うため,ここで本番値を書く
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env      # 秘密情報を含むので権限を絞る(rsync -a が保持する)
#   IMAGE_TAG は下でビルドするタグと同じ日付にする
#   MSSQL_DSN / LDAP_* / CONN_ENC_KEY / MINIO_*_KEY は CHANGE_ME のままにしない
#   (MinIO のキーが空だと既定値 minioadmin:minioadmin で起動してしまう)
#   LDAP_MOCK=false であることを必ず確認(true だと誰でもログインできる)
#   受け口に応じて次の3項目をセットで設定する(手順書 §1.3a):
#     環境A このスタックの nginx を直接使う(ホストに nginx が居ない)
#       FRONTEND_BIND=0.0.0.0 / FRONTEND_PORT=80 / NGINX_CONF=standalone.conf
#       -> 利用者は http://<IP>/
#     環境B ホストに既存の nginx がある(2段構成。.env.example の既定値)
#       FRONTEND_BIND=127.0.0.1 / FRONTEND_PORT=8081 / NGINX_CONF=default.conf
#       -> 利用者は http://<IP>:8082/(ホスト nginx の listen。下記 3-2)

# イメージをビルド。タグは日付(:latest にしない — 本番に何が入っているか
# 追えなくなる。切り戻しも日付タグの指定だけで済む)
IMAGE_TAG=$(date +%F) podman compose -f deploy/compose.yaml build

# 4イメージを1つの tar へ。--multi-image-archive は必須
# (付けないとエラーも出ずに最初の1つしか保存されない。
#  サイズで気付ける: 4イメージ = 約278MB / backend だけ = 約17MB)
podman save --multi-image-archive -o ftool-$(date +%F).tar \
  localhost/ftool-backend:$(date +%F) \
  localhost/ftool-frontend:$(date +%F) \
  docker.io/valkey/valkey:8-alpine \
  docker.io/minio/minio:latest
```

ここでは `up -d` しない(本番の DB・AD へ繋ぎに行ってしまうため)。

### 2) 転送

```bash
# 送るのは2種類だけ
rsync -av ftool-$(date +%F).tar user@server:/opt/f-tool/
# initdb/ は SQL クライアントから実行済みなので送らない
rsync -av --delete --exclude 'initdb/' deploy/ user@server:/opt/f-tool/deploy/
```

本番側へ渡るのは `compose.yaml` / `nginx/*.conf` / `.env` の3種類。
`.env` は秘密情報(`CONN_ENC_KEY` / `LDAP_BIND_PASSWORD` / `MSSQL_DSN` の
パスワード)を含むが, rsync は SSH 経由なので転送経路は暗号化されている。
`-a` がパーミッションを保持するため, 1) で `chmod 600` してあれば
本番側でも 600 のまま置かれる。

ビルド環境側に本番の `.env` が残る点は認識しておくこと
(`.gitignore` 済みなのでコミットされる心配はない)。

### 3) 本番環境

スキーマ適用と `.env` の記入は済んでいるので, ここは load して起動するだけ。

```bash
cd /opt/f-tool

# 3-1) イメージを読み込む
podman load -i ftool-<YYYY-MM-DD>.tar

# 3-2) 環境B(前段にホスト nginx が居る)の場合だけ, ひな形を配置する
#      ※ この作業だけ deploy/ の外。環境A では不要
cp deploy/nginx/host-frontend.conf.example /etc/nginx/conf.d/ftool.conf
vi /etc/nginx/conf.d/ftool.conf     # listen(既定 8082)/ server_name を確認
nginx -t && systemctl reload nginx
#      コンテナ用の conf(default.conf / standalone.conf)は deploy/nginx/ に
#      含まれ,.env の NGINX_CONF で選ぶだけなので配置作業は不要

# 3-3) 起動(--build は付けない。付けるとビルドを試みて失敗する)
podman compose -f deploy/compose.yaml up -d

# 3-4) ヘルスチェック: 401 なら正常(未認証応答)
#      環境A は :80,環境B は :8081(FRONTEND_PORT に合わせる)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/api/v1/auth/me

# 3-5) 管理者となるユーザーで一度ログイン
#      -> ftool_app_users に自動登録されるが権限はまだ無い
```

最後に **SQL クライアントから最初の admin 権限を付与する**
(`deploy/initdb/02_grant_admin.sql.example` を参考に,対象ユーザーへ
`table-maint` / `settings` の admin を MERGE で付与)。
**これをやらないと誰も設定画面に入れない。**
以後の権限付与は画面(設定 > ユーザー権限)から行える。

### バージョンアップ

新しい日付タグで 1) 〜 3-5) を繰り返す(DDL 追補があれば先に適用)。
切り戻しは **`.env` の `IMAGE_TAG` を前の日付へ戻して `up -d`** するだけ
(旧タグのイメージを消していない場合)。詳細は手順書 §10。

---

### 構成メモ

- nginx が SPA 配信と `/api/` → backend:8080 のプロキシを行う(同一オリジン,CORS 不要)
- SPA はイメージに焼き込まれる(`frontend/Dockerfile` が node でビルドして
  nginx へコピー)。ホストに Node は不要で,backend と版がずれない
- backend / redis / minio は `expose` のみ = コンテナネットワーク内限定。
  外部へ出るのは nginx の1ポートだけ(SQL Server と AD は外部サーバー)
- Valkey はセッション専用(永続化なし。再起動 = 全員再ログイン)。
  Redis からはライセンス変更(非 OSS 化)を機に移行。RESP 互換のため
  backend(go-redis)や `REDIS_ADDR` 等の変数名はそのまま
- SELinux enforcing 環境向けにマウントへ `:z` 付与済み
- podman で :80 が使えない場合(rootless 等)は `.env` の `FRONTEND_PORT` を
  上げるか `net.ipv4.ip_unprivileged_port_start` を調整する
  (compose.yaml を直接編集する必要はない)

### 主要な環境変数(backend)

| 変数 | 既定値 | 説明 |
|---|---|---|
| `MSSQL_DSN` | 開発値 | `sqlserver://user:pass@host:1433?database=ftool` |
| `APP_DB_SCHEMA` | dbo | ftool_app_ テーブルを置くスキーマ。DB側の都合で専用スキーマを使う場合に変更(本番は `prod-app-schema.sql` の `-v APP_SCHEMA=`,開発は `01_init.sql` の `:setvar APP_SCHEMA` と揃える) |
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
| `MINIO_ENDPOINT` | minio:9000 | 監査履歴 detail の1MB超過分の退避先(MinIO)。既定で有効。空にすると退避機能自体を無効化(超過分は記録時点で破棄。履歴の行は残る) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | なし | MinIO の認証情報。`CONN_ENC_KEY` 同様コミットしない |
| `MINIO_BUCKET` | audit-overflow | 退避先バケット名(無ければ起動時に自動作成) |
| `MINIO_USE_SSL` | false | MinIO への接続にTLSを使うか |

## 運用上の注意(データ分類)

本ツールは**財務関連データ・個人情報を扱わない**前提で運用する。この分類を守るため:

- **個人情報・機微情報を含むテーブルは管理対象に登録しない**
  (テーブル登録ダイアログにも注意文を表示している)
- 一部の列にだけ個人情報が入りうる場合は,登録時にその列を**除外(hidden)**に
  指定する。除外列は取得もされないため,画面・CSV・操作履歴のいずれにも残らない
- テンプレート名・説明などの**自由入力欄に個人情報を記入しない**
  (入力値は操作履歴に記録され,履歴は監査証跡のため削除できない)。
  なお**個人リンクのタイトル/URL は履歴に内容を記録しない**
  (本人専用データのためイベントの発生のみ記録する。2026-07-19 のデータ最小化方針)
- 操作履歴の保持期間・アーカイブは今後の運用規程に合わせて設定する
  (現状は無期限保持。性能面の目安と対応案は Sprint 5 候補として管理)

## 設計メモ

- **識別子のインジェクション対策**: 動的テーブルの schema/table/列名は登録時に
  カタログと突合した名前のみを `[ ]` 引用(`]` は二重化)で埋め込む。値は全て
  `@pN` プレースホルダ。orderBy 等のユーザー入力列名はイントロスペクション
  結果との突合を通ったものだけ使う。
- **楽観ロック**: rowversion 列を持つテーブルは `$rowVersion` 予約キーで
  base64 値を往復させ,不一致は 409 (row_version_mismatch)。持たないテーブルは
  主キーのみで更新(last-write-wins)。
- **権限の即時反映**: auth_level はセッションに入れず毎リクエスト DB から解決。
  admin の権限変更が再ログインなしで効く。
- **監査は best-effort**: 履歴の書込失敗で業務操作は失敗させない(ログのみ)。
  逆に業務がロールバックしても失敗の事実は履歴に残る。
- **対応外の列型**(varbinary/xml 等)は string + readonly に落とし,
  テーブル全体は使用可能なまま保つ。

## own memo
デプロイ前に以下で空きを確認してから実施。
ss -ltnp | grep -E ':(8081|8082)'