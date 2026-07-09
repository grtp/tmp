-- deploy/initdb/01_init.sql
-- 開発用 SQL Server の初期化。compose.dev の mssql-init が sqlcmd で実行する。
-- 本番は既存の社内 SQL Server を使うため、app_* テーブルの DDL は
-- 本番向けマイグレーションとして別途手配すること。
--
-- 本ツール自身のテーブルは app_ 接頭辞で統一し、管理対象の業務テーブルと区別する。

IF DB_ID(N'tablemaint') IS NULL
    CREATE DATABASE tablemaint;
GO
USE tablemaint;
GO

-- ------------------------------------------------------------------ app_users
-- LDAP 認証成功時に MERGE で自動登録されるユーザー台帳。キーは AD objectGUID。
IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_users (
        object_guid   UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT pk_app_users PRIMARY KEY,
        username      NVARCHAR(256) NOT NULL,   -- sAMAccountName スナップショット(照合には使わない)
        display_name  NVARCHAR(256) NOT NULL,
        email         NVARCHAR(320) NULL,
        last_login_at DATETIME2(0)  NULL,
        created_at    DATETIME2(0)  NOT NULL CONSTRAINT df_app_users_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)  NOT NULL CONSTRAINT df_app_users_updated DEFAULT SYSUTCDATETIME()
    );
    -- 非ユニーク: AD のリネームで username が入れ替わっても照合キーは object_guid のみ
    CREATE INDEX ix_app_users_username ON dbo.app_users(username);
END
GO

-- ---------------------------------------------------------------- app_actions
-- 機能マスタ。ダッシュボードのカードはこのテーブルから生成される。
-- is_builtin=1 の行はアプリの前提機能なので API 経由の削除を拒否する。
IF OBJECT_ID(N'dbo.app_actions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_actions (
        id         INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_actions PRIMARY KEY,
        code       NVARCHAR(64)  NOT NULL
            CONSTRAINT ux_app_actions_code UNIQUE,
        name       NVARCHAR(128) NOT NULL,
        icon       NVARCHAR(64)  NOT NULL CONSTRAINT df_app_actions_icon DEFAULT N'apps',  -- Tabler icon 名
        sort_order INT           NOT NULL CONSTRAINT df_app_actions_sort DEFAULT 0,
        enabled    BIT           NOT NULL CONSTRAINT df_app_actions_enabled DEFAULT 1,
        is_builtin BIT           NOT NULL CONSTRAINT df_app_actions_builtin DEFAULT 0,
        created_at DATETIME2(0)  NOT NULL CONSTRAINT df_app_actions_created DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(0)  NOT NULL CONSTRAINT df_app_actions_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

-- -------------------------------------------------------------- app_user_auth
-- 認可: ユーザー x 機能 ごとの権限レベル。行が無い機能は「権限なし」。
--   admin > maintainer > user
IF OBJECT_ID(N'dbo.app_user_auth', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_user_auth (
        object_guid UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT fk_app_user_auth_user REFERENCES dbo.app_users(object_guid) ON DELETE CASCADE,
        action_id   INT NOT NULL
            CONSTRAINT fk_app_user_auth_action REFERENCES dbo.app_actions(id) ON DELETE CASCADE,
        auth_level  NVARCHAR(16) NOT NULL
            CONSTRAINT ck_app_user_auth_level CHECK (auth_level IN (N'admin', N'maintainer', N'user')),
        updated_by  NVARCHAR(256) NOT NULL,
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_app_user_auth PRIMARY KEY (object_guid, action_id)
    );
    CREATE INDEX ix_app_user_auth_action ON dbo.app_user_auth(action_id);
END
GO

-- ---------------------------------------------------------- app_managed_tables
-- テーブルメンテナンスの管理対象。admin が UI から登録する。
-- pk_columns は登録時スナップショット(CSV)。実際のメタデータは毎回
-- INFORMATION_SCHEMA / sys カタログから取得し直す。
IF OBJECT_ID(N'dbo.app_managed_tables', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_managed_tables (
        id           INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_managed_tables PRIMARY KEY,
        schema_name  SYSNAME       NOT NULL,
        table_name   SYSNAME       NOT NULL,
        display_name NVARCHAR(128) NOT NULL,
        description  NVARCHAR(400) NULL,
        pk_columns   NVARCHAR(400) NOT NULL,
        sort_order   INT           NOT NULL CONSTRAINT df_app_managed_tables_sort DEFAULT 0,
        enabled      BIT           NOT NULL CONSTRAINT df_app_managed_tables_enabled DEFAULT 1,
        created_by   NVARCHAR(256) NOT NULL,
        created_at   DATETIME2(0)  NOT NULL CONSTRAINT df_app_managed_tables_created DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2(0)  NOT NULL CONSTRAINT df_app_managed_tables_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ux_app_managed_tables_target UNIQUE (schema_name, table_name)
    );
END
GO

-- ------------------------------------------------------- app_operation_history
-- 全操作の監査履歴。ログイン/ログアウト/行編集/設定変更など全てここに残す。
-- username は非正規化(ユーザー削除後も履歴が読めるように)。
IF OBJECT_ID(N'dbo.app_operation_history', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_operation_history (
        id          BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_operation_history PRIMARY KEY,
        occurred_at DATETIME2(3)     NOT NULL CONSTRAINT df_app_operation_history_at DEFAULT SYSUTCDATETIME(),
        object_guid UNIQUEIDENTIFIER NULL,      -- 認証失敗など本人不明の操作は NULL
        username    NVARCHAR(256)    NOT NULL,
        action_code NVARCHAR(64)     NOT NULL,  -- 'auth' / 'table-maint' / 'settings' ...
        operation   NVARCHAR(64)     NOT NULL,  -- 'login' / 'rows.batch' / 'managed-table.create' ...
        target      NVARCHAR(300)    NULL,      -- 例: 'dbo.products', 'user:<guid>'
        detail      NVARCHAR(MAX)    NULL,      -- JSON(変更前後・件数など)
        result      NVARCHAR(16)     NOT NULL
            CONSTRAINT ck_app_operation_history_result CHECK (result IN (N'success', N'failure')),
        error_code  NVARCHAR(64)     NULL,
        client_ip   NVARCHAR(45)     NULL
    );
    CREATE INDEX ix_app_operation_history_at     ON dbo.app_operation_history(occurred_at DESC);
    CREATE INDEX ix_app_operation_history_user   ON dbo.app_operation_history(object_guid, occurred_at DESC);
    CREATE INDEX ix_app_operation_history_target ON dbo.app_operation_history(action_code, target);
END
GO

-- -------------------------------------------------------------------- シード
-- 組込機能。code は API/フロントのルーティングと対応するため変更不可。
MERGE dbo.app_actions AS t
USING (VALUES
    (N'table-maint', N'テーブルメンテナンス', N'table',    1),
    (N'settings',    N'設定',                 N'settings', 2)
) AS s (code, name, icon, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, name, icon, sort_order, enabled, is_builtin)
    VALUES (s.code, s.name, s.icon, s.sort_order, 1, 1);
GO

-- モックユーザー(auth.MockGUID)。LDAP_MOCK=true でのログインは MERGE の
-- MATCHED 側に入るため、ここで付与した admin 権限が維持される。
MERGE dbo.app_users AS t
USING (SELECT CAST('00000000-0000-0000-0000-000000000001' AS UNIQUEIDENTIFIER) AS g) AS s
ON t.object_guid = s.g
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, email)
    VALUES (s.g, N'admin', N'Mock Admin', N'admin@example.local');
GO

MERGE dbo.app_user_auth AS t
USING (
    SELECT CAST('00000000-0000-0000-0000-000000000001' AS UNIQUEIDENTIFIER) AS g, a.id AS action_id
    FROM dbo.app_actions a
    WHERE a.code IN (N'table-maint', N'settings')
) AS s
ON t.object_guid = s.g AND t.action_id = s.action_id
WHEN NOT MATCHED THEN
    INSERT (object_guid, action_id, auth_level, updated_by)
    VALUES (s.g, s.action_id, N'admin', N'setup:initdb');
GO

-- ---------------------------------------------------------------- サンプル業務テーブル
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
MERGE dbo.app_managed_tables AS t
USING (VALUES
    (N'dbo', N'products',  N'商品マスタ',   N'サンプル: rowversion あり', N'id', 1),
    (N'dbo', N'customers', N'取引先マスタ', N'サンプル: rowversion なし', N'id', 2)
) AS s (schema_name, table_name, display_name, description, pk_columns, sort_order)
ON t.schema_name = s.schema_name AND t.table_name = s.table_name
WHEN NOT MATCHED THEN
    INSERT (schema_name, table_name, display_name, description, pk_columns, sort_order, created_by)
    VALUES (s.schema_name, s.table_name, s.display_name, s.description, s.pk_columns, s.sort_order, N'setup:initdb');
GO

-- ================================================================ Sprint 2
-- 複数 SQL Server 接続対応。以下は既存 DB への再適用も安全な冪等ガード付き。

-- ------------------------------------------------------------ app_connections
-- 管理対象テーブルの接続先。admin が設定画面から登録する。
-- パスワードは AES-GCM で暗号化(鍵は env CONN_ENC_KEY)。
-- 「既定接続」(アプリ自身の DB = env MSSQL_DSN) はこのテーブルには置かず、
-- app_managed_tables.connection_id = NULL で表現する(資格情報を DB に複製しない)。
IF OBJECT_ID(N'dbo.app_connections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_connections (
        id            INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_connections PRIMARY KEY,
        name          NVARCHAR(128)  NOT NULL
            CONSTRAINT ux_app_connections_name UNIQUE,   -- 表示名(履歴の target にも使う)
        host          NVARCHAR(255)  NOT NULL,
        port          INT            NOT NULL CONSTRAINT df_app_connections_port DEFAULT 1433,
        database_name SYSNAME        NOT NULL,
        username      NVARCHAR(128)  NOT NULL,
        password_enc  VARBINARY(512) NOT NULL,           -- 12byte GCM nonce || 暗号文+タグ
        options       NVARCHAR(256)  NULL,               -- 追加 DSN パラメータ(例: encrypt=disable)
        enabled       BIT            NOT NULL CONSTRAINT df_app_connections_enabled DEFAULT 1,
        created_by    NVARCHAR(256)  NOT NULL,
        created_at    DATETIME2(0)   NOT NULL CONSTRAINT df_app_connections_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_app_connections_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

-- ------------------------------------- app_managed_tables.connection_id 追加
-- NULL = 既定接続(アプリ自身の DB)。
IF COL_LENGTH(N'dbo.app_managed_tables', N'connection_id') IS NULL
BEGIN
    ALTER TABLE dbo.app_managed_tables ADD connection_id INT NULL
        CONSTRAINT fk_app_managed_tables_conn REFERENCES dbo.app_connections(id);
END
GO

-- UNIQUE 制約を接続スコープ付きに置き換える。
-- SQL Server の UNIQUE 制約は NULL 同士を等価として扱うため、
-- (NULL, schema, table) も 1 件に制限される = 既定接続スコープとして機能する。
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'ux_app_managed_tables_target')
    ALTER TABLE dbo.app_managed_tables DROP CONSTRAINT ux_app_managed_tables_target;
GO
IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'ux_app_managed_tables_conn_target')
    ALTER TABLE dbo.app_managed_tables ADD CONSTRAINT ux_app_managed_tables_conn_target
        UNIQUE (connection_id, schema_name, table_name);
GO

-- ------------------------------------------- app_operation_history.target 拡幅
-- 接続名プレフィックス("<接続名>:schema.table")対応。
-- ALTER COLUMN は対象列のインデックスを外す必要がある。
-- 注意: 本番の大きな履歴テーブルではインデックス再作成が一時ブロックになる。
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.app_operation_history')
      AND name = N'target' AND max_length < 1024  -- NVARCHAR(512) = 1024 bytes
)
BEGIN
    DROP INDEX IF EXISTS ix_app_operation_history_target ON dbo.app_operation_history;
    ALTER TABLE dbo.app_operation_history ALTER COLUMN target NVARCHAR(512) NULL;
    CREATE INDEX ix_app_operation_history_target ON dbo.app_operation_history(action_code, target);
END
GO

-- ------------------------------------------------------ app_actions.url
-- 予約列(現在は未使用)。任意 URL のリンクカードは個人機能 app_user_links に
-- 統合された。将来の「管理テンプレート配布」でリンク項目を持つ際に使う想定。
IF COL_LENGTH(N'dbo.app_actions', N'url') IS NULL
BEGIN
    ALTER TABLE dbo.app_actions ADD url NVARCHAR(512) NULL;
END
GO

-- -------------------------------------------------------- app_user_links
-- ユーザー個人のダッシュボードリンクカード。本人だけが閲覧・編集できる。
-- 将来のダッシュボードテンプレート化の際は「個人テンプレートの項目」へ昇格する。
IF OBJECT_ID(N'dbo.app_user_links', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_user_links (
        id          INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_user_links PRIMARY KEY,
        object_guid UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT fk_app_user_links_user REFERENCES dbo.app_users(object_guid) ON DELETE CASCADE,
        name        NVARCHAR(128) NOT NULL,
        url         NVARCHAR(512) NOT NULL,
        icon        NVARCHAR(64)  NOT NULL CONSTRAINT df_app_user_links_icon DEFAULT N'external-link',
        sort_order  INT           NOT NULL CONSTRAINT df_app_user_links_sort DEFAULT 0,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_links_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_links_updated DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX ix_app_user_links_user ON dbo.app_user_links(object_guid, sort_order);
END
GO

-- ------------------------------------------------------- 検証用 demo データベース
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
USE tablemaint;
GO
