package store

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"time"

	"f-tool/internal/meta"
	"f-tool/internal/predicate"
)

func ValidatePreds(def *meta.TableDef, preds []predicate.Predicate) (string, []any, error) {
	return buildWhere(def, preds)
}

func (s *TableStore) ExportCSV(ctx context.Context, def *meta.TableDef, preds []predicate.Predicate, w io.Writer) (int, error) {
	db, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return 0, err
	}

	where, args, err := buildWhere(def, preds)
	if err != nil {
		return 0, err
	}
	orderBy, err := buildOrderBy(def, "", "")
	if err != nil {
		return 0, err
	}

	query := fmt.Sprintf("SELECT %s FROM %s%s%s",
		buildSelectList(def, false), def.QualifiedName(), where, orderBy)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("export select: %w", err)
	}
	defer rows.Close()

	cw := csv.NewWriter(w)
	cw.UseCRLF = true

	header := make([]string, len(def.Columns))
	for i, c := range def.Columns {
		header[i] = c.Name
	}
	if err := cw.Write(header); err != nil {
		return 0, err
	}

	n := 0
	vals := make([]any, len(def.Columns))
	ptrs := make([]any, len(def.Columns))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	record := make([]string, len(def.Columns))
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return n, err
		}
		for i := range vals {
			record[i] = csvCell(&def.Columns[i], vals[i])
		}
		if err := cw.Write(record); err != nil {
			return n, err
		}
		n++
	}
	if err := rows.Err(); err != nil {
		return n, err
	}
	cw.Flush()
	return n, cw.Error()
}

func csvCell(c *meta.Column, v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case time.Time:
		if c.Type == meta.TypeDate {
			return x.Format("2006-01-02")
		}
		return x.Format(time.RFC3339)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return strconv.FormatFloat(x, 'g', -1, 64)
	case string:
		return x
	case []byte:

		return string(x)
	default:
		return fmt.Sprint(x)
	}
}
