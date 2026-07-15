-- deploy/initdb/prod-app-schema.sql
-- 本番用 DDL。app_* テーブル(本ツール自身のテーブル)のみを対象とする。
--
-- 前提(2026-07 決定事項):
--   - DB 本体・スキーマの作成は DBA が事前に行う(このスクリプトは
--     CREATE DATABASE / CREATE SCHEMA / USE を一切含まない)。
--   - 接続アカウントは SQL Server 認証で、権限は特定スキーマ内に閉じている
--     (CREATE SCHEMA 権限は無い前提。既存スキーマへの CREATE TABLE /
--     ALTER TABLE 権限のみを想定)。
--   - サンプル業務テーブル(products/customers)や検証用 demo DB は
--     開発専用(deploy/initdb/01_init.sql 参照)であり、このスクリプトには含めない。
--
-- 実行方法:
--   sqlcmd -S <本番ホスト> -d <DBA が用意したDB名> -U <発行アカウント> -P <パスワード> ^
--       -v APP_SCHEMA=<DBA から指定されたスキーマ名> -i prod-app-schema.sql
--
--   APP_SCHEMA は -v での指定を必須とする(このスクリプトに :setvar を
--   書かないのはそのため。デフォルト値を script 内に持たせると、
--   dbo 決め打ちでの誤実行に気付けなくなる)。指定を忘れると
--   sqlcmd が "変数 APP_SCHEMA が定義されていません" で止まるため、
--   スキーマ未指定のまま実行されることはない。
--
--   実行後は backend の環境変数 APP_DB_SCHEMA にも同じスキーマ名を設定すること
--   (docs/operations-guide.md の「外部サーバーへの接続設定」参照)。
--
-- 冪等性: 既存 DB への再適用(バージョンアップ)にも安全なガード付き。
-- 内容は 01_init.sql の app_* 部分(サンプルデータ・demo DB を除く)と同一に保つこと。

-- ------------------------------------------------------------------ app_users
-- LDAP 認証成功時に MERGE で自動登録されるユーザー台帳。キーは AD objectGUID。
IF OBJECT_ID(N'$(APP_SCHEMA).app_users', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_users (
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
    CREATE INDEX ix_app_users_username ON $(APP_SCHEMA).app_users(username);
END
GO

-- ---------------------------------------------------------------- app_actions
-- 機能マスタ。ダッシュボードのカードはこのテーブルから生成される。
-- is_builtin=1 の行はアプリの前提機能なので API 経由の削除を拒否する。
IF OBJECT_ID(N'$(APP_SCHEMA).app_actions', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_actions (
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

IF COL_LENGTH(N'$(APP_SCHEMA).app_actions', N'url') IS NULL
BEGIN
    ALTER TABLE $(APP_SCHEMA).app_actions ADD url NVARCHAR(512) NULL;
END
GO

-- -------------------------------------------------------------- app_user_auth
-- 認可: ユーザー x 機能 ごとの権限レベル。行が無い機能は「権限なし」。
--   admin > maintainer > user
IF OBJECT_ID(N'$(APP_SCHEMA).app_user_auth', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_user_auth (
        object_guid UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT fk_app_user_auth_user REFERENCES $(APP_SCHEMA).app_users(object_guid) ON DELETE CASCADE,
        action_id   INT NOT NULL
            CONSTRAINT fk_app_user_auth_action REFERENCES $(APP_SCHEMA).app_actions(id) ON DELETE CASCADE,
        auth_level  NVARCHAR(16) NOT NULL
            CONSTRAINT ck_app_user_auth_level CHECK (auth_level IN (N'admin', N'maintainer', N'user')),
        updated_by  NVARCHAR(256) NOT NULL,
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_app_user_auth PRIMARY KEY (object_guid, action_id)
    );
    CREATE INDEX ix_app_user_auth_action ON $(APP_SCHEMA).app_user_auth(action_id);
END
GO

-- ---------------------------------------------------------- app_managed_tables
-- テーブルメンテナンスの管理対象。admin が UI から登録する。
-- pk_columns は登録時スナップショット(CSV)。実際のメタデータは毎回
-- INFORMATION_SCHEMA / sys カタログから取得し直す。
IF OBJECT_ID(N'$(APP_SCHEMA).app_managed_tables', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_managed_tables (
        id           INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_managed_tables PRIMARY KEY,
        schema_name  SYSNAME       NOT NULL,
        table_name   SYSNAME       NOT NULL,
        display_name NVARCHAR(128) NOT NULL,
        description  NVARCHAR(400) NULL,
        pk_columns   NVARCHAR(400) NOT NULL,
        -- 列モード(CSV)。readonly = 表示のみ、hidden = SELECT 自体から除外。
        readonly_columns NVARCHAR(400) NOT NULL CONSTRAINT df_app_managed_tables_ro DEFAULT N'',
        hidden_columns   NVARCHAR(400) NOT NULL CONSTRAINT df_app_managed_tables_hd DEFAULT N'',
        sort_order   INT           NOT NULL CONSTRAINT df_app_managed_tables_sort DEFAULT 0,
        enabled      BIT           NOT NULL CONSTRAINT df_app_managed_tables_enabled DEFAULT 1,
        created_by   NVARCHAR(256) NOT NULL,
        created_at   DATETIME2(0)  NOT NULL CONSTRAINT df_app_managed_tables_created DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2(0)  NOT NULL CONSTRAINT df_app_managed_tables_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ux_app_managed_tables_target UNIQUE (schema_name, table_name)
    );
END
GO

IF COL_LENGTH(N'$(APP_SCHEMA).app_managed_tables', N'readonly_columns') IS NULL
    ALTER TABLE $(APP_SCHEMA).app_managed_tables
        ADD readonly_columns NVARCHAR(400) NOT NULL CONSTRAINT df_app_managed_tables_ro DEFAULT N'';
GO
IF COL_LENGTH(N'$(APP_SCHEMA).app_managed_tables', N'hidden_columns') IS NULL
    ALTER TABLE $(APP_SCHEMA).app_managed_tables
        ADD hidden_columns NVARCHAR(400) NOT NULL CONSTRAINT df_app_managed_tables_hd DEFAULT N'';
GO

-- connection_id: NULL = 既定接続(アプリ自身の DB)。
IF COL_LENGTH(N'$(APP_SCHEMA).app_managed_tables', N'connection_id') IS NULL
BEGIN
    ALTER TABLE $(APP_SCHEMA).app_managed_tables ADD connection_id INT NULL;
END
GO

-- ------------------------------------------------------- app_operation_history
-- 全操作の監査履歴。ログイン/ログアウト/行編集/設定変更など全てここに残す。
-- username は非正規化(ユーザー削除後も履歴が読めるように)。
IF OBJECT_ID(N'$(APP_SCHEMA).app_operation_history', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_operation_history (
        id          BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_operation_history PRIMARY KEY,
        occurred_at DATETIME2(3)     NOT NULL CONSTRAINT df_app_operation_history_at DEFAULT SYSUTCDATETIME(),
        object_guid UNIQUEIDENTIFIER NULL,      -- 認証失敗など本人不明の操作は NULL
        username    NVARCHAR(256)    NOT NULL,
        action_code NVARCHAR(64)     NOT NULL,  -- 'auth' / 'table-maint' / 'settings' ...
        operation   NVARCHAR(64)     NOT NULL,  -- 'login' / 'rows.batch' / 'managed-table.create' ...
        target      NVARCHAR(512)    NULL,      -- 例: 'dbo.products', '<接続名>:schema.table', 'user:<guid>'
        detail      NVARCHAR(MAX)    NULL,      -- JSON(変更前後・件数など)
        result      NVARCHAR(16)     NOT NULL
            CONSTRAINT ck_app_operation_history_result CHECK (result IN (N'success', N'failure')),
        error_code  NVARCHAR(64)     NULL,
        client_ip   NVARCHAR(45)     NULL
    );
    CREATE INDEX ix_app_operation_history_at     ON $(APP_SCHEMA).app_operation_history(occurred_at DESC);
    CREATE INDEX ix_app_operation_history_user   ON $(APP_SCHEMA).app_operation_history(object_guid, occurred_at DESC);
    CREATE INDEX ix_app_operation_history_target ON $(APP_SCHEMA).app_operation_history(action_code, target);
END
GO

-- ------------------------------------------------------------ app_connections
-- 管理対象テーブルの接続先。admin が設定画面から登録する。
-- パスワードは AES-GCM で暗号化(鍵は env CONN_ENC_KEY)。
-- 「既定接続」(アプリ自身の DB = env MSSQL_DSN) はこのテーブルには置かず、
-- app_managed_tables.connection_id = NULL で表現する(資格情報を DB に複製しない)。
IF OBJECT_ID(N'$(APP_SCHEMA).app_connections', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_connections (
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
        schema_name   SYSNAME        NULL,               -- NULL = 制限なし / 非NULL = このスキーマ限定
        enabled       BIT            NOT NULL CONSTRAINT df_app_connections_enabled DEFAULT 1,
        created_by    NVARCHAR(256)  NOT NULL,
        created_at    DATETIME2(0)   NOT NULL CONSTRAINT df_app_connections_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_app_connections_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'$(APP_SCHEMA).app_connections', N'U') IS NOT NULL
   AND COL_LENGTH(N'$(APP_SCHEMA).app_connections', N'schema_name') IS NULL
    ALTER TABLE $(APP_SCHEMA).app_connections ADD schema_name SYSNAME NULL;
GO

-- app_managed_tables.connection_id の FK(app_connections 作成後に追補)。
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_app_managed_tables_conn')
BEGIN
    ALTER TABLE $(APP_SCHEMA).app_managed_tables ADD
        CONSTRAINT fk_app_managed_tables_conn FOREIGN KEY (connection_id)
            REFERENCES $(APP_SCHEMA).app_connections(id);
END
GO

-- UNIQUE 制約は接続スコープ付き(NULL 同士は等価 = 既定接続スコープとして機能)。
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'ux_app_managed_tables_target')
    ALTER TABLE $(APP_SCHEMA).app_managed_tables DROP CONSTRAINT ux_app_managed_tables_target;
GO
IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'ux_app_managed_tables_conn_target')
    ALTER TABLE $(APP_SCHEMA).app_managed_tables ADD CONSTRAINT ux_app_managed_tables_conn_target
        UNIQUE (connection_id, schema_name, table_name);
GO

-- -------------------------------------------------------------------- シード
-- 組込機能。code は API/フロントのルーティングと対応するため変更不可。
-- settings/history はダッシュボードのカードではなくサイドバーに表示される。
MERGE $(APP_SCHEMA).app_actions AS t
USING (VALUES
    (N'table-maint', N'テーブルメンテナンス', N'table',    1),
    (N'settings',    N'設定',                 N'settings', 2),
    (N'history',     N'操作履歴',             N'history',  3)
) AS s (code, name, icon, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, name, icon, sort_order, enabled, is_builtin)
    VALUES (s.code, s.name, s.icon, s.sort_order, 1, 1);
GO

-- 移行: 履歴閲覧はこれまで settings:admin に含まれていたため、
-- 既存の settings:admin 保持者へ history:admin を自動付与する(冪等)。
INSERT INTO $(APP_SCHEMA).app_user_auth (object_guid, action_id, auth_level, updated_by)
SELECT ua.object_guid, h.id, N'admin', N'setup:history-migration'
FROM $(APP_SCHEMA).app_user_auth ua
JOIN $(APP_SCHEMA).app_actions s ON s.id = ua.action_id AND s.code = N'settings'
JOIN $(APP_SCHEMA).app_actions h ON h.code = N'history'
WHERE ua.auth_level = N'admin'
  AND NOT EXISTS (
      SELECT 1 FROM $(APP_SCHEMA).app_user_auth x
      WHERE x.object_guid = ua.object_guid AND x.action_id = h.id);
GO

-- -------------------------------------------------------- app_user_links
-- ユーザー個人のダッシュボードリンクカード。本人だけが閲覧・編集できる。
IF OBJECT_ID(N'$(APP_SCHEMA).app_user_links', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_user_links (
        id          INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_user_links PRIMARY KEY,
        object_guid UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT fk_app_user_links_user REFERENCES $(APP_SCHEMA).app_users(object_guid) ON DELETE CASCADE,
        name        NVARCHAR(128) NOT NULL,
        -- kind='link' は url、kind='table' は managed_table_id、
        -- kind='action' は action_id(機能へのショートカット)を使う。
        kind        NVARCHAR(8)   NOT NULL CONSTRAINT df_app_user_links_kind DEFAULT N'link'
            CONSTRAINT ck_app_user_links_kind CHECK (kind IN (N'link', N'table', N'action')),
        url         NVARCHAR(512) NULL,
        managed_table_id INT NULL
            CONSTRAINT fk_app_user_links_mtable REFERENCES $(APP_SCHEMA).app_managed_tables(id) ON DELETE CASCADE,
        action_id   INT NULL
            CONSTRAINT fk_app_user_links_action REFERENCES $(APP_SCHEMA).app_actions(id) ON DELETE CASCADE,
        icon        NVARCHAR(64)  NOT NULL CONSTRAINT df_app_user_links_icon DEFAULT N'external-link',
        sort_order  INT           NOT NULL CONSTRAINT df_app_user_links_sort DEFAULT 0,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_links_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_links_updated DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX ix_app_user_links_user ON $(APP_SCHEMA).app_user_links(object_guid, sort_order);
END
GO

-- --------------------------------------------------- ダッシュボードテンプレート
-- admin が作成・配布するテンプレート(owner_guid IS NULL)と、
-- ユーザー個人の保存テンプレート(owner_guid = 本人。本人しか見えない)。
IF OBJECT_ID(N'$(APP_SCHEMA).app_dash_templates', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_dash_templates (
        id          INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_dash_templates PRIMARY KEY,
        -- NULL = 管理者配布 / 非NULL = 個人テンプレート(所有者)
        owner_guid  UNIQUEIDENTIFIER NULL
            CONSTRAINT fk_app_dash_templates_owner REFERENCES $(APP_SCHEMA).app_users(object_guid),
        name        NVARCHAR(128) NOT NULL,
        description NVARCHAR(400) NULL,
        enabled     BIT           NOT NULL CONSTRAINT df_app_dash_templates_enabled DEFAULT 1,
        created_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_dash_templates_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_dash_templates_updated DEFAULT SYSUTCDATETIME(),
        -- 配布(NULL)同士・同一ユーザー内で名前一意(他人とは同名OK)
        CONSTRAINT ux_app_dash_templates_owner_name UNIQUE (owner_guid, name)
    );
END
GO

-- テンプレートの項目。kind='action' は app_actions への参照、
-- kind='link' はテンプレート自身が持つ URL カード、kind='table' は管理対象テーブル。
IF OBJECT_ID(N'$(APP_SCHEMA).app_dash_template_items', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_dash_template_items (
        id          INT IDENTITY(1,1) NOT NULL
            CONSTRAINT pk_app_dash_template_items PRIMARY KEY,
        template_id INT NOT NULL
            CONSTRAINT fk_dash_items_template REFERENCES $(APP_SCHEMA).app_dash_templates(id) ON DELETE CASCADE,
        position    INT NOT NULL,
        kind        NVARCHAR(8) NOT NULL
            CONSTRAINT ck_dash_items_kind CHECK (kind IN (N'action', N'link', N'table')),
        action_id   INT NULL
            CONSTRAINT fk_dash_items_action REFERENCES $(APP_SCHEMA).app_actions(id) ON DELETE CASCADE,
        managed_table_id INT NULL
            CONSTRAINT fk_dash_items_mtable REFERENCES $(APP_SCHEMA).app_managed_tables(id) ON DELETE CASCADE,
        name        NVARCHAR(128) NULL,
        url         NVARCHAR(512) NULL,
        icon        NVARCHAR(64)  NULL
    );
    CREATE INDEX ix_dash_items_template ON $(APP_SCHEMA).app_dash_template_items(template_id, position);
END
GO

-- ユーザーごとのダッシュボード設定(選択テンプレートとカード順)。
-- card_order は JSON 配列("fn:<code>"/"mylink:<id>"/"tpl:<itemId>")。
IF OBJECT_ID(N'$(APP_SCHEMA).app_user_dash', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).app_user_dash (
        object_guid UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT pk_app_user_dash PRIMARY KEY
            CONSTRAINT fk_app_user_dash_user REFERENCES $(APP_SCHEMA).app_users(object_guid) ON DELETE CASCADE,
        template_id INT NULL
            CONSTRAINT fk_app_user_dash_template REFERENCES $(APP_SCHEMA).app_dash_templates(id) ON DELETE SET NULL,
        card_order  NVARCHAR(MAX) NULL,
        -- ユーザーが非表示にしたカードキー(JSON 配列。テンプレ再選択でクリア)
        hidden_keys NVARCHAR(MAX) NULL,
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_app_user_dash_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'$(APP_SCHEMA).app_user_dash', N'U') IS NOT NULL
   AND COL_LENGTH(N'$(APP_SCHEMA).app_user_dash', N'hidden_keys') IS NULL
    ALTER TABLE $(APP_SCHEMA).app_user_dash ADD hidden_keys NVARCHAR(MAX) NULL;
GO
