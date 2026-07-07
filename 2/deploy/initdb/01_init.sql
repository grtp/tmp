-- deploy/initdb/01_init.sql
-- 開発用 SQL Server の初期化。compose.dev の mssql-init が sqlcmd で実行する。
-- 本番は既存の社内 SQL Server を使うため、このファイルの内容(特に
-- app_user_roles)は本番向けマイグレーションとして別途手配すること。

IF DB_ID(N'tablemaint') IS NULL
    CREATE DATABASE tablemaint;
GO
USE tablemaint;
GO

-- ---------------------------------------------------------------- 権限テーブル
IF OBJECT_ID(N'dbo.app_user_roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.app_user_roles (
        object_guid   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,  -- AD objectGUID (正規化済み)
        username      NVARCHAR(64)  NOT NULL,  -- 表示・監査用スナップショット(照合には使わない)
        display_name  NVARCHAR(128) NULL,
        role          NVARCHAR(16)  NOT NULL
            CONSTRAINT ck_app_user_roles_role CHECK (role IN (N'admin', N'maintainer', N'user')),
        updated_at    DATETIME2     NOT NULL CONSTRAINT df_app_user_roles_updated DEFAULT SYSUTCDATETIME(),
        updated_by    NVARCHAR(64)  NOT NULL
    );
END
GO

-- モックユーザー(auth.MockGUID)を admin でシード。
-- LDAP_MOCK=true でログインすると MERGE の MATCHED 側に入り、この role が維持される。
MERGE dbo.app_user_roles AS t
USING (SELECT CAST('00000000-0000-0000-0000-000000000001' AS UNIQUEIDENTIFIER) AS g) AS s
ON t.object_guid = s.g
WHEN NOT MATCHED THEN
    INSERT (object_guid, username, display_name, role, updated_by)
    VALUES (s.g, N'admin', N'Mock Admin', N'admin', N'setup:initdb');
GO

-- ---------------------------------------------------------------- サンプル: 商品マスタ
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
