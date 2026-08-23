CREATE TABLE TMP_SCHEMA.ftool_app_users (
    object_guid   UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_ftool_app_users PRIMARY KEY,
    username      NVARCHAR(256) NOT NULL,
    display_name  NVARCHAR(256) NOT NULL,
    email         NVARCHAR(320) NULL,
    last_login_at DATETIME2(0)  NULL,
    created_by    NVARCHAR(256) NOT NULL,
    updated_by    NVARCHAR(256) NOT NULL,
    created_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_users_created DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_users_updated DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_ftool_app_users_username ON TMP_SCHEMA.ftool_app_users(username);

CREATE TABLE TMP_SCHEMA.ftool_app_actions (
    id         INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_actions PRIMARY KEY,
    code       NVARCHAR(64)  NOT NULL CONSTRAINT ux_ftool_app_actions_code UNIQUE,
    name       NVARCHAR(128) NOT NULL,
    icon       NVARCHAR(64)  NOT NULL CONSTRAINT df_ftool_app_actions_icon DEFAULT N'apps',
    sort_order INT           NOT NULL CONSTRAINT df_ftool_app_actions_sort DEFAULT 0,
    enabled    BIT           NOT NULL CONSTRAINT df_ftool_app_actions_enabled DEFAULT 1,
    created_by NVARCHAR(256) NOT NULL,
    updated_by NVARCHAR(256) NOT NULL,
    created_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_actions_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_actions_updated DEFAULT SYSUTCDATETIME()
);

CREATE TABLE TMP_SCHEMA.ftool_app_user_auth (
    object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_auth_user REFERENCES TMP_SCHEMA.ftool_app_users(object_guid) ON DELETE CASCADE,
    action_id   INT NOT NULL CONSTRAINT fk_ftool_app_user_auth_action REFERENCES TMP_SCHEMA.ftool_app_actions(id) ON DELETE CASCADE,
    auth_level  NVARCHAR(16) NOT NULL CONSTRAINT ck_ftool_app_user_auth_level CHECK (auth_level IN (N'admin', N'maintainer', N'user')),
    created_by  NVARCHAR(256) NOT NULL,
    updated_by  NVARCHAR(256) NOT NULL,
    created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_auth_created DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_auth_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_ftool_app_user_auth PRIMARY KEY (object_guid, action_id)
);
CREATE INDEX ix_ftool_app_user_auth_action ON TMP_SCHEMA.ftool_app_user_auth(action_id);

CREATE TABLE TMP_SCHEMA.ftool_app_connections (
    id            INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_connections PRIMARY KEY,
    name          NVARCHAR(128)  NOT NULL CONSTRAINT ux_ftool_app_connections_name UNIQUE,
    host          NVARCHAR(255)  NOT NULL,
    port          INT            NOT NULL CONSTRAINT df_ftool_app_connections_port DEFAULT 1433,
    database_name SYSNAME        NOT NULL,
    username      NVARCHAR(128)  NOT NULL,
    password_enc  VARBINARY(512) NOT NULL,
    options       NVARCHAR(256)  NULL,               -- 追加 DSN パラメータ(例: encrypt=disable)
    schema_name   SYSNAME        NULL,               -- NULL = 制限なし
    enabled       BIT            NOT NULL CONSTRAINT df_ftool_app_connections_enabled DEFAULT 1,
    created_by    NVARCHAR(256)  NOT NULL,
    updated_by    NVARCHAR(256)  NOT NULL,
    created_at    DATETIME2(0)   NOT NULL CONSTRAINT df_ftool_app_connections_created DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2(0)   NOT NULL CONSTRAINT df_ftool_app_connections_updated DEFAULT SYSUTCDATETIME()
);

CREATE TABLE TMP_SCHEMA.ftool_app_managed_tables (
    id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_managed_tables PRIMARY KEY,
    connection_id INT NULL CONSTRAINT fk_ftool_app_managed_tables_conn REFERENCES TMP_SCHEMA.ftool_app_connections(id),
    schema_name  SYSNAME       NOT NULL,
    table_name   SYSNAME       NOT NULL,
    display_name NVARCHAR(128) NOT NULL,
    slug         NVARCHAR(64)  NOT NULL,
    description  NVARCHAR(400) NULL,
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

CREATE TABLE TMP_SCHEMA.ftool_app_operation_history (
    id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ftool_app_operation_history PRIMARY KEY,
    occurred_at DATETIME2(3)     NOT NULL CONSTRAINT df_ftool_app_operation_history_at DEFAULT SYSUTCDATETIME(),
    object_guid UNIQUEIDENTIFIER NULL,      -- 認証失敗など本人不明の操作は NULL
    username    NVARCHAR(256)    NOT NULL,
    action_code NVARCHAR(64)     NOT NULL,  -- 'auth' / 'tables' / 'settings' / 'history'
    operation   NVARCHAR(64)     NOT NULL,  -- 'login' / 'rows.batch' / 'managed-table.create' ...
    target      NVARCHAR(512)    NULL,      -- 例: 'dbo.products', '<接続名>:schema.table', 'user:<guid>'
    detail      NVARCHAR(MAX)    NULL,      -- JSON(変更前後・件数など)
    result      NVARCHAR(16)     NOT NULL CONSTRAINT ck_ftool_app_operation_history_result CHECK (result IN (N'success', N'failure')),
    error_code  NVARCHAR(64)     NULL,
    client_ip   NVARCHAR(45)     NULL
);
CREATE INDEX ix_ftool_app_operation_history_at     ON TMP_SCHEMA.ftool_app_operation_history(occurred_at DESC);
CREATE INDEX ix_ftool_app_operation_history_user   ON TMP_SCHEMA.ftool_app_operation_history(object_guid, occurred_at DESC);
CREATE INDEX ix_ftool_app_operation_history_target ON TMP_SCHEMA.ftool_app_operation_history(action_code, target);

MERGE TMP_SCHEMA.ftool_app_actions AS t
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

CREATE TABLE TMP_SCHEMA.ftool_app_user_settings (
    object_guid UNIQUEIDENTIFIER NOT NULL CONSTRAINT fk_ftool_app_user_settings_user REFERENCES TMP_SCHEMA.ftool_app_users(object_guid) ON DELETE CASCADE,
    setting_key NVARCHAR(64)  NOT NULL,
    value       NVARCHAR(400) NOT NULL,
    created_by  NVARCHAR(256) NOT NULL,
    updated_by  NVARCHAR(256) NOT NULL,
    created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_settings_created DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_user_settings_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_ftool_app_user_settings PRIMARY KEY (object_guid, setting_key)
);

CREATE TABLE TMP_SCHEMA.ftool_app_home_config (
    id          INT           NOT NULL CONSTRAINT pk_ftool_app_home_config PRIMARY KEY CONSTRAINT ck_ftool_app_home_config_single CHECK (id = 1),
    config      NVARCHAR(MAX) NOT NULL CONSTRAINT ck_ftool_app_home_config_json CHECK (ISJSON(config) = 1),
    created_by  NVARCHAR(256) NOT NULL,
    updated_by  NVARCHAR(256) NOT NULL,
    created_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_home_config_created DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2(0)  NOT NULL CONSTRAINT df_ftool_app_home_config_updated DEFAULT SYSUTCDATETIME()
);
