

IF DB_ID(N'ftool') IS NULL
    CREATE DATABASE ftool;
GO
USE ftool;
GO

IF SCHEMA_ID(N'dbo') IS NULL
    EXEC(N'CREATE SCHEMA [dbo]');
GO


IF OBJECT_ID(N'dbo.ftool_app_users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_users (
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
    CREATE INDEX ix_ftool_app_users_username ON dbo.ftool_app_users(username);
END
GO

IF COL_LENGTH(N'dbo.ftool_app_users', N'department') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_users ADD department NVARCHAR(256) NULL;
END
GO
IF COL_LENGTH(N'dbo.ftool_app_users', N'title') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_users ADD title NVARCHAR(128) NULL;
END
GO

IF OBJECT_ID(N'dbo.ftool_app_user_groups', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_user_groups (
        object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_groups_user REFERENCES dbo.ftool_app_users(object_guid) ON DELETE CASCADE,
        group_dn    NVARCHAR(400) NOT NULL,
        CONSTRAINT pk_ftool_app_user_groups PRIMARY KEY (object_guid, group_dn)
    );
END
GO

IF OBJECT_ID(N'dbo.ftool_app_actions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_actions (
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

IF OBJECT_ID(N'dbo.ftool_app_user_auth', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_user_auth (
        object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_auth_user REFERENCES dbo.ftool_app_users(object_guid) ON DELETE CASCADE,
        action_id   INT NOT NULL CONSTRAINT fk_ftool_app_user_auth_action REFERENCES dbo.ftool_app_actions(id) ON DELETE CASCADE,
        auth_level  NVARCHAR(16) NOT NULL CONSTRAINT ck_ftool_app_user_auth_level CHECK (auth_level IN (N'admin', N'maintainer', N'user')),
        created_by  NVARCHAR(256) NOT NULL,
        updated_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_auth_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_ftool_app_user_auth PRIMARY KEY (object_guid, action_id)
    );
    CREATE INDEX ix_ftool_app_user_auth_action ON dbo.ftool_app_user_auth(action_id);
END
GO

IF OBJECT_ID(N'dbo.ftool_app_groups', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_groups (
        id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_groups PRIMARY KEY,
        name         NVARCHAR(128) NOT NULL CONSTRAINT ux_ftool_app_groups_name UNIQUE,
        display_name NVARCHAR(128) NOT NULL CONSTRAINT df_ftool_app_groups_dn DEFAULT N'',
        description NVARCHAR(400) NULL,
        [rank]      INT NULL CONSTRAINT ck_ftool_app_groups_rank CHECK ([rank] BETWEEN 0 AND 99),
        created_by  NVARCHAR(256) NOT NULL,
        updated_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_groups_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_groups_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

SET QUOTED_IDENTIFIER ON;
IF OBJECT_ID(N'dbo.ftool_app_group_members', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_group_members (
        group_id        INT NOT NULL CONSTRAINT fk_ftool_app_group_members_group REFERENCES dbo.ftool_app_groups(id) ON DELETE CASCADE,
        object_guid     UNIQUEIDENTIFIER NULL CONSTRAINT fk_ftool_app_group_members_user REFERENCES dbo.ftool_app_users(object_guid) ON DELETE CASCADE,
        member_group_id INT NULL CONSTRAINT fk_ftool_app_group_members_member REFERENCES dbo.ftool_app_groups(id),
        created_by      NVARCHAR(256) NOT NULL,
        created_at      DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_group_members_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ck_ftool_app_group_members_one CHECK ((object_guid IS NULL AND member_group_id IS NOT NULL) OR (object_guid IS NOT NULL AND member_group_id IS NULL)),
        CONSTRAINT ck_ftool_app_group_members_self CHECK (member_group_id IS NULL OR member_group_id <> group_id)
    );
    CREATE UNIQUE INDEX ux_ftool_app_group_members_user
        ON dbo.ftool_app_group_members(group_id, object_guid) WHERE object_guid IS NOT NULL;
    CREATE UNIQUE INDEX ux_ftool_app_group_members_group
        ON dbo.ftool_app_group_members(group_id, member_group_id) WHERE member_group_id IS NOT NULL;
    CREATE INDEX ix_ftool_app_group_members_user ON dbo.ftool_app_group_members(object_guid);
    CREATE INDEX ix_ftool_app_group_members_member ON dbo.ftool_app_group_members(member_group_id);
END
GO

IF OBJECT_ID(N'dbo.ftool_app_group_auth', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_group_auth (
        group_id   INT NOT NULL CONSTRAINT fk_ftool_app_group_auth_group REFERENCES dbo.ftool_app_groups(id) ON DELETE CASCADE,
        action_id  INT NOT NULL CONSTRAINT fk_ftool_app_group_auth_action REFERENCES dbo.ftool_app_actions(id) ON DELETE CASCADE,
        auth_level NVARCHAR(16) NOT NULL CONSTRAINT ck_ftool_app_group_auth_level CHECK (auth_level IN (N'admin', N'maintainer', N'user')),
        created_by NVARCHAR(256) NOT NULL,
        updated_by NVARCHAR(256) NOT NULL,
        created_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_group_auth_created DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_group_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_ftool_app_group_auth PRIMARY KEY (group_id, action_id)
    );
END
GO

SET QUOTED_IDENTIFIER ON;
IF OBJECT_ID(N'dbo.ftool_app_resource_auth', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_resource_auth (
        id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_resource_auth PRIMARY KEY,
        resource_type NVARCHAR(32) NOT NULL CONSTRAINT ck_ftool_app_resource_auth_type CHECK (resource_type IN (N'action', N'managed_table', N'pwchange_target')),
        resource_id   INT NOT NULL,
        object_guid   UNIQUEIDENTIFIER NULL CONSTRAINT fk_ftool_app_resource_auth_user REFERENCES dbo.ftool_app_users(object_guid) ON DELETE CASCADE,
        group_id      INT NULL CONSTRAINT fk_ftool_app_resource_auth_group REFERENCES dbo.ftool_app_groups(id) ON DELETE CASCADE,
        auth_level    NVARCHAR(8) NOT NULL CONSTRAINT ck_ftool_app_resource_auth_level CHECK (auth_level IN (N'r', N'rw')),
        created_by    NVARCHAR(256) NOT NULL,
        updated_by    NVARCHAR(256) NOT NULL,
        created_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_resource_auth_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_resource_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ck_ftool_app_resource_auth_subject CHECK ((object_guid IS NULL AND group_id IS NOT NULL) OR (object_guid IS NOT NULL AND group_id IS NULL))
    );
    CREATE UNIQUE INDEX ux_ftool_app_resource_auth_user
        ON dbo.ftool_app_resource_auth(resource_type, resource_id, object_guid) WHERE object_guid IS NOT NULL;
    CREATE UNIQUE INDEX ux_ftool_app_resource_auth_group
        ON dbo.ftool_app_resource_auth(resource_type, resource_id, group_id) WHERE group_id IS NOT NULL;
    CREATE INDEX ix_ftool_app_resource_auth_subject_user ON dbo.ftool_app_resource_auth(object_guid);
    CREATE INDEX ix_ftool_app_resource_auth_subject_group ON dbo.ftool_app_resource_auth(group_id);
END
GO

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'ck_ftool_app_resource_auth_type'
      AND parent_object_id = OBJECT_ID(N'dbo.ftool_app_resource_auth')
      AND definition NOT LIKE N'%pwchange_target%')
BEGIN
    ALTER TABLE dbo.ftool_app_resource_auth DROP CONSTRAINT ck_ftool_app_resource_auth_type;
    ALTER TABLE dbo.ftool_app_resource_auth
        ADD CONSTRAINT ck_ftool_app_resource_auth_type CHECK (resource_type IN (N'action', N'managed_table', N'pwchange_target'));
END
GO

IF OBJECT_ID(N'dbo.ftool_app_connections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_connections (
        id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_connections PRIMARY KEY,
        name          NVARCHAR(128)  NOT NULL CONSTRAINT ux_ftool_app_connections_name UNIQUE,   -- 表示名(履歴の target にも使う)
        host          NVARCHAR(255)  NOT NULL,
        port          INT            NOT NULL CONSTRAINT df_ftool_app_connections_port DEFAULT 1433,
        database_name SYSNAME        NOT NULL,
        username      NVARCHAR(128)  NOT NULL,
        password_enc  VARBINARY(512) NOT NULL,           -- 12byte GCM nonce || 暗号文+タグ
        options       NVARCHAR(256)  NULL,               -- 追加 DSN パラメータ(例: encrypt=disable)
        schema_name   SYSNAME        NULL,               -- NULL = 制限なし / 非NULL = このスキーマ限定
        color         NVARCHAR(16)   NULL,               -- 既定のアクセント色(#RRGGBB)。管理テーブル側の color で上書き可
        enabled       BIT            NOT NULL CONSTRAINT df_ftool_app_connections_enabled DEFAULT 1,
        created_by    NVARCHAR(256)  NOT NULL,
        updated_by    NVARCHAR(256)  NOT NULL,
        created_at    DATETIME2(0)   NOT NULL CONSTRAINT df_ftool_app_connections_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_ftool_app_connections_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

IF COL_LENGTH(N'dbo.ftool_app_connections', N'color') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_connections ADD color NVARCHAR(16) NULL;
END
GO

IF OBJECT_ID(N'dbo.ftool_app_managed_tables', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_managed_tables (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_managed_tables PRIMARY KEY,
        connection_id INT NULL CONSTRAINT fk_ftool_app_managed_tables_conn REFERENCES dbo.ftool_app_connections(id),
        schema_name  SYSNAME       NOT NULL,
        table_name   SYSNAME       NOT NULL,
        display_name NVARCHAR(128) NOT NULL,
        slug         NVARCHAR(64)  NOT NULL,
        description  NVARCHAR(400) NULL,
        color        NVARCHAR(16)  NULL,
        pk_columns   NVARCHAR(400) NOT NULL,
        readonly_columns NVARCHAR(400) NOT NULL CONSTRAINT df_ftool_app_managed_tables_ro DEFAULT N'',
        hidden_columns   NVARCHAR(400) NOT NULL CONSTRAINT df_ftool_app_managed_tables_hd DEFAULT N'',
        fixed_columns    NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_managed_tables_fx DEFAULT N'[]',
        lookups          NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_managed_tables_lk DEFAULT N'[]',
        column_order     NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_managed_tables_co DEFAULT N'[]',
        sort_order   INT           NOT NULL CONSTRAINT df_ftool_app_managed_tables_sort DEFAULT 0,
        enabled      BIT           NOT NULL CONSTRAINT df_ftool_app_managed_tables_enabled DEFAULT 1,
        created_by   NVARCHAR(256) NOT NULL,
        updated_by   NVARCHAR(256) NOT NULL,
        created_at   DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_managed_tables_created DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_managed_tables_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ux_ftool_app_managed_tables_conn_target UNIQUE (connection_id, schema_name, table_name),
        CONSTRAINT ux_ftool_app_managed_tables_slug UNIQUE (slug)
    );
END
GO

IF COL_LENGTH(N'dbo.ftool_app_managed_tables', N'slug') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_managed_tables ADD slug NVARCHAR(64) NULL;
END
GO
IF EXISTS (SELECT 1 FROM dbo.ftool_app_managed_tables WHERE slug IS NULL)
BEGIN
    UPDATE m SET slug =
        CASE WHEN EXISTS (
            SELECT 1 FROM dbo.ftool_app_managed_tables o
            WHERE o.table_name = m.table_name AND o.id < m.id)
        THEN LEFT(m.table_name, 52) + N'-' + CAST(m.id AS NVARCHAR(11))
        ELSE LEFT(m.table_name, 64) END
    FROM dbo.ftool_app_managed_tables m
    WHERE m.slug IS NULL;
END
GO
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.ftool_app_managed_tables')
      AND name = N'slug' AND is_nullable = 1)
BEGIN
    ALTER TABLE dbo.ftool_app_managed_tables ALTER COLUMN slug NVARCHAR(64) NOT NULL;
    ALTER TABLE dbo.ftool_app_managed_tables
        ADD CONSTRAINT ux_ftool_app_managed_tables_slug UNIQUE (slug);
END
GO

IF COL_LENGTH(N'dbo.ftool_app_managed_tables', N'color') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_managed_tables ADD color NVARCHAR(16) NULL;
END
GO

IF COL_LENGTH(N'dbo.ftool_app_groups', N'display_name') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_groups
        ADD display_name NVARCHAR(128) NOT NULL CONSTRAINT df_ftool_app_groups_dn DEFAULT N'';
END
GO
UPDATE dbo.ftool_app_groups SET display_name = name WHERE display_name = N'';
GO

IF COL_LENGTH(N'dbo.ftool_app_groups', N'rank') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_groups
        ADD [rank] INT NULL CONSTRAINT ck_ftool_app_groups_rank CHECK ([rank] BETWEEN 0 AND 99);
END
GO

IF COL_LENGTH(N'dbo.ftool_app_managed_tables', N'lookups') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_managed_tables
        ADD lookups NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_managed_tables_lk DEFAULT N'[]';
END
GO

IF COL_LENGTH(N'dbo.ftool_app_managed_tables', N'column_order') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_managed_tables
        ADD column_order NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_managed_tables_co DEFAULT N'[]';
END
GO

IF COL_LENGTH(N'dbo.ftool_app_users', N'employee_no') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_users ADD employee_no NVARCHAR(64) NULL;
END
GO

IF OBJECT_ID(N'dbo.ftool_app_pwchange_targets', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_pwchange_targets (
        id               INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_pwchange_targets PRIMARY KEY,
        connection_id    INT NOT NULL CONSTRAINT fk_ftool_app_pwchange_targets_conn REFERENCES dbo.ftool_app_connections(id) ON DELETE CASCADE,
        schema_name      SYSNAME       NOT NULL,
        table_name       SYSNAME       NOT NULL,
        id_column        SYSNAME       NOT NULL,   -- 社員番号と照合する列
        password_column  SYSNAME       NOT NULL,   -- ハッシュを読み書きする列
        name_column      SYSNAME       NULL,       -- 本人確認で表示する名前の列(NULL = ID を表示)
        fixed_columns    NVARCHAR(MAX) NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_fx DEFAULT N'[]',
        hash_algorithm   NVARCHAR(16)  NOT NULL CONSTRAINT ck_ftool_app_pwchange_targets_alg CHECK (hash_algorithm IN (N'sha256', N'sha1', N'sha512', N'md5')),
        hash_template    NVARCHAR(200) NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_tpl DEFAULT N'$input$salt',
        hash_encoding    NVARCHAR(16)  NOT NULL CONSTRAINT ck_ftool_app_pwchange_targets_enc CHECK (hash_encoding IN (N'utf8', N'utf16le', N'sjis')),
        hash_output      NVARCHAR(16)  NOT NULL CONSTRAINT ck_ftool_app_pwchange_targets_out CHECK (hash_output IN (N'hex', N'hexupper', N'base64', N'binary')),
        hash_iterations  INT           NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_iter DEFAULT 1,
        salt_format      NVARCHAR(8)   NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_sfmt DEFAULT N'text' CONSTRAINT ck_ftool_app_pwchange_targets_sfmt CHECK (salt_format IN (N'text', N'hex')),
        salt_enc         VARBINARY(512) NULL,      -- 12byte GCM nonce || 暗号文+タグ。NULL = 未設定
        salt_set_at      DATETIME2(0)  NULL,
        salt_set_by      NVARCHAR(256) NULL,
        max_failures     INT           NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_maxf DEFAULT 5,
        lock_minutes     INT           NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_lockm DEFAULT 15,
        policy_min_len   INT           NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_pmin DEFAULT 8,
        policy_max_len   INT           NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_pmax DEFAULT 64,
        policy_min_classes INT         NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_pcls DEFAULT 2,
        policy_ascii_only  BIT         NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_pascii DEFAULT 1,
        policy_forbid_same BIT         NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_psame DEFAULT 1,
        policy_forbid_identity BIT     NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_pident DEFAULT 1,
        test_account_id  NVARCHAR(64)  NULL,       -- 照合テスト用のダミーアカウントの ID(任意)
        enabled          BIT           NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_enabled DEFAULT 1,
        created_by       NVARCHAR(256) NOT NULL,
        updated_by       NVARCHAR(256) NOT NULL,
        created_at       DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_created DEFAULT SYSUTCDATETIME(),
        updated_at       DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ux_ftool_app_pwchange_targets_conn UNIQUE (connection_id)
    );
END
GO

IF COL_LENGTH(N'dbo.ftool_app_pwchange_targets', N'salt_format') IS NULL
BEGIN
    ALTER TABLE dbo.ftool_app_pwchange_targets
        ADD salt_format NVARCHAR(8) NOT NULL CONSTRAINT df_ftool_app_pwchange_targets_sfmt DEFAULT N'text'
            CONSTRAINT ck_ftool_app_pwchange_targets_sfmt CHECK (salt_format IN (N'text', N'hex'));
END
GO

IF OBJECT_ID(N'dbo.ftool_app_pwchange_consents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_pwchange_consents (
        target_id    INT NOT NULL CONSTRAINT fk_ftool_app_pwchange_consents_target REFERENCES dbo.ftool_app_pwchange_targets(id) ON DELETE CASCADE,
        object_guid  UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_pwchange_consents_user REFERENCES dbo.ftool_app_users(object_guid) ON DELETE CASCADE,
        employee_no  NVARCHAR(64)  NOT NULL,
        consented_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_pwchange_consents_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT pk_ftool_app_pwchange_consents PRIMARY KEY (target_id, object_guid)
    );
END
GO

IF OBJECT_ID(N'dbo.ftool_app_table_auth', N'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.ftool_app_table_auth;
END
GO

IF OBJECT_ID(N'dbo.ftool_app_dept_map', N'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.ftool_app_dept_map;
END
GO

IF OBJECT_ID(N'dbo.ftool_app_operation_history', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_operation_history (
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
    CREATE INDEX ix_ftool_app_operation_history_at     ON dbo.ftool_app_operation_history(occurred_at DESC);
    CREATE INDEX ix_ftool_app_operation_history_user   ON dbo.ftool_app_operation_history(object_guid, occurred_at DESC);
    CREATE INDEX ix_ftool_app_operation_history_target ON dbo.ftool_app_operation_history(action_code, target);
END
GO

MERGE dbo.ftool_app_actions AS t
USING (VALUES
    (N'tables', N'テーブル管理', N'table_view', 1),
    (N'pwchange',    N'パスワード変更',       N'lock_reset', 2),
    (N'history',     N'操作履歴',             N'assignment', 3),
    (N'settings',    N'設定',                 N'settings', 999)
) AS s (code, name, icon, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, name, icon, sort_order, enabled, created_by, updated_by)
    VALUES (s.code, s.name, s.icon, s.sort_order, 1, N'setup:initdb', N'setup:initdb');
GO

UPDATE dbo.ftool_app_actions
SET sort_order = CASE code WHEN N'pwchange' THEN 2 WHEN N'history' THEN 3 END,
    updated_by = N'setup:initdb', updated_at = SYSUTCDATETIME()
WHERE (code = N'pwchange' AND sort_order = 3) OR (code = N'history' AND sort_order = 2);
GO

DELETE FROM dbo.ftool_app_actions WHERE code = N'users';
UPDATE dbo.ftool_app_actions
SET sort_order = 3, updated_by = N'setup:initdb', updated_at = SYSUTCDATETIME()
WHERE code = N'history' AND sort_order = 4;
GO

UPDATE dbo.ftool_app_actions
SET icon = CASE code WHEN N'pwchange' THEN N'lock_reset' WHEN N'history' THEN N'assignment' END,
    updated_by = N'setup:initdb', updated_at = SYSUTCDATETIME()
WHERE (code = N'pwchange' AND icon = N'password') OR (code = N'history' AND icon = N'history');
GO

IF OBJECT_ID(N'dbo.ftool_app_user_settings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ftool_app_user_settings (
        object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_settings_user REFERENCES dbo.ftool_app_users(object_guid) ON DELETE CASCADE,
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

IF OBJECT_ID(N'dbo.ftool_app_home_config', N'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.ftool_app_home_config;
END
GO



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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_products_code' AND object_id = OBJECT_ID(N'dbo.products'))
    CREATE UNIQUE INDEX ux_products_code ON dbo.products(code);
GO
IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.orders (
        id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        customer_id  INT           NOT NULL,
        product_code NVARCHAR(20)  NOT NULL,
        qty          INT           NOT NULL,
        ordered_on   DATE          NOT NULL CONSTRAINT df_orders_ordered DEFAULT CAST(SYSUTCDATETIME() AS DATE),
        note         NVARCHAR(200) NULL
    );
    INSERT INTO dbo.orders (customer_id, product_code, qty, ordered_on, note) VALUES
        (1, N'A-1001', 100, '2026-10-01', N'定期'),
        (1, N'C-3001',   2, '2026-10-02', NULL),
        (2, N'B-2001',  10, '2026-10-03', N'至急'),
        (3, N'A-1002',  50, '2026-10-05', NULL),
        (99, N'Z-9999',  1, '2026-10-06', N'参照先なし');
END
GO

IF OBJECT_ID(N'dbo.locations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.locations (
        warehouse NVARCHAR(10) NOT NULL,
        bin       NVARCHAR(10) NOT NULL,
        capacity  INT          NOT NULL,
        note      NVARCHAR(100) NULL,
        CONSTRAINT pk_locations PRIMARY KEY (warehouse, bin)
    );
    INSERT INTO dbo.locations (warehouse, bin, capacity, note) VALUES
        (N'W1', N'A-01', 100, N'1F 入口側'),
        (N'W1', N'A-02', 100, NULL),
        (N'W1', N'B-01',  50, N'重量物不可'),
        (N'W2', N'A-01', 200, N'2F');
END
GO
IF OBJECT_ID(N'dbo.lot_labels', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.lot_labels (
        id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        product_code NVARCHAR(20) NOT NULL,
        lot_no       NVARCHAR(20) NOT NULL,
        label        NVARCHAR(50) NOT NULL,
        expires_on   DATE         NULL,
        CONSTRAINT ux_lot_labels UNIQUE (product_code, lot_no)
    );
    INSERT INTO dbo.lot_labels (product_code, lot_no, label, expires_on) VALUES
        (N'A-1001', N'L2026-01', N'黒 2026 春ロット', '2028-03-31'),
        (N'A-1001', N'L2026-02', N'黒 2026 夏ロット', '2028-06-30'),
        (N'A-1002', N'L2026-01', N'A5 2026 春ロット', NULL),
        (N'B-2001', N'L2025-12', N'旧パッケージ',      '2027-12-31');
END
GO
IF OBJECT_ID(N'dbo.stock_moves', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.stock_moves (
        id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        product_code NVARCHAR(20) NOT NULL,
        lot_no       NVARCHAR(20) NOT NULL,
        warehouse    NVARCHAR(10) NOT NULL,
        bin          NVARCHAR(10) NOT NULL,
        qty          INT          NOT NULL,
        moved_on     DATE         NOT NULL CONSTRAINT df_stock_moves_moved DEFAULT CAST(SYSUTCDATETIME() AS DATE)
    );
    INSERT INTO dbo.stock_moves (product_code, lot_no, warehouse, bin, qty, moved_on) VALUES
        (N'A-1001', N'L2026-01', N'W1', N'A-01',  200, '2026-10-01'),
        (N'A-1001', N'L2026-02', N'W1', N'A-02',  150, '2026-10-02'),
        (N'A-1002', N'L2026-01', N'W1', N'B-01',   30, '2026-10-03'),
        (N'B-2001', N'L2025-12', N'W2', N'A-01',   40, '2026-10-04'),
        (N'C-3001', N'L2026-09', N'W3', N'Z-99',    1, '2026-10-05');
END
GO

MERGE dbo.ftool_app_managed_tables AS t
USING (VALUES
    (N'dbo', N'products',  N'商品マスタ',   N'products',  N'サンプル: rowversion あり', N'id', 1, N'[]'),
    (N'dbo', N'customers', N'取引先マスタ', N'customers', N'サンプル: rowversion なし', N'id', 2, N'[]'),
    (N'dbo', N'orders',    N'受注',         N'orders',    N'サンプル: 参照表示(取引先・商品)', N'id', 3,
     N'[{"columns":["customer_id"],"refSchema":"dbo","refTable":"customers","refKey":["id"],"display":["name","phone"],"label":"取引先"},{"columns":["product_code"],"refSchema":"dbo","refTable":"products","refKey":["code"],"display":["name","price"],"label":"商品"}]'),
    (N'dbo', N'stock_moves', N'入出庫',     N'stock-moves', N'サンプル: 複合キーの参照表示(棚・ロット)', N'id', 4,
     N'[{"columns":["product_code"],"refSchema":"dbo","refTable":"products","refKey":["code"],"display":["name"],"label":"商品"},{"columns":["warehouse","bin"],"refSchema":"dbo","refTable":"locations","refKey":["warehouse","bin"],"display":["capacity","note"],"label":"棚"},{"columns":["product_code","lot_no"],"refSchema":"dbo","refTable":"lot_labels","refKey":["product_code","lot_no"],"display":["label","expires_on"],"label":"ロット"}]')
) AS s (schema_name, table_name, display_name, slug, description, pk_columns, sort_order, lookups)
ON t.schema_name = s.schema_name AND t.table_name = s.table_name AND t.connection_id IS NULL
WHEN NOT MATCHED THEN
    INSERT (schema_name, table_name, display_name, slug, description, pk_columns, sort_order, lookups, created_by, updated_by)
    VALUES (s.schema_name, s.table_name, s.display_name, s.slug, s.description, s.pk_columns, s.sort_order, s.lookups, N'setup:initdb', N'setup:initdb');
GO

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

IF OBJECT_ID(N'dbo.app_accounts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_accounts (
        emp_no      NVARCHAR(10) NOT NULL PRIMARY KEY,
        name        NVARCHAR(50) NOT NULL,
        pw_hash     NVARCHAR(64) NOT NULL,
        must_change BIT          NOT NULL CONSTRAINT df_app_accounts_must DEFAULT 0,
        updated_at  DATETIME2    NOT NULL CONSTRAINT df_app_accounts_updated DEFAULT SYSUTCDATETIME()
    );
    INSERT INTO dbo.app_accounts (emp_no, name, pw_hash, must_change) VALUES
        (N'00001', N'local',       N'2c30a49b23086d575579ae0ccae76e32b3f066deee2d52f4b0c813d91f8efcad', 1),
        (N'00002', N'Jiro Suzuki', N'2c30a49b23086d575579ae0ccae76e32b3f066deee2d52f4b0c813d91f8efcad', 0),
        (N'00003', N'Hanako Sato', N'2c30a49b23086d575579ae0ccae76e32b3f066deee2d52f4b0c813d91f8efcad', 0),
        (N'99999', N'Test Dummy',  N'd8ccc23f1a542ceeb828c12f102502c834d701fdd08d8e1961ee1f581fc453f7', 0);
END
GO

IF OBJECT_ID(N'dbo.app_accounts_dup', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_accounts_dup (
        emp_no      NVARCHAR(10) NOT NULL,
        name        NVARCHAR(50) NOT NULL,
        pw_hash     NVARCHAR(64) NOT NULL,
        must_change BIT          NOT NULL CONSTRAINT df_app_accounts_dup_must DEFAULT 0,
        updated_at  DATETIME2    NOT NULL CONSTRAINT df_app_accounts_dup_updated DEFAULT SYSUTCDATETIME()
    );
    INSERT INTO dbo.app_accounts_dup (emp_no, name, pw_hash, must_change) VALUES
        (N'00003', N'Hanako Sato',    N'2c30a49b23086d575579ae0ccae76e32b3f066deee2d52f4b0c813d91f8efcad', 0),
        (N'10006', N'中村 一郎',       N'2c30a49b23086d575579ae0ccae76e32b3f066deee2d52f4b0c813d91f8efcad', 0),
        (N'10006', N'中村 一郎(旧)',   N'2c30a49b23086d575579ae0ccae76e32b3f066deee2d52f4b0c813d91f8efcad', 0),
        (N'99999', N'Test Dummy',     N'd8ccc23f1a542ceeb828c12f102502c834d701fdd08d8e1961ee1f581fc453f7', 0);
END
GO

IF OBJECT_ID(N'dbo.empty_demo', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.empty_demo (
        id   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(50) NOT NULL,
        note NVARCHAR(200) NULL
    );
END
GO

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
