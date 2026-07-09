-- 開発用の確認クエリ(検証専用。本番では使わない)
USE tablemaint;
GO
SELECT COL_LENGTH('dbo.app_actions', 'url') AS url_col_len;
SELECT id, code, name, is_builtin, url FROM dbo.app_actions ORDER BY sort_order;
GO
