package store

import (
	"fmt"

	"f-tool/internal/predicate"
)

type ListParams struct {
	Limit  int
	Offset int

	Preds   []predicate.Predicate
	OrderBy string
	Order   string
}

type RowPage struct {
	Rows   []map[string]any `json:"rows"`
	Total  int              `json:"total"`
	Limit  int              `json:"limit"`
	Offset int              `json:"offset"`
}

type BatchUpdate struct {
	Key        map[string]any `json:"key"`
	Changes    map[string]any `json:"changes"`
	RowVersion string         `json:"rowVersion"`
}

type BatchDelete struct {
	Key        map[string]any `json:"key"`
	RowVersion string         `json:"rowVersion"`
}

type BatchRequest struct {
	Inserts []map[string]any `json:"inserts"`
	Updates []BatchUpdate    `json:"updates"`
	Deletes []BatchDelete    `json:"deletes"`
}

type BatchResult struct {
	Inserted     int              `json:"inserted"`
	Updated      int              `json:"updated"`
	Deleted      int              `json:"deleted"`
	InsertedKeys []map[string]any `json:"insertedKeys,omitempty"`

	Changes          []ChangeRecord `json:"-"`
	ChangesTruncated bool           `json:"-"`
}

const AuditRowCap = 100

type ChangeRecord struct {
	Op     string         `json:"op"`
	Key    map[string]any `json:"key"`
	Before map[string]any `json:"before,omitempty"`
	After  map[string]any `json:"after,omitempty"`
}

type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func validationf(format string, a ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, a...)}
}

type OpError struct {
	Op     string
	Index  int
	Reason string
	Msg    string
}

func (e *OpError) Error() string {
	return fmt.Sprintf("%s[%d] %s: %s", e.Op, e.Index, e.Reason, e.Msg)
}
