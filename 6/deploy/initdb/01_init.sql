-- deploy/initdb/01_init.sql
-- 開発/検証専用の初期化スクリプト(MIRACLE LINUX 上の Podman コンテナの
-- SQL Server 向け)。compose.dev の mssql-init が sqlcmd で実行する。
-- CREATE DATABASE / CREATE SCHEMA を含み,サンプル業務テーブル(products/
-- customers)と検証用 demo DB(materials/bigdata/wide/codes)も作成する。
--
-- 本番は別ホスト(Windows)上の既存 SQL Server を間借りする構成であり,
-- DB 作成は DBA が行う。接続アカウントは SQL Server 認証で,権限は
-- 特定スキーマ内に閉じている(CREATE SCHEMA / CREATE DATABASE 権限は無い)。
-- そのため本番では,このファイルではなく ftool_app_* テーブルのみを含む
-- deploy/initdb/prod-app-schema.sql を使うこと。
--
-- 本ツール自身のテーブルは ftool_app_ 接頭辞で統一し,管理対象の業務テーブルと
-- 区別する(2026-07-22 決定: 単に app_ だと業務テーブル側の命名と衝突しうるため)。
-- ftool_app_* テーブルの DDL 内容は prod-app-schema.sql と同一に保つこと
-- (サンプルデータ・demo DB 部分を除く)。
--
-- S41 で全面刷新(旧 app_* からのデータ移行は行わない。開発 DB は
-- `make dev_down`(volume 破棄)→ `make dev_up` で作り直すこと)。

-- ftool_app_ テーブルを置くスキーマ。既定は dbo。
-- 本番でDB側から専用スキーマを指定された場合は次の1行を書き換えて実行し,
-- backend の環境変数 APP_DB_SCHEMA にも同じ値を設定する。
-- (sqlcmd のスクリプト変数。-v より :setvar が優先されるため直接編集する)
:setvar APP_SCHEMA dbo

IF DB_ID(N'ftool') IS NULL
    CREATE DATABASE ftool;
GO
USE ftool;
GO

-- スキーマが無ければ作成(dbo のときは既存なのでスキップされる)。
IF SCHEMA_ID(N'$(APP_SCHEMA)') IS NULL
    EXEC(N'CREATE SCHEMA [$(APP_SCHEMA)]');
GO

-- ----------------------------------------------------------- ftool_app_users
-- LDAP 認証成功時に MERGE で自動登録されるユーザー台帳。キーは AD objectGUID。
-- created_by/updated_by は自己登録(本人の LDAP ログイン)なので本人の
-- username を毎回そのまま入れる(authz.EnsureUser 参照)。
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_users', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_users (
        object_guid   UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_ftool_app_users PRIMARY KEY,
        username      NVARCHAR(256) NOT NULL,   -- sAMAccountName スナップショット(照合には使わない)
        display_name  NVARCHAR(256) NOT NULL,
        email         NVARCHAR(320) NULL,
        last_login_at DATETIME2(0)  NULL,
        created_by    NVARCHAR(256) NOT NULL,
        updated_by    NVARCHAR(256) NOT NULL,
        created_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_users_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_users_updated DEFAULT SYSUTCDATETIME()
    );
    -- 非ユニーク: AD のリネームで username が入れ替わっても照合キーは object_guid のみ
    CREATE INDEX ix_ftool_app_users_username ON $(APP_SCHEMA).ftool_app_users(username);
END
GO

-- ---------------------------------------------------------------------------
-- 【将来計画メモ】ユーザーディレクトリテーブル(2026-07-19 設計合意・未実装)
--
-- LDAP の情報をミラーする名簿テーブルを ftool_app_users とは別に追加する予定:
--   ftool_app_user_directory (
--       object_guid   UNIQUEIDENTIFIER PK,   -- app_users と同じ不変キー(entryUUID/objectGUID)
--       username      NVARCHAR(256) NOT NULL,-- uid/sAMAccountName(改姓で変わりうる→非PK・非UNIQUE)
--       display_name  NVARCHAR(256) NOT NULL,
--       email         NVARCHAR(320) NULL,
--       department    NVARCHAR(256) NULL,    -- ou / department
--       employee_no   NVARCHAR(64)  NULL,    -- employeeNumber(あれば)
--       title         NVARCHAR(128) NULL,
--       ldap_dn       NVARCHAR(512) NULL,    -- 追跡/デバッグ用
--       enabled       BIT NOT NULL DEFAULT 1,-- LDAP から消えた人は物理削除せず無効化(soft delete)
--       synced_at     DATETIME2(0) NOT NULL, -- 最終同期時刻
--       created_at / updated_at
--   )
-- 設計方針:
--   - ftool_app_users(認証の記録)とは分離し,LDAP を権威とする読み取り専用ミラーとする
--   - 属性はデータ最小化: 業務で使う列だけ取り込む(電話番号等は持たない)
--   - 更新タイミングは3本立て:
--       (1) ログイン時同期(本人分を upsert。現行 ftool_app_users 方式の延長)
--       (2) 日次バッチ(全件 MERGE + 消えた人を enabled=0。退職検知はこれのみ)
--       (3) 設定画面の手動同期ボタン(settings:admin。人事異動直後の即時反映用)
--   - 同期は操作履歴に記録する(op=user-sync,追加/更新/無効化の件数。実行主体は擬似ユーザー)
--   - 注意: アカウント再作成(退職→再入社)は別 GUID = 別人扱いになる。
--     employee_no で同一人物を追う場合の扱いは実装時に決める
--   - 同期は ftool_app_users(認証記録)には書かない(2026-07-19 検討):
--       * ftool_app_users は「このツールを実際に使った/使わせると決めた人」の
--         記録で,全社員を事前投入すると意味が薄まり,権限マトリクス画面も
--         未利用者で埋まる。初回ログイン時の既定権限自動付与が全社員に
--         静かに広がるリスクもある
--       * ftool_app_users 行の作成契機は従来どおり (a) 初回ログイン,に加えて
--         (b) 管理者がディレクトリから選んで事前に権限付与したとき,の2つ
--         (ディレクトリ導入で「ログイン前に権限を付与できない」という
--         現在のブートストラップ問題が解消できる)
--       * ディレクトリで enabled=0 になった人の ftool_app_user_auth は
--         バッチで棚卸し(失効)するのが衛生的(認証自体は LDAP 消滅で
--         既に不可能なので必須ではない)
-- ---------------------------------------------------------------------------
GO

-- ------------------------------------------------------------- ftool_app_actions
-- 機能マスタ。ダッシュボードのカードはこのテーブルから生成される。
-- 機能の追加は常にコード実装+シードとセットで行う(API 経由の追加/削除は
-- 提供しない。is_builtin のような「組込か否か」の区別は不要 — 全行が
-- 常に組込のため)。
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_actions', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_actions (
        id         INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_actions PRIMARY KEY,
        code       NVARCHAR(64)  NOT NULL CONSTRAINT ux_ftool_app_actions_code UNIQUE,
        name       NVARCHAR(128) NOT NULL,
        icon       NVARCHAR(64)  NOT NULL CONSTRAINT df_ftool_app_actions_icon DEFAULT N'apps',  -- Material Symbols 名
        sort_order INT           NOT NULL CONSTRAINT df_ftool_app_actions_sort DEFAULT 0,
        enabled    BIT           NOT NULL CONSTRAINT df_ftool_app_actions_enabled DEFAULT 1,
        created_by NVARCHAR(256) NOT NULL,
        updated_by NVARCHAR(256) NOT NULL,
        created_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_actions_created DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_actions_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

-- --------------------------------------------------------- ftool_app_user_auth
-- 認可: ユーザー x 機能 ごとの権限レベル。行が無い機能は「権限なし」。
--   admin > maintainer > user
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_user_auth', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_user_auth (
        object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_auth_user REFERENCES $(APP_SCHEMA).ftool_app_users(object_guid) ON DELETE CASCADE,
        action_id   INT NOT NULL CONSTRAINT fk_ftool_app_user_auth_action REFERENCES $(APP_SCHEMA).ftool_app_actions(id) ON DELETE CASCADE,
        auth_level  NVARCHAR(16) NOT NULL CONSTRAINT ck_ftool_app_user_auth_level CHECK (auth_level IN (N'admin', N'maintainer', N'user')),
        created_by  NVARCHAR(256) NOT NULL,
        updated_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_auth_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_ftool_app_user_auth PRIMARY KEY (object_guid, action_id)
    );
    CREATE INDEX ix_ftool_app_user_auth_action ON $(APP_SCHEMA).ftool_app_user_auth(action_id);
END
GO

-- ------------------------------------------------------- ftool_app_connections
-- 管理対象テーブルの接続先。admin が設定画面から登録する。
-- パスワードは AES-GCM で暗号化(鍵は env CONN_ENC_KEY)。
-- 「既定接続」(アプリ自身の DB = env MSSQL_DSN) はこのテーブルには置かず,
-- ftool_app_managed_tables.connection_id = NULL で表現する(資格情報を DB に複製しない)。
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_connections', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_connections (
        id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_connections PRIMARY KEY,
        name          NVARCHAR(128)  NOT NULL CONSTRAINT ux_ftool_app_connections_name UNIQUE,   -- 表示名(履歴の target にも使う)
        host          NVARCHAR(255)  NOT NULL,
        port          INT            NOT NULL CONSTRAINT df_ftool_app_connections_port DEFAULT 1433,
        database_name SYSNAME        NOT NULL,
        username      NVARCHAR(128)  NOT NULL,
        password_enc  VARBINARY(512) NOT NULL,           -- 12byte GCM nonce || 暗号文+タグ
        options       NVARCHAR(256)  NULL,               -- 追加 DSN パラメータ(例: encrypt=disable)
        schema_name   SYSNAME        NULL,               -- NULL = 制限なし / 非NULL = このスキーマ限定
        enabled       BIT            NOT NULL CONSTRAINT df_ftool_app_connections_enabled DEFAULT 1,
        created_by    NVARCHAR(256)  NOT NULL,
        updated_by    NVARCHAR(256)  NOT NULL,
        created_at    DATETIME2(0)   NOT NULL CONSTRAINT df_ftool_app_connections_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_ftool_app_connections_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

-- --------------------------------------------------- ftool_app_managed_tables
-- テーブル管理の管理対象。admin が UI から登録する。
-- pk_columns は登録時スナップショット(CSV)。実際のメタデータは毎回
-- INFORMATION_SCHEMA / sys カタログから取得し直す。
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_managed_tables', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_managed_tables (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_managed_tables PRIMARY KEY,
        -- connection_id: NULL = 既定接続(アプリ自身の DB)。
        connection_id INT NULL CONSTRAINT fk_ftool_app_managed_tables_conn REFERENCES $(APP_SCHEMA).ftool_app_connections(id),
        schema_name  SYSNAME       NOT NULL,
        table_name   SYSNAME       NOT NULL,
        display_name NVARCHAR(128) NOT NULL,
        -- slug: URL(/tables/{slug})で使う管理名。英字始まりの半角英数字のみ
        -- (検証は API 側)。既定照合順序(CI)により大文字小文字を区別せず一意。
        slug         NVARCHAR(64)  NOT NULL,
        description  NVARCHAR(400) NULL,
        pk_columns   NVARCHAR(400) NOT NULL,
        -- 列モード(CSV)。readonly = 表示のみ,hidden = SELECT 自体から除外。
        readonly_columns NVARCHAR(400) NOT NULL CONSTRAINT df_ftool_app_managed_tables_ro DEFAULT N'',
        hidden_columns   NVARCHAR(400) NOT NULL CONSTRAINT df_ftool_app_managed_tables_hd DEFAULT N'',
        -- 固定値列(JSON 配列)。保存時にサーバーが値を自動セットする列の指定。
        -- 例: [{"name":"updated_at","kind":"now","applyOn":"both"},
        --      {"name":"updated_by","kind":"literal","value":"f-tool","applyOn":"both"}]
        fixed_columns    NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_managed_tables_fx DEFAULT N'[]',
        sort_order   INT           NOT NULL CONSTRAINT df_ftool_app_managed_tables_sort DEFAULT 0,
        enabled      BIT           NOT NULL CONSTRAINT df_ftool_app_managed_tables_enabled DEFAULT 1,
        created_by   NVARCHAR(256) NOT NULL,
        updated_by   NVARCHAR(256) NOT NULL,
        created_at   DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_managed_tables_created DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_managed_tables_updated DEFAULT SYSUTCDATETIME(),
        -- 接続スコープ付き一意制約。SQL Server の UNIQUE は NULL 同士を等価と
        -- 扱うため,(NULL, schema, table) も1件に制限される = 既定接続スコープ。
        CONSTRAINT ux_ftool_app_managed_tables_conn_target UNIQUE (connection_id, schema_name, table_name),
        -- 管理名は URL 空間を占有するため全テーブル横断で一意。
        CONSTRAINT ux_ftool_app_managed_tables_slug UNIQUE (slug)
    );
END
GO

-- 既存 DB への slug 列の後付け(本番未稼働のための簡易移行。table_name を
-- 初期値として backfill し,重複時は id を後置して衝突を避ける)。
IF COL_LENGTH(N'$(APP_SCHEMA).ftool_app_managed_tables', N'slug') IS NULL
BEGIN
    ALTER TABLE $(APP_SCHEMA).ftool_app_managed_tables ADD slug NVARCHAR(64) NULL;
END
GO
IF EXISTS (SELECT 1 FROM $(APP_SCHEMA).ftool_app_managed_tables WHERE slug IS NULL)
BEGIN
    UPDATE m SET slug =
        CASE WHEN EXISTS (
            SELECT 1 FROM $(APP_SCHEMA).ftool_app_managed_tables o
            WHERE o.table_name = m.table_name AND o.id < m.id)
        THEN LEFT(m.table_name, 52) + N'-' + CAST(m.id AS NVARCHAR(11))
        ELSE LEFT(m.table_name, 64) END
    FROM $(APP_SCHEMA).ftool_app_managed_tables m
    WHERE m.slug IS NULL;
END
GO
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'$(APP_SCHEMA).ftool_app_managed_tables')
      AND name = N'slug' AND is_nullable = 1)
BEGIN
    ALTER TABLE $(APP_SCHEMA).ftool_app_managed_tables ALTER COLUMN slug NVARCHAR(64) NOT NULL;
    ALTER TABLE $(APP_SCHEMA).ftool_app_managed_tables
        ADD CONSTRAINT ux_ftool_app_managed_tables_slug UNIQUE (slug);
END
GO

-- --------------------------------------------------- ftool_app_operation_history
-- 全操作の監査履歴。ログイン/ログアウト/行編集/設定変更など全てここに残す。
-- username は非正規化(ユーザー削除後も履歴が読めるように)。
-- 追記専用のため created_by/updated_by は持たない(username が実質 created_by)。
-- action_code は「監査カテゴリ」であり ftool_app_actions への FK ではない
-- (意図的): 機能マスタのコード(tables/settings/history)に加え,
-- 機能マスタに存在しない疑似カテゴリ(auth=ログイン/ログアウト,
-- dashboard=旧個人ダッシュボード操作。S48で廃止,過去行のみ)も入る。カテゴリの粒度が機能マスタ
-- より粗い/別軸なので FK を張らない。
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_operation_history', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_operation_history (
        id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_operation_history PRIMARY KEY,
        occurred_at DATETIME2(3)     NOT NULL CONSTRAINT df_ftool_app_operation_history_at DEFAULT SYSUTCDATETIME(),
        object_guid UNIQUEIDENTIFIER NULL,      -- 認証失敗など本人不明の操作は NULL
        username    NVARCHAR(256)    NOT NULL,
        action_code NVARCHAR(64)     NOT NULL,  -- 'auth' / 'tables' / 'settings' / 'history'(過去行に 'dashboard' あり)
        operation   NVARCHAR(64)     NOT NULL,  -- 'login' / 'rows.batch' / 'managed-table.create' ...
        target      NVARCHAR(512)    NULL,      -- 例: 'dbo.products', '<接続名>:schema.table', 'user:<guid>'
        detail      NVARCHAR(MAX)    NULL,      -- JSON(変更前後・件数など)
        result      NVARCHAR(16)     NOT NULL CONSTRAINT ck_ftool_app_operation_history_result CHECK (result IN (N'success', N'failure')),
        error_code  NVARCHAR(64)     NULL,
        client_ip   NVARCHAR(45)     NULL
    );
    CREATE INDEX ix_ftool_app_operation_history_at     ON $(APP_SCHEMA).ftool_app_operation_history(occurred_at DESC);
    CREATE INDEX ix_ftool_app_operation_history_user   ON $(APP_SCHEMA).ftool_app_operation_history(object_guid, occurred_at DESC);
    CREATE INDEX ix_ftool_app_operation_history_target ON $(APP_SCHEMA).ftool_app_operation_history(action_code, target);
END
GO

-- --------------------------------------------------------------------- シード
-- 組込機能。code は API/フロントのルーティングと対応するため変更不可。
-- settings/history はダッシュボードのカードではなくサイドバーに表示される。
-- sort_order: tables/history は通常のダッシュボード運用順,settings は
-- 999(将来機能が増えても常に最後になるよう十分大きな値)。
MERGE $(APP_SCHEMA).ftool_app_actions AS t
USING (VALUES
    (N'tables', N'テーブル管理', N'table_view', 1),
    (N'history',     N'操作履歴',             N'history',  2),
    (N'settings',    N'設定',                 N'settings', 999)
) AS s (code, name, icon, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, name, icon, sort_order, enabled, created_by, updated_by)
    VALUES (s.code, s.name, s.icon, s.sort_order, 1, N'setup:initdb', N'setup:initdb');
GO

-- -------------------------------------------------- ftool_app_user_settings
-- ユーザー個人の設定(本人だけが参照・変更する)。項目ごとに列を増やすと
-- その都度 DDL/API が要るため,キー・値の1行1設定で持つ。
-- 値は文字列(真偽値は N'1'/N'0')。行が無い = 既定値。
--   header_clock: ヘッダー時計の表示(none/minute/second/custom)
--   header_clock_format: header_clock=custom のときの書式文字列
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_user_settings', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_user_settings (
        object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_settings_user REFERENCES $(APP_SCHEMA).ftool_app_users(object_guid) ON DELETE CASCADE,
        setting_key NVARCHAR(64)  NOT NULL,
        value       NVARCHAR(400) NOT NULL,
        created_by  NVARCHAR(256) NOT NULL,
        updated_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_settings_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_settings_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_ftool_app_user_settings PRIMARY KEY (object_guid, setting_key)
    );
END
GO

-- -------------------------------------------------- ftool_app_home_config
-- ホーム画面のウィジェット構成(全ユーザー共通の単一行 JSON。S48)。
-- JSON の中身の構造はフロント(レンダラ/ビルダー)が正で,バックエンドは
-- 「有効な JSON・64KB 以下」だけを検証して不透明に保存する。
-- 行が無い = 未設定(フロントは組込の既定表示にフォールバック)。
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_home_config', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_home_config (
        id          INT           NOT NULL CONSTRAINT pk_ftool_app_home_config PRIMARY KEY CONSTRAINT ck_ftool_app_home_config_single CHECK (id = 1),
        config      NVARCHAR(MAX) NOT NULL CONSTRAINT ck_ftool_app_home_config_json CHECK (ISJSON(config) = 1),
        created_by  NVARCHAR(256) NOT NULL,
        updated_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_home_config_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_home_config_updated DEFAULT SYSUTCDATETIME()
    );
END
GO


-- モックユーザー(auth.MockGUID)。LDAP_MOCK=true でのログインは MERGE の
-- MATCHED 側に入るため,ここで付与した admin 権限が維持される。
MERGE $(APP_SCHEMA).ftool_app_users AS t
USING (SELECT CAST('00000000-0000-0000-0000-000000000001' AS UNIQUEIDENTIFIER) AS g) AS s
ON t.object_guid = s.g
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, email, created_by, updated_by)
    VALUES (s.g, N'admin', N'Mock Admin', N'admin@example.local', N'setup:initdb', N'setup:initdb');
GO

MERGE $(APP_SCHEMA).ftool_app_user_auth AS t
USING (
    SELECT CAST('00000000-0000-0000-0000-000000000001' AS UNIQUEIDENTIFIER) AS g, a.id AS action_id
    FROM $(APP_SCHEMA).ftool_app_actions a
    WHERE a.code IN (N'tables', N'settings')
) AS s
ON t.object_guid = s.g AND t.action_id = s.action_id
WHEN NOT MATCHED THEN
    INSERT (object_guid, action_id, auth_level, created_by, updated_by)
    VALUES (s.g, s.action_id, N'admin', N'setup:initdb', N'setup:initdb');
GO

-- ------------------------------------------------------ サンプル業務テーブル
-- 商品マスタ: rowversion あり(楽観ロックの検証用)
IF OBJECT_ID(N'dbo.products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.products (
        id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code       NVARCHAR(20)  NOT NULL,
        name       NVARCHAR(100) NOT NULL,
        category   NVARCHAR(50)  NULL,
        price      DECIMAL(12,2) NOT NULL,
        stock      INT           NOT NULL,
        updated_at DATETIME2     NOT NULL CONSTRAINT df_products_updated DEFAULT SYSUTCDATETIME(),
        row_ver    ROWVERSION    NOT NULL
    );

    INSERT INTO dbo.products (code, name, category, price, stock) VALUES
        (N'A-1001', N'ボールペン 黒',   N'文具',     120,  500),
        (N'A-1002', N'ノート A5',       N'文具',     250,  300),
        (N'B-2001', N'USBケーブル',     N'周辺機器', 890,   80),
        (N'C-3001', N'マウス 無線',     N'周辺機器', 1980,  45),
        (N'C-3002', N'キーボード',      N'周辺機器', 3480,  22);
END
GO

-- 取引先マスタ: rowversion なし(任意テーブルの last-write-wins パスの検証用)
IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.customers (
        id       INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code     NVARCHAR(20)  NOT NULL,
        name     NVARCHAR(100) NOT NULL,
        address  NVARCHAR(200) NULL,
        phone    NVARCHAR(20)  NULL,
        active   BIT           NOT NULL CONSTRAINT df_customers_active DEFAULT 1
    );

    INSERT INTO dbo.customers (code, name, address, phone) VALUES
        (N'T-001', N'株式会社アルファ', N'東京都千代田区1-1-1', N'03-1111-2222'),
        (N'T-002', N'ベータ商事',       N'大阪府大阪市2-2-2',   N'06-3333-4444'),
        (N'T-003', N'ガンマ工業',       N'愛知県名古屋市3-3-3', N'052-555-6666');
END
GO

-- サンプルを管理対象として事前登録(開発時にすぐ画面で確認できるように)。
MERGE $(APP_SCHEMA).ftool_app_managed_tables AS t
USING (VALUES
    (N'dbo', N'products',  N'商品マスタ',   N'products',  N'サンプル: rowversion あり', N'id', 1),
    (N'dbo', N'customers', N'取引先マスタ', N'customers', N'サンプル: rowversion なし', N'id', 2)
) AS s (schema_name, table_name, display_name, slug, description, pk_columns, sort_order)
ON t.schema_name = s.schema_name AND t.table_name = s.table_name AND t.connection_id IS NULL
WHEN NOT MATCHED THEN
    INSERT (schema_name, table_name, display_name, slug, description, pk_columns, sort_order, created_by, updated_by)
    VALUES (s.schema_name, s.table_name, s.display_name, s.slug, s.description, s.pk_columns, s.sort_order, N'setup:initdb', N'setup:initdb');
GO

-- -------------------------------------------------- 検証用 demo データベース
-- 「別接続」の登録テスト用(開発専用)。同一 dev サーバー上の別 DB を
-- 別接続として登録することでプール管理・クロス DB 動作を検証できる。
IF DB_ID(N'demo') IS NULL
    CREATE DATABASE demo;
GO
USE demo;
GO
IF OBJECT_ID(N'dbo.materials', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.materials (
        id       INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code     NVARCHAR(20)  NOT NULL,
        name     NVARCHAR(100) NOT NULL,
        unit     NVARCHAR(10)  NULL,
        qty      DECIMAL(12,2) NOT NULL CONSTRAINT df_materials_qty DEFAULT 0,
        row_ver  ROWVERSION    NOT NULL
    );

    INSERT INTO dbo.materials (code, name, unit, qty) VALUES
        (N'M-001', N'鋼板 1.6mm', N'枚', 120),
        (N'M-002', N'ボルト M8',  N'本', 4500),
        (N'M-003', N'塗料 白',    N'缶', 18);
END
GO

-- 件数カップ(10,000+ 表示)と検索性能の検証用に 15,000 行のテーブルを用意。
IF OBJECT_ID(N'dbo.bigdata', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.bigdata (
        id   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(20) NOT NULL,
        val  INT          NOT NULL
    );

    WITH nums AS (
        SELECT TOP (15000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
        FROM sys.all_objects a CROSS JOIN sys.all_objects b
    )
    INSERT INTO dbo.bigdata (code, val)
    SELECT CONCAT(N'B-', FORMAT(n, '00000')), n % 100 FROM nums;
END
GO

-- 多列テーブル(20列)。横スクロール・列幅・フィルタの検証用。
IF OBJECT_ID(N'dbo.wide', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.wide (
        id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code        NVARCHAR(20)  NOT NULL,
        name        NVARCHAR(50)  NOT NULL,
        category    NVARCHAR(30)  NULL,
        supplier    NVARCHAR(30)  NULL,
        warehouse   NVARCHAR(30)  NULL,
        line        NVARCHAR(20)  NULL,
        owner       NVARCHAR(30)  NULL,
        status      NVARCHAR(20)  NULL,
        note        NVARCHAR(200) NULL,
        qty         INT           NOT NULL DEFAULT 0,
        min_qty     INT           NULL,
        max_qty     INT           NULL,
        price       DECIMAL(12,2) NULL,
        cost        DECIMAL(12,2) NULL,
        weight      DECIMAL(10,3) NULL,
        active      BIT           NOT NULL DEFAULT 1,
        approved    BIT           NULL,
        received_on DATE          NULL,
        updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );

    WITH nums AS (
        SELECT TOP (200) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
        FROM sys.all_objects
    )
    INSERT INTO dbo.wide (code, name, category, supplier, warehouse, line, owner,
                          status, note, qty, min_qty, max_qty, price, cost, weight,
                          active, approved, received_on)
    SELECT
        CONCAT(N'W-', FORMAT(n, '0000')),
        CONCAT(N'部品', n),
        CONCAT(N'分類', n % 5),
        CONCAT(N'仕入先', n % 7),
        CONCAT(N'倉庫', n % 3),
        CONCAT(N'L', n % 4),
        CONCAT(N'担当', n % 6),
        CASE n % 3 WHEN 0 THEN N'有効' WHEN 1 THEN N'停止' ELSE N'検討中' END,
        CONCAT(N'備考テキスト ', n),
        n * 10, n, n * 20,
        n * 100.5, n * 80.25, n * 0.125,
        CASE WHEN n % 2 = 0 THEN 1 ELSE 0 END,
        CASE WHEN n % 3 = 0 THEN 1 ELSE 0 END,
        DATEADD(DAY, -n, CAST(GETDATE() AS DATE))
    FROM nums;
END
GO

-- 手動主キー(非 IDENTITY)のテーブル。CSV 取込の重複キー検証用
-- (IDENTITY 主キーのテーブルでは insert の主キー重複が原理的に発生しないため)。
IF OBJECT_ID(N'dbo.codes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.codes (
        code NVARCHAR(20) NOT NULL PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        val  INT           NOT NULL DEFAULT 0
    );
    INSERT INTO dbo.codes (code, name, val) VALUES
        (N'C-001', N'コード1', 10),
        (N'C-002', N'コード2', 20),
        (N'C-003', N'コード3', 30);
END
GO

-- 列モード(readonly/hidden)検証用。phone を除外・updated_at を編集不可にして
-- 管理テーブル登録する(deploy/initdb/dev-seed-connections.mjs が登録する)。
-- E2E(e2e/e2e.mjs)がこの構造・データに依存する。
IF OBJECT_ID(N'dbo.audit_demo', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_demo (
        id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name       NVARCHAR(100) NOT NULL,
        phone      NVARCHAR(40)  NULL,
        updated_at DATETIME2     NOT NULL CONSTRAINT df_audit_demo_updated DEFAULT SYSUTCDATETIME()
    );
    INSERT INTO dbo.audit_demo (name, phone) VALUES
        (N'demo1', N'000-0000-0000'),
        (N'demo2', NULL);
END
GO

-- 接続のスキーマ制限(ftool_app_connections.schema_name)の検証用。
-- dbo 以外のスキーマに 1 テーブルだけ置き,制限付き接続を登録して
-- 「そのスキーマの表しか候補に出ない」ことを確認できるようにする。
IF SCHEMA_ID(N'e2e_schema') IS NULL
    EXEC('CREATE SCHEMA e2e_schema');
GO
IF OBJECT_ID(N'e2e_schema.e2e_only', N'U') IS NULL
BEGIN
    CREATE TABLE e2e_schema.e2e_only (
        id  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        val NVARCHAR(50) NOT NULL
    );
    INSERT INTO e2e_schema.e2e_only (val) VALUES (N'e2e-1'), (N'e2e-2');
END
GO
USE ftool;
GO
