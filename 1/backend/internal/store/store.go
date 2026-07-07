package store

import (
	"context"
	"errors"
	"strings"
	"time"
)

// ErrNotFound is returned by Get/Update/Delete when the id does not exist.
var ErrNotFound = errors.New("not found")

// Product is the maintained table. Swap these fields (and the SQL/schema) to
// adapt the whole app to a different master table — the HTTP and Angular layers
// are otherwise generic.
type Product struct {
	ID        int64     `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Price     int64     `json:"price"`
	Stock     int64     `json:"stock"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ProductInput is the writable subset used for create/update/import. Keeping it
// separate from Product means clients can never set id or updatedAt.
type ProductInput struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Price    int64  `json:"price"`
	Stock    int64  `json:"stock"`
}

// Validate enforces the field-level invariants shared by every write path.
func (in *ProductInput) Validate() error {
	in.Code = strings.TrimSpace(in.Code)
	in.Name = strings.TrimSpace(in.Name)
	in.Category = strings.TrimSpace(in.Category)

	var problems []string
	if in.Code == "" {
		problems = append(problems, "code is required")
	}
	if in.Name == "" {
		problems = append(problems, "name is required")
	}
	if in.Price < 0 {
		problems = append(problems, "price must be >= 0")
	}
	if in.Stock < 0 {
		problems = append(problems, "stock must be >= 0")
	}
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	return nil
}

// Page is a slice of rows plus the unfiltered-by-paging total, so the SPA can
// render "showing 100 of 1,234".
type Page struct {
	Items []Product `json:"items"`
	Total int       `json:"total"`
}

// ImportResult reports the outcome of a CSV/JSON bulk add. Rows are validated
// individually; the whole import commits or rolls back as one transaction.
type ImportResult struct {
	Inserted int           `json:"inserted"`
	Failed   []ImportError `json:"failed"`
}

type ImportError struct {
	Row    int    `json:"row"` // 1-based row index in the source file
	Reason string `json:"reason"`
}

// ProductStore is the persistence contract. Any backend (SQLite, Postgres, an
// in-memory fake for tests) that satisfies it drops straight into the handlers.
type ProductStore interface {
	List(ctx context.Context, q string, limit, offset int) (Page, error)
	Get(ctx context.Context, id int64) (Product, error)
	Create(ctx context.Context, in ProductInput) (Product, error)
	Update(ctx context.Context, id int64, in ProductInput) (Product, error)
	Delete(ctx context.Context, id int64) error
	BulkCreate(ctx context.Context, items []ProductInput) (ImportResult, error)
}
