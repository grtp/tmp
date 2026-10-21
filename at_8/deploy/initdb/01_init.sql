
:setvar APP_SCHEMA dbo

IF DB_ID(N'ftool') IS NULL
    CREATE DATABASE ftool;
GO
USE ftool;
GO

IF SCHEMA_ID(N'$(APP_SCHEMA)') IS NULL
    EXEC(N'CREATE SCHEMA [$(APP_SCHEMA)]');
GO

:r prod-app-schema.sql

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

MERGE $(APP_SCHEMA).ftool_app_managed_tables AS t
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
