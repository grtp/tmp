package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	mssql "github.com/microsoft/go-mssqldb"

	"f-tool/internal/meta"
)

// friendlySQLError は SQL Server の代表的な制約エラーを日本語化する。
// CSV 取込(まとめて保存)で重複キーが最も出やすいため，原因が一目で
// 分かるメッセージにする。その他はドライバの生メッセージのまま。
func friendlySQLError(err error) string {
	var se mssql.Error
	if errors.As(err, &se) {
		switch se.Number {
		case 2627, 2601: // PK/UNIQUE 制約違反・一意インデックス重複
			return "主キー(または一意制約)が重複しています"
		case 547: // FK/CHECK 制約違反
			return "参照整合性(外部キー/CHECK 制約)に違反しています"
		}
	}
	return err.Error()
}

// ApplyBatch は追加・更新・削除を単一トランザクションで適用する。
// 1件でも失敗すれば全体をロールバックする(部分成功なし)。
func (s *TableStore) ApplyBatch(ctx context.Context, def *meta.TableDef, req BatchRequest) (*BatchResult, error) {
	if len(req.Inserts)+len(req.Updates)+len(req.Deletes) == 0 {
		return nil, validationf("反映する変更がありません")
	}
	// 必須列が除外されているテーブルは INSERT が必ず失敗する。
	// SQL Server の生エラーを見せず，事前に日本語で拒否する(UI も無効化済み)。
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
	// update/delete は監査用に変更前の行を控えてから適用する。
	// Before の全量記録は AuditRowCap 行まで(detail の肥大防止)。
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
		cols = append(cols, qi(c.Name))
		holders = append(holders, fmt.Sprintf("@p%d", len(args)))
	}
	if len(cols) == 0 {
		return nil, oe("validation", "登録する値がありません")
	}

	// 固定値列(applyOn=insert/both)をサーバー側で自動セットする。
	// 固定値列は Readonly 扱いのため上のループ/クライアント入力とは重複しない。
	for _, f := range def.FixedColumns {
		if !f.AppliesOnInsert() {
			continue
		}
		c := def.Column(f.Name)
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

	// IDENTITY 等で採番された主キーを OUTPUT で回収し，フロントの
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
	// 未知列の混入検査($rowVersion は無視)
	for k := range u.Changes {
		if k != rowVersionKey && def.Column(k) == nil {
			return oe("validation", fmt.Sprintf("未知の列 %q", k))
		}
	}
	if len(sets) == 0 {
		return oe("validation", "変更する値がありません")
	}

	// 固定値列(applyOn=update/both)をサーバー側で自動セットする
	// (updated_at 等の監査列を想定。クライアントの指定値は受け付けない)。
	for _, f := range def.FixedColumns {
		if !f.AppliesOnUpdate() {
			continue
		}
		c := def.Column(f.Name)
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

// fetchRowByKey は監査用に変更前の1行を読む(hidden 列は def に無いので
// 構造的に含まれない)。行が見つからない場合は nil を返し，続く
// update/delete 側の not_found 判定に委ねる。キー不備も同様に委ねる。
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

// zeroAffected は影響行数 0 の原因を切り分ける:
// 行が存在する -> rowversion 不一致(他者が先に更新した) / 存在しない -> not_found。
func (s *TableStore) zeroAffected(ctx context.Context, tx *sql.Tx, def *meta.TableDef, op string, idx int, key map[string]any) error {
	// 存在確認は主キーのみで行う(rowversion は照合しない)。
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

// buildKeyWhere は主キー(+rowversion)の WHERE 句を組み立てる。
// rowversion 列を持たないテーブルでは主キーのみ(last-write-wins)。
// withRowVersion=false は存在確認用(主キーのみで照合)。
// argOffset は先行するプレースホルダ数(@pN の続き番号にするため)。
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
		return int64(f), nil

	case meta.TypeDecimal:
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("列 %q: 数値を指定してください", c.Name)
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

// fixedValue は固定値指定(literal / now)から書き込む値を作る。
// literal は文字列で保持しているため，列型に合わせて解釈してから
// coerceValue の検証(長さ・形式)を通す。
func fixedValue(f meta.FixedColumn, c *meta.Column) (any, error) {
	if f.Kind == "now" {
		now := time.Now().UTC()
		switch c.Type {
		case meta.TypeDate, meta.TypeDateTime:
			return now, nil
		case meta.TypeString:
			// 文字列列に現在時刻を刻む場合は ISO 8601(UTC)で書く。
			return now.Format(time.RFC3339), nil
		default:
			return nil, fmt.Errorf("固定値列 %q: 現在時刻は日付/日時/文字列型の列にのみ指定できます", c.Name)
		}
	}
	var v any = f.Value
	switch c.Type {
	case meta.TypeInt, meta.TypeDecimal:
		n, err := strconv.ParseFloat(f.Value, 64)
		if err != nil {
			return nil, fmt.Errorf("固定値列 %q: 数値として解釈できません(%s)", c.Name, f.Value)
		}
		v = n
	case meta.TypeBool:
		b, err := strconv.ParseBool(f.Value)
		if err != nil {
			return nil, fmt.Errorf("固定値列 %q: true/false として解釈できません(%s)", c.Name, f.Value)
		}
		v = b
	}
	return coerceValue(c, v)
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
