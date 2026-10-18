
USE ftool;
GO
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

WITH ranked AS (
    SELECT object_guid,
           ROW_NUMBER() OVER (PARTITION BY username ORDER BY last_login_at DESC, created_at DESC) AS rn
    FROM dbo.ftool_app_users
    WHERE username IN (N'local', N'suzuki', N'sato')
)
DELETE u FROM dbo.ftool_app_users u JOIN ranked r ON r.object_guid = u.object_guid WHERE r.rn > 1;
PRINT CONCAT('stale user rows deleted: ', @@ROWCOUNT);

DELETE ua FROM dbo.ftool_app_user_auth ua
JOIN dbo.ftool_app_users u ON u.object_guid = ua.object_guid
WHERE u.username IN (N'local', N'suzuki', N'sato');

INSERT INTO dbo.ftool_app_user_auth (object_guid, action_id, auth_level, created_by, updated_by)
SELECT u.object_guid, a.id, x.lvl, N'setup:dev_grants', N'setup:dev_grants'
FROM (VALUES
    (N'local',  N'tables',   N'admin'),
    (N'local',  N'settings', N'admin'),
    (N'local',  N'history',  N'admin'),
    (N'local',  N'pwchange', N'admin'),
    (N'suzuki', N'tables',   N'maintainer'),
    (N'suzuki', N'history',  N'maintainer'),
    (N'sato',   N'tables',   N'user'),
    (N'sato',   N'pwchange', N'user')
) AS x(un, code, lvl)
JOIN dbo.ftool_app_users u ON u.username = x.un
JOIN dbo.ftool_app_actions a ON a.code = x.code;
PRINT CONCAT('grants: ', @@ROWCOUNT);

INSERT INTO dbo.ftool_app_resource_auth (resource_type, resource_id, object_guid, auth_level, created_by, updated_by)
SELECT N'pwchange_target', t.id, u.object_guid, N'r', N'setup:dev_grants', N'setup:dev_grants'
FROM dbo.ftool_app_users u
CROSS JOIN (SELECT MIN(id) AS id FROM dbo.ftool_app_pwchange_targets) t
WHERE u.username = N'sato' AND t.id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.ftool_app_resource_auth r
                  WHERE r.resource_type = N'pwchange_target' AND r.resource_id = t.id AND r.object_guid = u.object_guid);
PRINT CONCAT('sato pwchange target grant: ', @@ROWCOUNT);

SELECT u.username, a.code, ua.auth_level
FROM dbo.ftool_app_user_auth ua
JOIN dbo.ftool_app_users u ON u.object_guid = ua.object_guid
JOIN dbo.ftool_app_actions a ON a.id = ua.action_id
ORDER BY u.username, a.sort_order;
GO
