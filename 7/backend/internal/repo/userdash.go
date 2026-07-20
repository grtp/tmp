package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"f-tool/internal/auth/adguid"
)

type UserDash struct {
	// TemplateID: nil = 既定(権限のある全機能を表示)。
	TemplateID *int
	// CardOrder: JSON 配列の文字列("" = 未設定)。中身の解釈はフロント。
	CardOrder string
	// HiddenKeys: ユーザーが非表示にしたカードキーの JSON 配列("" = なし)。
	// テンプレート(再)選択でクリアされ，カードが復元される。
	HiddenKeys string
}

// GetUserDash returns the caller's settings(行が無ければゼロ値)。
func (r *Repo) GetUserDash(ctx context.Context, guid adguid.GUID) (*UserDash, error) {
	var d UserDash
	var tid sql.NullInt64
	var order, hidden sql.NullString
	err := r.queryRow(ctx, `
		SELECT template_id, card_order, hidden_keys FROM dbo.app_user_dash
		WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER)`, string(guid)).
		Scan(&tid, &order, &hidden)
	if errors.Is(err, sql.ErrNoRows) {
		return &UserDash{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("repo: get user dash: %w", err)
	}
	if tid.Valid {
		v := int(tid.Int64)
		d.TemplateID = &v
	}
	d.CardOrder = order.String
	d.HiddenKeys = hidden.String
	return &d, nil
}

// SetUserDash は本人の設定を全置換で保存する(MERGE upsert)。
// 存在しない/無効なテンプレート指定は ErrConflict。
func (r *Repo) SetUserDash(ctx context.Context, guid adguid.GUID, d UserDash) error {
	if d.TemplateID != nil {
		var enabled bool
		// 他人の個人テンプレートは存在しない扱い(選択不可)。
		err := r.queryRow(ctx, `
			SELECT enabled FROM dbo.app_dash_templates
			WHERE id = @p1
			  AND (owner_guid IS NULL OR owner_guid = CAST(@p2 AS UNIQUEIDENTIFIER))`,
			*d.TemplateID, string(guid)).
			Scan(&enabled)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !enabled) {
			return fmt.Errorf("%w: 指定のテンプレートは存在しないか無効です", ErrConflict)
		}
		if err != nil {
			return fmt.Errorf("repo: check template: %w", err)
		}
	}

	var tid any
	if d.TemplateID != nil {
		tid = *d.TemplateID
	}
	var order any
	if strings.TrimSpace(d.CardOrder) != "" {
		order = d.CardOrder
	}
	var hidden any
	if strings.TrimSpace(d.HiddenKeys) != "" {
		hidden = d.HiddenKeys
	}

	const q = `
MERGE dbo.app_user_dash WITH (HOLDLOCK) AS t
USING (SELECT CAST(@p1 AS UNIQUEIDENTIFIER) AS object_guid) AS s
ON t.object_guid = s.object_guid
WHEN MATCHED THEN
    UPDATE SET template_id = @p2, card_order = @p3, hidden_keys = @p4, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (object_guid, template_id, card_order, hidden_keys)
    VALUES (@p1, @p2, @p3, @p4);`

	if _, err := r.exec(ctx, q, string(guid), tid, order, hidden); err != nil {
		return fmt.Errorf("repo: set user dash: %w", err)
	}
	return nil
}
