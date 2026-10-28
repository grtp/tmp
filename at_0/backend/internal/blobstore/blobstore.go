package blobstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"f-tool/internal/appdb"
)

var ErrNotFound = errors.New("blobstore: not found")

type Store struct {
	db *sql.DB
}

func New(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Put(ctx context.Context, key string, data []byte, contentType string) error {
	const q = `
INSERT INTO dbo.ftool_app_operation_history_blob (blob_key, content_type, content)
VALUES (@p1, @p2, @p3)`
	if _, err := s.db.ExecContext(ctx, appdb.Q(q), key, contentType, string(data)); err != nil {
		return fmt.Errorf("blobstore: put %s: %w", key, err)
	}
	return nil
}

func (s *Store) Get(ctx context.Context, key string) ([]byte, error) {
	const q = `SELECT content FROM dbo.ftool_app_operation_history_blob WHERE blob_key = @p1`
	var content string
	err := s.db.QueryRowContext(ctx, appdb.Q(q), key).Scan(&content)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, key)
	}
	if err != nil {
		return nil, fmt.Errorf("blobstore: get %s: %w", key, err)
	}
	return []byte(content), nil
}
