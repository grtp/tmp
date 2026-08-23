package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"

	mssql "github.com/microsoft/go-mssqldb"

	"f-tool/internal/meta"
)

func friendlySQLError(err error) string {
	var se mssql.Error
	if errors.As(err, &se) {
		switch se.Number {
		case 2627, 2601:
			return "主キー(または一意制約)が重複しています"
		case 547:
			return "参照整合性(外部キー/CHECK 制約)に違反しています"
		}
	}
	return err.Error()
}

func (s *TableStore) ApplyBatch(ctx context.Context, def *meta.TableDef, req BatchRequest) (*BatchResult, error) {
	if len(req.Inserts)+len(req.Updates)+len(req.Deletes) == 0 {
		return nil, validationf("反映する変更がありません")
	}

	if len(req.Inserts) > 0 && len(def.InsertBlockedColumns) > 0 {
		return nil, validationf("必須列(%s)が管理対象外のため、新規行を登録できません",
			strings.Join(def.InsertBlockedColumns, ", "))
	}

	db, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	result := &BatchResult{}

	for i, row := range req.Inserts {
		keys, err := s.insertOne(ctx, tx, def, i, row)
		if err != nil {
			return nil, err
		}
		result.Inserted++
		result.InsertedKeys = append(result.InsertedKeys, keys)
	}

	capture := func(op string, key map[string]any, after map[string]any) error {
		rec := ChangeRecord{Op: op, Key: key, After: after}
		if len(result.Changes) < AuditRowCap {
			before, err := s.fetchRowByKey(ctx, tx, def, key)
			if err != nil {
				return err
			}
			rec.Before = before
		} else {
			result.ChangesTruncated = true
		}
		result.Changes = append(result.Changes, rec)
		return nil
	}

	for i, u := range req.Updates {
		if err := capture("update", u.Key, u.Changes); err != nil {
			return nil, err
		}
		if err := s.updateOne(ctx, tx, def, i, u); err != nil {
			return nil, err
		}
		result.Updated++
	}
	for i, d := range req.Deletes {
		if err := capture("delete", d.Key, nil); err != nil {
			return nil, err
		}
		if err := s.deleteOne(ctx, tx, def, i, d); err != nil {
			return nil, err
		}
		result.Deleted++
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return result, nil
}

func (s *TableStore) insertOne(ctx context.Context, tx *sql.Tx, def *meta.TableDef, idx int, row map[string]any) (map[string]any, error) {
	oe := func(reason, msg string) error { return &OpError{Op: "insert", Index: idx, Reason: reason, Msg: msg} }

	for k := range row {
		if k == rowVersionKey {
			continue
		}
		c := def.Column(k)
		if c == nil {
			return nil, oe("validation", fmt.Sprintf("未知の列 %q", k))
		}
		if c.Readonly {
			return nil, oe("validation", fmt.Sprintf("列 %q は読み取り専用です", k))
		}
	}

	var cols, holders []string
	var args []any
	for _, c := range def.Columns {
		if c.Readonly {
			continue
		}
		v, present := row[c.Name]
		if !present || v == nil {
			if c.Required {
				return nil, oe("validation", fmt.Sprintf("列 %q は必須です", c.Name))
			}
			if !c.Nullable {
				continue
			}
			v = nil
		}
		coerced, err := coerceValue(&c, v)
		if err != nil {
			return nil, oe("validation", err.Error())
		}
		args = append(args, coerced)
		cols = append(cols, qi(c.Name))
		holders = append(holders, fmt.Sprintf("@p%d", len(args)))
	}
	if len(cols) == 0 {
		return nil, oe("validation", "登録する値がありません")
	}

	for _, f := range def.FixedColumns {
		if !f.AppliesOnInsert() {
			continue
		}
		c := def.FixedTarget(f.Name)
		if c == nil {
			continue
		}
		v, err := fixedValue(f, c)
		if err != nil {
			return nil, oe("validation", err.Error())
		}
		args = append(args, v)
		cols = append(cols, qi(c.Name))
		holders = append(holders, fmt.Sprintf("@p%d", len(args)))
	}

	query := fmt.Sprintf("INSERT INTO %s (%s) OUTPUT %s VALUES (%s)",
		def.QualifiedName(),
		strings.Join(cols, ", "),
		buildPKOutput(def),
		strings.Join(holders, ", "),
	)

	keyVals := make([]any, len(def.PrimaryKey))
	keyPtrs := make([]any, len(def.PrimaryKey))
	for i := range keyVals {
		keyPtrs[i] = &keyVals[i]
	}
	if err := tx.QueryRowContext(ctx, query, args...).Scan(keyPtrs...); err != nil {
		return nil, oe("constraint_violation", friendlySQLError(err))
	}
	keys := make(map[string]any, len(def.PrimaryKey))
	for i, pk := range def.PrimaryKey {
		keys[pk] = normalizeValue(keyVals[i])
	}
	return keys, nil
}

func buildPKOutput(def *meta.TableDef) string {
	parts := make([]string, 0, len(def.PrimaryKey))
	for _, pk := range def.PrimaryKey {
		if c := def.Column(pk); c != nil && c.Type == meta.TypeUUID {
			parts = append(parts, fmt.Sprintf("LOWER(CONVERT(NVARCHAR(36), INSERTED.%s)) AS %s", qi(pk), qi(pk)))
		} else {
			parts = append(parts, fmt.Sprintf("INSERTED.%s", qi(pk)))
		}
	}
	return strings.Join(parts, ", ")
}

func (s *TableStore) updateOne(ctx context.Context, tx *sql.Tx, def *meta.TableDef, idx int, u BatchUpdate) error {
	oe := func(reason, msg string) error { return &OpError{Op: "update", Index: idx, Reason: reason, Msg: msg} }

	var sets []string
	var args []any
	for _, c := range def.Columns {
		v, present := u.Changes[c.Name]
		if !present {
			continue
		}
		if c.Readonly {
			return oe("validation", fmt.Sprintf("列 %q は読み取り専用です", c.Name))
		}
		if isPK(def, c.Name) {
			return oe("validation", fmt.Sprintf("主キー列 %q は変更できません", c.Name))
		}
		if v == nil {
			if c.Required || !c.Nullable {
				return oe("validation", fmt.Sprintf("列 %q を空にはできません", c.Name))
			}
		}
		coerced, err := coerceValue(&c, v)
		if err != nil {
			return oe("validation", err.Error())
		}
		args = append(args, coerced)
		sets = append(sets, fmt.Sprintf("%s = @p%d", qi(c.Name), len(args)))
	}

	for k := range u.Changes {
		if k != rowVersionKey && def.Column(k) == nil {
			return oe("validation", fmt.Sprintf("未知の列 %q", k))
		}
	}
	if len(sets) == 0 {
		return oe("validation", "変更する値がありません")
	}

	for _, f := range def.FixedColumns {
		if !f.AppliesOnUpdate() {
			continue
		}
		c := def.FixedTarget(f.Name)
		if c == nil {
			continue
		}
		v, err := fixedValue(f, c)
		if err != nil {
			return oe("validation", err.Error())
		}
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", qi(c.Name), len(args)))
	}

	where, whereArgs, err := buildKeyWhere(def, u.Key, u.RowVersion, true, len(args))
	if err != nil {
		return oe("validation", err.Error())
	}
	args = append(args, whereArgs...)

	query := fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		def.QualifiedName(), strings.Join(sets, ", "), where)
	res, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return oe("constraint_violation", err.Error())
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return s.zeroAffected(ctx, tx, def, "update", idx, u.Key)
	}
	return nil
}

func (s *TableStore) deleteOne(ctx context.Context, tx *sql.Tx, def *meta.TableDef, idx int, d BatchDelete) error {
	oe := func(reason, msg string) error { return &OpError{Op: "delete", Index: idx, Reason: reason, Msg: msg} }

	where, whereArgs, err := buildKeyWhere(def, d.Key, d.RowVersion, true, 0)
	if err != nil {
		return oe("validation", err.Error())
	}
	query := fmt.Sprintf("DELETE FROM %s WHERE %s", def.QualifiedName(), where)
	res, err := tx.ExecContext(ctx, query, whereArgs...)
	if err != nil {
		return oe("constraint_violation", err.Error())
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return s.zeroAffected(ctx, tx, def, "delete", idx, d.Key)
	}
	return nil
}

func (s *TableStore) fetchRowByKey(ctx context.Context, tx *sql.Tx, def *meta.TableDef, key map[string]any) (map[string]any, error) {
	where, args, err := buildKeyWhere(def, key, "", false, 0)
	if err != nil {
		return nil, nil
	}
	q := fmt.Sprintf("SELECT %s FROM %s WHERE %s",
		buildSelectList(def, false), def.QualifiedName(), where)
	rows, err := tx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("fetch before row: %w", err)
	}
	defer rows.Close()
	out, err := scanRows(rows)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out[0], nil
}

func (s *TableStore) zeroAffected(ctx context.Context, tx *sql.Tx, def *meta.TableDef, op string, idx int, key map[string]any) error {

	where, args, err := buildKeyWhere(def, key, "", false, 0)
	if err != nil {
		return &OpError{Op: op, Index: idx, Reason: "validation", Msg: err.Error()}
	}
	var one int
	q := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s", def.QualifiedName(), where)
	if err := tx.QueryRowContext(ctx, q, args...).Scan(&one); err != nil {
		return fmt.Errorf("existence check: %w", err)
	}
	if one > 0 {
		return &OpError{Op: op, Index: idx, Reason: "row_version_mismatch",
			Msg: "他のユーザーが先に変更しています。再読込してやり直してください"}
	}
	return &OpError{Op: op, Index: idx, Reason: "not_found",
		Msg: "対象の行が存在しません(削除済みの可能性)"}
}

func buildKeyWhere(def *meta.TableDef, key map[string]any, rowVersion string, withRowVersion bool, argOffset int) (string, []any, error) {
	if len(key) == 0 {
		return "", nil, fmt.Errorf("key が空です")
	}
	var conds []string
	var args []any
	for _, pk := range def.PrimaryKey {
		v, ok := key[pk]
		if !ok || v == nil {
			return "", nil, fmt.Errorf("key に主キー列 %q がありません", pk)
		}
		c := def.Column(pk)
		if c == nil {
			return "", nil, fmt.Errorf("主キー列 %q の定義がありません", pk)
		}
		coerced, err := coerceValue(c, v)
		if err != nil {
			return "", nil, err
		}
		args = append(args, coerced)
		conds = append(conds, fmt.Sprintf("%s = @p%d", qi(pk), argOffset+len(args)))
	}
	if rv := def.RowVersionColumn; withRowVersion && rv != "" {
		if rowVersion == "" {
			return "", nil, fmt.Errorf("このテーブルの更新には rowVersion が必要です")
		}
		b, err := base64.StdEncoding.DecodeString(rowVersion)
		if err != nil {
			return "", nil, fmt.Errorf("rowVersion の形式が不正です")
		}
		args = append(args, b)
		conds = append(conds, fmt.Sprintf("%s = @p%d", qi(rv), argOffset+len(args)))
	}
	return strings.Join(conds, " AND "), args, nil
}

func isPK(def *meta.TableDef, name string) bool {
	for _, pk := range def.PrimaryKey {
		if pk == name {
			return true
		}
	}
	return false
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
