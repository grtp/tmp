package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"f-tool/internal/meta"
	"f-tool/internal/predicate"
)

const rowVersionKey = "$rowVersion"

type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

type TableStore struct{ dbs DBProvider }

func NewTableStore(dbs DBProvider) *TableStore { return &TableStore{dbs: dbs} }

func qi(name string) string { return meta.QuoteIdent(name) }

func (s *TableStore) ListRows(ctx context.Context, def *meta.TableDef, p ListParams) (*RowPage, error) {
	db, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return nil, err
	}

	where, args, err := buildWhere(def, p.Preds)
	if err != nil {
		return nil, err
	}
	orderBy, err := buildOrderBy(def, p.OrderBy, p.Order)
	if err != nil {
		return nil, err
	}

	var total int
	countSQL := fmt.Sprintf(
		"SELECT COUNT(*) FROM %s%s", buildFrom(def), where)
	if err := db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}

	query := fmt.Sprintf(
		"SELECT %s FROM %s%s%s OFFSET @p%d ROWS FETCH NEXT @p%d ROWS ONLY",
		buildListSelect(def, true), buildFrom(def), where, orderBy,
		len(args)+1, len(args)+2,
	)
	args = append(args, p.Offset, p.Limit)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	defer rows.Close()

	out, err := scanRows(rows)
	if err != nil {
		return nil, err
	}
	return &RowPage{Rows: out, Total: total, Limit: p.Limit, Offset: p.Offset}, nil
}

func buildSelectList(def *meta.TableDef, includeRowVersion bool) string {
	parts := make([]string, 0, len(def.Columns)+1)
	for i := range def.Columns {
		c := &def.Columns[i]
		parts = append(parts, colSelect(c, qi(c.Name), qi(c.Name)))
	}
	if rv := def.RowVersionColumn; includeRowVersion && rv != "" {
		parts = append(parts, fmt.Sprintf("%s AS %s", qi(rv), qi(rowVersionKey)))
	}
	return strings.Join(parts, ", ")
}

func predSpecs(def *meta.TableDef) map[string]predicate.ColumnSpec {
	out := make(map[string]predicate.ColumnSpec, len(def.Columns)+len(def.DerivedColumns))
	for i := range def.Columns {
		c := &def.Columns[i]
		if isUnsupported(c) {
			continue
		}
		out[c.Name] = predicate.ColumnSpec{
			SQL:      baseRef(c.Name),
			Type:     predicateType(c.Type),
			Nullable: c.Nullable,
		}
	}
	for i := range def.DerivedColumns {
		c := &def.DerivedColumns[i]
		if isUnsupported(c) {
			continue
		}
		out[c.Name] = predicate.ColumnSpec{
			SQL:      derivedRef(c),
			Type:     predicateType(c.Type),
			Nullable: true,
		}
	}
	return out
}

func predicateType(t meta.ColumnType) predicate.Type {
	switch t {
	case meta.TypeString:
		return predicate.TypeString
	case meta.TypeInt:
		return predicate.TypeInt
	case meta.TypeDecimal:
		return predicate.TypeDecimal
	case meta.TypeBool:
		return predicate.TypeBool
	case meta.TypeDate:
		return predicate.TypeDate
	case meta.TypeDateTime:
		return predicate.TypeDateTime
	case meta.TypeUUID:
		return predicate.TypeUUID
	default:
		return predicate.TypeInvalid
	}
}

func buildWhere(def *meta.TableDef, preds []predicate.Predicate) (string, []any, error) {
	if len(preds) == 0 {
		return "", nil, nil
	}
	conds, args, err := predicate.Build(predSpecs(def), preds, 0)
	if err != nil {
		var ve *predicate.ValidationError
		if errors.As(err, &ve) {
			return "", nil, &ValidationError{Msg: ve.Msg}
		}
		return "", nil, err
	}
	return " WHERE " + strings.Join(conds, " AND "), args, nil
}

func buildOrderBy(def *meta.TableDef, orderBy, order string) (string, error) {
	dir := "ASC"
	switch order {
	case "", "asc":
	case "desc":
		dir = "DESC"
	default:
		return "", validationf("order は asc か desc を指定してください")
	}

	var parts []string
	if orderBy != "" {
		switch {
		case def.Column(orderBy) != nil:
			parts = append(parts, fmt.Sprintf("%s %s", baseRef(orderBy), dir))
		case def.Derived(orderBy) != nil:
			parts = append(parts, fmt.Sprintf("%s %s", derivedRef(def.Derived(orderBy)), dir))
		default:
			return "", validationf("並べ替え列 %q は存在しません", orderBy)
		}
	}
	for _, pk := range def.PrimaryKey {
		if pk == orderBy {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s %s", baseRef(pk), dir))
	}
	if len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%s %s", baseRef(def.PrimaryKey[0]), dir))
	}
	return " ORDER BY " + strings.Join(parts, ", "), nil
}

func scanRows(rows *sql.Rows) ([]map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, name := range cols {
			m[name] = normalizeValue(vals[i])
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func normalizeValue(v any) any {
	switch x := v.(type) {
	case []byte:

		return base64.StdEncoding.EncodeToString(x)
	case time.Time:
		return x
	default:
		return v
	}
}
