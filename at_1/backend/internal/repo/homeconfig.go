package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type HomeConfig struct {
	Config    string
	UpdatedBy string
	UpdatedAt time.Time
}

func (r *Repo) GetHomeConfig(ctx context.Context) (*HomeConfig, error) {
	row := r.queryRow(ctx, `
		SELECT config, updated_by, updated_at
		FROM dbo.ftool_app_home_config WHERE id = 1`)
	var hc HomeConfig
	if err := row.Scan(&hc.Config, &hc.UpdatedBy, &hc.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("repo: get home config: %w", err)
	}
	return &hc, nil
}

func (r *Repo) SetHomeConfig(ctx context.Context, config, actor string) error {
	const q = `
MERGE dbo.ftool_app_home_config WITH (HOLDLOCK) AS t
USING (SELECT 1 AS id) AS s
ON t.id = s.id
WHEN MATCHED THEN
    UPDATE SET config = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (id, config, created_by, updated_by)
    VALUES (1, @p1, @p2, @p2);`
	if _, err := r.exec(ctx, q, config, actor); err != nil {
		return fmt.Errorf("repo: set home config: %w", err)
	}
	return nil
}

func (r *Repo) DeleteHomeConfig(ctx context.Context) error {
	if _, err := r.exec(ctx, `DELETE FROM dbo.ftool_app_home_config WHERE id = 1`); err != nil {
		return fmt.Errorf("repo: delete home config: %w", err)
	}
	return nil
}
