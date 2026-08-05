package repo

import (
	"context"
	"fmt"

	"f-tool/internal/auth/adguid"
)

// ユーザー個人の設定(ftool_app_user_settings)。本人だけが参照・変更する。
// 設定項目ごとに列を増やすと都度 DDL/API が要るため,キー・値の1行1設定で
// 持つ。行が無い = 既定値。

// SettingHeaderClock はヘッダー時計の表示モード("none"/"minute"/"second"/"custom")。
const SettingHeaderClock = "header_clock"

// SettingHeaderClockFormat は header_clock=custom のときの書式文字列。
// 書式の解釈はフロント(clock-format.ts)が正。
const SettingHeaderClockFormat = "header_clock_format"

// UserSettings は既知の設定キーを型付きで束ねたもの(API の応答形)。
type UserSettings struct {
	HeaderClock       string
	HeaderClockFormat string
}

// GetUserSettings は本人の設定を読む。未設定のキーは既定値のままにする。
func (r *Repo) GetUserSettings(ctx context.Context, guid adguid.GUID) (UserSettings, error) {
	s := UserSettings{HeaderClock: "minute"}
	rows, err := r.query(ctx, `
		SELECT setting_key, value FROM dbo.ftool_app_user_settings
		WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`, string(guid))
	if err != nil {
		return s, fmt.Errorf("repo: get user settings: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return s, fmt.Errorf("repo: scan user setting: %w", err)
		}
		switch key {
		case SettingHeaderClock:
			s.HeaderClock = value
		case SettingHeaderClockFormat:
			s.HeaderClockFormat = value
		}
	}
	if err := rows.Err(); err != nil {
		return s, fmt.Errorf("repo: get user settings: %w", err)
	}
	return s, nil
}

// SetUserSetting は本人の設定キーを更新する(無ければ作る)。
// 値の妥当性検証は httpapi 側の責務。
func (r *Repo) SetUserSetting(ctx context.Context, guid adguid.GUID, key, value, actor string) error {
	const q = `
MERGE dbo.ftool_app_user_settings WITH (HOLDLOCK) AS t
USING (SELECT CAST(@p1 AS UNIQUEIDENTIFIER) AS object_guid, @p2 AS setting_key) AS s
ON t.object_guid = s.object_guid AND t.setting_key = s.setting_key
WHEN MATCHED THEN
    UPDATE SET value = @p3, updated_by = @p4, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (object_guid, setting_key, value, created_by, updated_by)
    VALUES (s.object_guid, s.setting_key, @p3, @p4, @p4);`
	if _, err := r.exec(ctx, q, string(guid), key, value, actor); err != nil {
		return fmt.Errorf("repo: set user setting: %w", err)
	}
	return nil
}
