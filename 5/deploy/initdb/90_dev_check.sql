-- 開発用の確認クエリ(検証専用。本番では使わない)
USE tablemaint;
GO
SELECT code, name, sort_order, is_builtin FROM dbo.app_actions ORDER BY sort_order;
SELECT a.code, ua.auth_level, u.username
FROM dbo.app_user_auth ua
JOIN dbo.app_actions a ON a.id = ua.action_id
JOIN dbo.app_users u ON u.object_guid = ua.object_guid
ORDER BY u.username, a.sort_order;
SELECT COUNT(*) AS managed_tables FROM dbo.app_managed_tables;
SELECT COUNT(*) AS connections FROM dbo.app_connections;
GO
