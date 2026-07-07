package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"tablemaint/meta"
)

// ApplyBatch は追加・更新・削除を単一トランザクションで適用する。
// 1件でも失敗すれば全体をロールバックする(部分成功なし)。
// Railway 的に言えば、途中のどの失敗も同じ「全部無かったことになる」
// 線路に合流する。
func (s *TableStore) ApplyBatch(ctx context.Context, def *meta.TableDef, req BatchRequest) (*BatchResult, error) {
	// ---- guards(操作種別の禁止) ----
	if def.Guards.DenyInsert && len(req.Inserts) > 0 {
		return nil, &ForbiddenError{Msg: "このテーブルへの行追加は許可されていません"}
	}
	if def.Guards.DenyDelete && len(req.Deletes) > 0 {
		return nil, &ForbiddenError{Msg: "このテーブルの行削除は許可されていません"}
	}
	if len(req.Inserts)+len(req.Updates)+len(req.Deletes) == 0 {
		return nil, validationf("反映する変更がありません")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() // Commit 成功後の Rollback は no-op

	result := &BatchResult{}

	for i, row := range req.Inserts {
		keys, err := s.insertOne(ctx, tx, def, i, row)
		if err != nil {
			return nil, err
		}
		result.Inserted++
		result.InsertedKeys = append(result.InsertedKeys, keys)
	}
	for i, u := range req.Updates {
		if err := s.updateOne(ctx, tx, def, i, u); err != nil {
			return nil, err
		}
		result.Updated++
	}
	for i, d := range req.Deletes {
		if err := s.deleteOne(ctx, tx, def, i, d); err != nil {
			return nil, err
		}
		result.Deleted++
	}

	// ---- guards(事後条件): lastRowMatching ----
	// 全操作適用後の状態で検査する方式。個々の操作を静的に解析するより
	// 単純で、複合的な操作(該当行を消しつつ別行を昇格、等)も正しく扱える。
	for _, g := range def.Guards.Protect {
		var n int
		q := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE [%s] = @p1", def.QualifiedName(), g.Column)
		if err := tx.QueryRowContext(ctx, q, g.Value).Scan(&n); err != nil {
			return nil, fmt.Errorf("protect check: %w", err)
		}
		if n == 0 {
			return nil, &ProtectError{Msg: fmt.Sprintf(
				"%s = %s の最後の行を無くす変更は適用できません", g.Column, g.Value)}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return result, nil
}

// ------------------------------------------------------------- insert

func (s *TableStore) insertOne(ctx context.Context, tx *sql.Tx, def *meta.TableDef, idx int, row map[string]any) (map[string]any, error) {
	oe := func(reason, msg string) error { return &OpError{Op: "insert", Index: idx, Reason: reason, Msg: msg} }

	// 入力キーの検証(未知列・readonly 列の混入を拒否)
	for k := range row {
		if k == rowVersionKey {
			continue // 予約キーは黙って無視
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
				continue // NOT NULL かつ未指定 -> DB デフォルトに委ねる
			}
			v = nil
		}
		coerced, err := coerceValue(&c, v)
		if err != nil {
			return nil, oe("validation", err.Error())
		}
		args = append(args, coerced)
		cols = append(cols, fmt.Sprintf("[%s]", c.Name))
		holders = append(holders, fmt.Sprintf("@p%d", len(args)))
	}
	if len(cols) == 0 {
		return nil, oe("validation", "登録する値がありません")
	}

	// IDENTITY 等で採番された主キーを OUTPUT で回収し、フロントの
	// バッファ更新(insertedKeys)に返す。
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
		return nil, oe("constraint_violation", err.Error())
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
			parts = append(parts, fmt.Sprintf("LOWER(CONVERT(NVARCHAR(36), INSERTED.[%s])) AS [%s]", pk, pk))
		} else {
			parts = append(parts, fmt.Sprintf("INSERTED.[%s]", pk))
		}
	}
	return strings.Join(parts, ", ")
}

// ------------------------------------------------------------- update

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
		sets = append(sets, fmt.Sprintf("[%s] = @p%d", c.Name, len(args)))
	}
	// 未知列の混入検査($rowVersion は無視)
	for k := range u.Changes {
		if k != rowVersionKey && def.Column(k) == nil {
			return oe("validation", fmt.Sprintf("未知の列 %q", k))
		}
	}
	if len(sets) == 0 {
		return oe("validation", "変更する値がありません")
	}

	where, whereArgs, err := buildKeyWhere(def, u.Key, u.RowVersion, len(args))
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

// ------------------------------------------------------------- delete

func (s *TableStore) deleteOne(ctx context.Context, tx *sql.Tx, def *meta.TableDef, idx int, d BatchDelete) error {
	oe := func(reason, msg string) error { return &OpError{Op: "delete", Index: idx, Reason: reason, Msg: msg} }

	where, whereArgs, err := buildKeyWhere(def, d.Key, d.RowVersion, 0)
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

// zeroAffected は影響行数 0 の原因を切り分ける:
// 行が存在する -> rowversion 不一致(他者が先に更新した) / 存在しない -> not_found。
func (s *TableStore) zeroAffected(ctx context.Context, tx *sql.Tx, def *meta.TableDef, op string, idx int, key map[string]any) error {
	where, args, err := buildKeyWhere(def, key, "", 0)
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

// buildKeyWhere は主キー(+rowversion)の WHERE 句を組み立てる。
// argOffset は先行するプレースホルダ数(@pN の続き番号にするため)。
func buildKeyWhere(def *meta.TableDef, key map[string]any, rowVersion string, argOffset int) (string, []any, error) {
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
		coerced, err := coerceValue(c, v)
		if err != nil {
			return "", nil, err
		}
		args = append(args, coerced)
		conds = append(conds, fmt.Sprintf("[%s] = @p%d", pk, argOffset+len(args)))
	}
	if rv := def.RowVersionColumn; rv != "" {
		if rowVersion == "" {
			return "", nil, fmt.Errorf("このテーブルの更新には rowVersion が必要です")
		}
		b, err := base64.StdEncoding.DecodeString(rowVersion)
		if err != nil {
			return "", nil, fmt.Errorf("rowVersion の形式が不正です")
		}
		args = append(args, b)
		conds = append(conds, fmt.Sprintf("[%s] = @p%d", rv, argOffset+len(args)))
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

// ------------------------------------------------------- 値の型変換

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// coerceValue は JSON 由来の値(float64/string/bool/nil)を列型に合わせて
// SQL パラメータ値へ変換する。フロントの入力コントロールと対になる。
func coerceValue(c *meta.Column, v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	switch c.Type {
	case meta.TypeInt:
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("列 %q: 整数を指定してください", c.Name)
		}
		if f != math.Trunc(f) {
			return nil, fmt.Errorf("列 %q: 整数を指定してください", c.Name)
		}
		if err := checkRange(c, f); err != nil {
			return nil, err
		}
		return int64(f), nil

	case meta.TypeDecimal:
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("列 %q: 数値を指定してください", c.Name)
		}
		if err := checkRange(c, f); err != nil {
			return nil, err
		}
		return f, nil

	case meta.TypeBool:
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("列 %q: true/false を指定してください", c.Name)
		}
		return b, nil

	case meta.TypeString:
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("列 %q: 文字列を指定してください", c.Name)
		}
		if c.MaxLength > 0 && len([]rune(s)) > c.MaxLength {
			return nil, fmt.Errorf("列 %q: %d 文字以内で指定してください", c.Name, c.MaxLength)
		}
		if len(c.Enum) > 0 && !containsStr(c.Enum, s) {
			return nil, fmt.Errorf("列 %q: %v のいずれかを指定してください", c.Name, c.Enum)
		}
		return s, nil

	case meta.TypeUUID:
		s, ok := v.(string)
		if !ok || !uuidRe.MatchString(s) {
			return nil, fmt.Errorf("列 %q: GUID 形式で指定してください", c.Name)
		}
		return s, nil

	case meta.TypeDate:
		return parseTime(c.Name, v, "2006-01-02")

	case meta.TypeDateTime:
		return parseTime(c.Name, v,
			time.RFC3339, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02")

	default:
		return nil, fmt.Errorf("列 %q: 未対応の型 %q", c.Name, c.Type)
	}
}

func parseTime(col string, v any, layouts ...string) (any, error) {
	s, ok := v.(string)
	if !ok {
		return nil, fmt.Errorf("列 %q: 日付を指定してください", col)
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, nil
		}
	}
	return nil, fmt.Errorf("列 %q: 日付の形式が不正です(%s)", col, s)
}

func checkRange(c *meta.Column, f float64) error {
	if c.Min != nil && f < *c.Min {
		return fmt.Errorf("列 %q: %v 以上で指定してください", c.Name, *c.Min)
	}
	if c.Max != nil && f > *c.Max {
		return fmt.Errorf("列 %q: %v 以下で指定してください", c.Name, *c.Max)
	}
	return nil
}

func containsStr(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
