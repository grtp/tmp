package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"f-tool/internal/meta"
	"f-tool/internal/predicate"
)

const baseAlias = "t"

func derivedRef(c *meta.Column) string {
	return fmt.Sprintf("lk%d.%s", c.LookupIndex, qi(c.RefName))
}

func baseRef(name string) string { return baseAlias + "." + qi(name) }

func isUnsupported(c *meta.Column) bool {
	return c.Unsupported || (c.Type == meta.TypeString && c.Readonly && !c.Searchable)
}

func colSelect(c *meta.Column, ref, as string) string {
	switch {
	case c.Type == meta.TypeUUID:
		return fmt.Sprintf("LOWER(CONVERT(NVARCHAR(36), %s)) AS %s", ref, as)
	case c.Type == meta.TypeDecimal:
		return fmt.Sprintf("CONVERT(FLOAT, %s) AS %s", ref, as)
	case isUnsupported(c):
		return fmt.Sprintf("TRY_CONVERT(NVARCHAR(4000), %s) AS %s", ref, as)
	case ref == as:
		return ref
	default:
		return fmt.Sprintf("%s AS %s", ref, as)
	}
}

func buildFrom(def *meta.TableDef) string {
	var b strings.Builder
	b.WriteString(def.QualifiedName())
	b.WriteString(" AS ")
	b.WriteString(baseAlias)
	for i := range def.Lookups {
		l := &def.Lookups[i]
		b.WriteString(" LEFT JOIN ")
		b.WriteString(l.QualifiedRef())
		b.WriteString(" AS ")
		b.WriteString(l.Alias())
		b.WriteString(" ON ")
		for j := range l.Columns {
			if j > 0 {
				b.WriteString(" AND ")
			}
			fmt.Fprintf(&b, "%s = %s.%s", baseRef(l.Columns[j]), l.Alias(), qi(l.RefKey[j]))
		}
	}
	return b.String()
}

func buildListSelect(def *meta.TableDef, includeRowVersion bool) string {
	parts := make([]string, 0, len(def.Columns)+len(def.DerivedColumns)+1)
	for i := range def.Columns {
		c := &def.Columns[i]
		parts = append(parts, colSelect(c, baseRef(c.Name), qi(c.Name)))
	}
	for i := range def.DerivedColumns {
		c := &def.DerivedColumns[i]
		parts = append(parts, colSelect(c, derivedRef(c), qi(c.Name)))
	}
	if rv := def.RowVersionColumn; includeRowVersion && rv != "" {
		parts = append(parts, fmt.Sprintf("%s AS %s", baseRef(rv), qi(rowVersionKey)))
	}
	return strings.Join(parts, ", ")
}

type LookupOptionsParams struct {
	Q string

	Key []string

	Limit int
}

const (
	lookupOptionsDefaultLimit = 50
	lookupOptionsMaxLimit     = 200
)

func (s *TableStore) ListLookupOptions(ctx context.Context, def *meta.TableDef, index int, p LookupOptionsParams) ([]map[string]any, error) {
	l := def.Lookup(index)
	if l == nil {
		return nil, validationf("参照表示 %d は存在しません", index)
	}
	limit := p.Limit
	if limit <= 0 {
		limit = lookupOptionsDefaultLimit
	}
	if limit > lookupOptionsMaxLimit {
		return nil, validationf("limit は 1〜%d で指定してください", lookupOptionsMaxLimit)
	}

	cols := make([]*meta.Column, 0, len(l.RefKeyColumns)+len(l.Display))
	seen := map[string]struct{}{}
	for i := range l.RefKeyColumns {
		c := &l.RefKeyColumns[i]
		cols = append(cols, c)
		seen[strings.ToLower(c.Name)] = struct{}{}
	}
	for i := range l.Display {
		c := &l.Display[i]
		if _, dup := seen[strings.ToLower(c.RefName)]; dup {
			continue
		}
		seen[strings.ToLower(c.RefName)] = struct{}{}
		cols = append(cols, c)
	}
	selects := make([]string, 0, len(cols))
	specs := make(map[string]predicate.ColumnSpec, len(cols))
	for _, c := range cols {
		name := refColName(c)
		selects = append(selects, colSelect(c, qi(name), qi(name)))
		if !isUnsupported(c) {
			specs[name] = predicate.ColumnSpec{SQL: qi(name), Type: predicateType(c.Type), Nullable: c.Nullable}
		}
	}

	var conds []string
	var args []any
	switch {
	case len(p.Key) > 0:
		if len(p.Key) != len(l.RefKey) {
			return nil, validationf("key は参照先のキー列数(%d)と同じ数で指定してください", len(l.RefKey))
		}
		preds := make([]predicate.Predicate, 0, len(l.RefKey))
		for i, name := range l.RefKey {
			preds = append(preds, predicate.Predicate{Column: name, Op: predicate.OpEq, Values: []string{p.Key[i]}})
		}
		var err error
		conds, args, err = predicate.Build(specs, preds, 0)
		if err != nil {
			var ve *predicate.ValidationError
			if errors.As(err, &ve) {
				return nil, &ValidationError{Msg: ve.Msg}
			}
			return nil, err
		}
	case strings.TrimSpace(p.Q) != "":
		conds, args = lookupSearchWhere(cols, specs, strings.TrimSpace(p.Q))
		if len(conds) == 0 {

			return []map[string]any{}, nil
		}
	}

	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	order := make([]string, 0, len(l.RefKey))
	for _, k := range l.RefKey {
		order = append(order, qi(k))
	}
	query := fmt.Sprintf("SELECT %s FROM %s%s ORDER BY %s OFFSET 0 ROWS FETCH NEXT @p%d ROWS ONLY",
		strings.Join(selects, ", "), l.QualifiedRef(), where, strings.Join(order, ", "), len(args)+1)
	args = append(args, limit)

	db, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("lookup options: %w", err)
	}
	defer rows.Close()
	return scanRows(rows)
}

func refColName(c *meta.Column) string {
	if c.Derived {
		return c.RefName
	}
	return c.Name
}

func lookupSearchWhere(cols []*meta.Column, specs map[string]predicate.ColumnSpec, q string) ([]string, []any) {
	var ors []string
	var args []any
	for _, c := range cols {
		name := refColName(c)
		spec, ok := specs[name]
		if !ok {
			continue
		}
		op := predicate.OpEq
		if c.Type == meta.TypeString {
			op = predicate.OpContains
		}
		conds, a, err := predicate.Build(map[string]predicate.ColumnSpec{name: spec},
			[]predicate.Predicate{{Column: name, Op: op, Values: []string{q}}}, len(args))
		if err != nil || len(conds) == 0 {
			continue
		}
		ors = append(ors, conds[0])
		args = append(args, a...)
	}
	if len(ors) == 0 {
		return nil, nil
	}
	return []string{"(" + strings.Join(ors, " OR ") + ")"}, args
}
