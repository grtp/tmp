package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, no cgo; registers name "sqlite"
)

type SQLiteStore struct{ db *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS products (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	code       TEXT    NOT NULL UNIQUE,
	name       TEXT    NOT NULL,
	category   TEXT    NOT NULL DEFAULT '',
	price      INTEGER NOT NULL DEFAULT 0,
	stock      INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT    NOT NULL
);`

func NewSQLiteStore(path string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite allows only one writer; keep a single connection to serialize
	// writes cleanly and enable foreign keys / WAL for better concurrency.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return &SQLiteStore{db: db}, nil
}

func (s *SQLiteStore) Close() error { return s.db.Close() }

func (s *SQLiteStore) List(ctx context.Context, q string, limit, offset int) (Page, error) {
	where, args := "", []any{}
	if q = strings.TrimSpace(q); q != "" {
		where = "WHERE code LIKE ? OR name LIKE ? OR category LIKE ?"
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}

	var total int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM products "+where, args...).Scan(&total); err != nil {
		return Page{}, err
	}

	rows, err := s.db.QueryContext(ctx,
		"SELECT id, code, name, category, price, stock, updated_at FROM products "+
			where+" ORDER BY id LIMIT ? OFFSET ?",
		append(args, limit, offset)...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()

	items := make([]Product, 0, limit)
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return Page{}, err
		}
		items = append(items, p)
	}
	return Page{Items: items, Total: total}, rows.Err()
}

func (s *SQLiteStore) Get(ctx context.Context, id int64) (Product, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, code, name, category, price, stock, updated_at FROM products WHERE id = ?", id)
	p, err := scanProduct(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Product{}, ErrNotFound
	}
	return p, err
}

func (s *SQLiteStore) Create(ctx context.Context, in ProductInput) (Product, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		"INSERT INTO products (code, name, category, price, stock, updated_at) VALUES (?,?,?,?,?,?)",
		in.Code, in.Name, in.Category, in.Price, in.Stock, formatTime(now))
	if err != nil {
		return Product{}, mapWriteErr(err)
	}
	id, _ := res.LastInsertId()
	return Product{ID: id, Code: in.Code, Name: in.Name, Category: in.Category,
		Price: in.Price, Stock: in.Stock, UpdatedAt: now}, nil
}

func (s *SQLiteStore) Update(ctx context.Context, id int64, in ProductInput) (Product, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		"UPDATE products SET code=?, name=?, category=?, price=?, stock=?, updated_at=? WHERE id=?",
		in.Code, in.Name, in.Category, in.Price, in.Stock, formatTime(now), id)
	if err != nil {
		return Product{}, mapWriteErr(err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Product{}, ErrNotFound
	}
	return Product{ID: id, Code: in.Code, Name: in.Name, Category: in.Category,
		Price: in.Price, Stock: in.Stock, UpdatedAt: now}, nil
}

func (s *SQLiteStore) Delete(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM products WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// BulkCreate inserts many rows atomically. Each row is validated first; any bad
// row aborts the whole transaction so the file is "all or nothing".
func (s *SQLiteStore) BulkCreate(ctx context.Context, items []ProductInput) (ImportResult, error) {
	// Validate up front and collect every problem, so the client gets one
	// report listing all bad rows instead of failing on the first.
	var failed []ImportError
	for i := range items {
		if err := items[i].Validate(); err != nil {
			failed = append(failed, ImportError{Row: i + 1, Reason: err.Error()})
		}
	}
	if len(failed) > 0 {
		return ImportResult{Inserted: 0, Failed: failed}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, err
	}
	defer tx.Rollback() //nolint: rolled back unless we Commit below.

	stmt, err := tx.PrepareContext(ctx,
		"INSERT INTO products (code, name, category, price, stock, updated_at) VALUES (?,?,?,?,?,?)")
	if err != nil {
		return ImportResult{}, err
	}
	defer stmt.Close()

	now := formatTime(time.Now().UTC())
	for i := range items {
		in := items[i]
		if _, err := stmt.ExecContext(ctx, in.Code, in.Name, in.Category, in.Price, in.Stock, now); err != nil {
			// e.g. duplicate code violates UNIQUE — abort the whole batch.
			return ImportResult{Inserted: 0, Failed: []ImportError{{
				Row:    i + 1,
				Reason: mapWriteErr(err).Error(),
			}}}, nil
		}
	}
	if err := tx.Commit(); err != nil {
		return ImportResult{}, err
	}
	return ImportResult{Inserted: len(items)}, nil
}

// --- helpers ---

type scanner interface{ Scan(dest ...any) error }

func scanProduct(s scanner) (Product, error) {
	var p Product
	var ts string
	if err := s.Scan(&p.ID, &p.Code, &p.Name, &p.Category, &p.Price, &p.Stock, &ts); err != nil {
		return Product{}, err
	}
	p.UpdatedAt, _ = time.Parse(time.RFC3339, ts)
	return p, nil
}

func formatTime(t time.Time) string { return t.Format(time.RFC3339) }

// ErrDuplicateCode surfaces a UNIQUE(code) violation as a domain error the HTTP
// layer can turn into 409 Conflict.
var ErrDuplicateCode = errors.New("code already exists")

func mapWriteErr(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "UNIQUE") && strings.Contains(err.Error(), "code") {
		return ErrDuplicateCode
	}
	return fmt.Errorf("write failed: %w", err)
}
