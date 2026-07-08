-- 開発用の確認クエリ(検証専用。本番では使わない)
USE tablemaint;
GO
SELECT name, is_unique FROM sys.indexes
WHERE object_id = OBJECT_ID('dbo.app_users') AND name LIKE '%username%';
SELECT code, name FROM dbo.app_actions ORDER BY sort_order;
SELECT id, schema_name, table_name, display_name FROM dbo.app_managed_tables ORDER BY sort_order;
SELECT COUNT(*) AS products FROM dbo.products;
SELECT COUNT(*) AS customers FROM dbo.customers;
GO
