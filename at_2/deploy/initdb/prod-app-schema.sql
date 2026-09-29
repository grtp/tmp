
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
    CREATE INDEX ix_ftool_app_users_username ON $(APP_SCHEMA).ftool_app_users(username);
END
GO

IF COL_LENGTH(N'$(APP_SCHEMA).ftool_app_users', N'department') IS NULL
BEGIN
    ALTER TABLE $(APP_SCHEMA).ftool_app_users ADD department NVARCHAR(256) NULL;
END
GO
IF COL_LENGTH(N'$(APP_SCHEMA).ftool_app_users', N'title') IS NULL
BEGIN
    ALTER TABLE $(APP_SCHEMA).ftool_app_users ADD title NVARCHAR(128) NULL;
END
GO

IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_user_groups', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_user_groups (
        object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_groups_user REFERENCES $(APP_SCHEMA).ftool_app_users(object_guid) ON DELETE CASCADE,
        group_dn    NVARCHAR(400) NOT NULL,
        CONSTRAINT pk_ftool_app_user_groups PRIMARY KEY (object_guid, group_dn)
    );
END
GO

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

IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_groups', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_groups (
        id          INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_groups PRIMARY KEY,
        name        NVARCHAR(128) NOT NULL CONSTRAINT ux_ftool_app_groups_name UNIQUE,
        description NVARCHAR(400) NULL,
        created_by  NVARCHAR(256) NOT NULL,
        updated_by  NVARCHAR(256) NOT NULL,
        created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_groups_created DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_groups_updated DEFAULT SYSUTCDATETIME()
    );
END
GO

SET QUOTED_IDENTIFIER ON;
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_group_members', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_group_members (
        group_id        INT NOT NULL CONSTRAINT fk_ftool_app_group_members_group REFERENCES $(APP_SCHEMA).ftool_app_groups(id) ON DELETE CASCADE,
        object_guid     UNIQUEIDENTIFIER NULL CONSTRAINT fk_ftool_app_group_members_user REFERENCES $(APP_SCHEMA).ftool_app_users(object_guid) ON DELETE CASCADE,
        member_group_id INT NULL CONSTRAINT fk_ftool_app_group_members_member REFERENCES $(APP_SCHEMA).ftool_app_groups(id),
        created_by      NVARCHAR(256) NOT NULL,
        created_at      DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_group_members_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ck_ftool_app_group_members_one CHECK ((object_guid IS NULL AND member_group_id IS NOT NULL) OR (object_guid IS NOT NULL AND member_group_id IS NULL)),
        CONSTRAINT ck_ftool_app_group_members_self CHECK (member_group_id IS NULL OR member_group_id <> group_id)
    );
    CREATE UNIQUE INDEX ux_ftool_app_group_members_user
        ON $(APP_SCHEMA).ftool_app_group_members(group_id, object_guid) WHERE object_guid IS NOT NULL;
    CREATE UNIQUE INDEX ux_ftool_app_group_members_group
        ON $(APP_SCHEMA).ftool_app_group_members(group_id, member_group_id) WHERE member_group_id IS NOT NULL;
    CREATE INDEX ix_ftool_app_group_members_user ON $(APP_SCHEMA).ftool_app_group_members(object_guid);
    CREATE INDEX ix_ftool_app_group_members_member ON $(APP_SCHEMA).ftool_app_group_members(member_group_id);
END
GO

IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_group_auth', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_group_auth (
        group_id   INT NOT NULL CONSTRAINT fk_ftool_app_group_auth_group REFERENCES $(APP_SCHEMA).ftool_app_groups(id) ON DELETE CASCADE,
        action_id  INT NOT NULL CONSTRAINT fk_ftool_app_group_auth_action REFERENCES $(APP_SCHEMA).ftool_app_actions(id) ON DELETE CASCADE,
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
IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_resource_auth', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_resource_auth (
        id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_resource_auth PRIMARY KEY,
        resource_type NVARCHAR(32) NOT NULL CONSTRAINT ck_ftool_app_resource_auth_type CHECK (resource_type IN (N'action', N'managed_table')),
        resource_id   INT NOT NULL,
        object_guid   UNIQUEIDENTIFIER NULL CONSTRAINT fk_ftool_app_resource_auth_user REFERENCES $(APP_SCHEMA).ftool_app_users(object_guid) ON DELETE CASCADE,
        group_id      INT NULL CONSTRAINT fk_ftool_app_resource_auth_group REFERENCES $(APP_SCHEMA).ftool_app_groups(id) ON DELETE CASCADE,
        auth_level    NVARCHAR(8) NOT NULL CONSTRAINT ck_ftool_app_resource_auth_level CHECK (auth_level IN (N'r', N'rw')),
        created_by    NVARCHAR(256) NOT NULL,
        updated_by    NVARCHAR(256) NOT NULL,
        created_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_resource_auth_created DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_resource_auth_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT ck_ftool_app_resource_auth_subject CHECK ((object_guid IS NULL AND group_id IS NOT NULL) OR (object_guid IS NOT NULL AND group_id IS NULL))
    );
    CREATE UNIQUE INDEX ux_ftool_app_resource_auth_user
        ON $(APP_SCHEMA).ftool_app_resource_auth(resource_type, resource_id, object_guid) WHERE object_guid IS NOT NULL;
    CREATE UNIQUE INDEX ux_ftool_app_resource_auth_group
        ON $(APP_SCHEMA).ftool_app_resource_auth(resource_type, resource_id, group_id) WHERE group_id IS NOT NULL;
    CREATE INDEX ix_ftool_app_resource_auth_subject_user ON $(APP_SCHEMA).ftool_app_resource_auth(object_guid);
    CREATE INDEX ix_ftool_app_resource_auth_subject_group ON $(APP_SCHEMA).ftool_app_resource_auth(group_id);
END
GO

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

IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_managed_tables', N'U') IS NULL
BEGIN
    CREATE TABLE $(APP_SCHEMA).ftool_app_managed_tables (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_managed_tables PRIMARY KEY,
        connection_id INT NULL CONSTRAINT fk_ftool_app_managed_tables_conn REFERENCES $(APP_SCHEMA).ftool_app_connections(id),
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

IF COL_LENGTH(N'$(APP_SCHEMA).ftool_app_managed_tables', N'color') IS NULL
BEGIN
    ALTER TABLE $(APP_SCHEMA).ftool_app_managed_tables ADD color NVARCHAR(16) NULL;
END
GO

IF OBJECT_ID(N'$(APP_SCHEMA).ftool_app_table_auth', N'U') IS NOT NULL
BEGIN
    DROP TABLE $(APP_SCHEMA).ftool_app_table_auth;
END
GO

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

