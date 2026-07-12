package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"tablemaint/internal/meta"
)

// rowVersionKey は行 JSON 内で rowversion を運ぶ予約キー。
// 物理列名を隠蔽し、フロントは常にこのキーで楽観ロック値を扱う。
const rowVersionKey = "$rowVersion"

// DBProvider resolves a connection id into a live pool (実体は conn.Manager)。
type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

// TableStore はメタデータ駆動の動的CRUD。実行先は def.ConnectionID が指す
// 接続(nil = 既定接続)。
//
// SQLインジェクションに対する防衛線:
//   - 識別子(テーブル名/列名)は必ず meta.TableDef 由来のみを QuoteIdent で
//     括って埋め込む。TableDef の識別子はカタログのイントロスペクション結果
//     そのもの(登録時に実在確認済み)。
//   - ユーザー入力の orderBy 等は def.Column() の存在確認を通った列名に
//     限って使う。値は全てプレースホルダ。
type TableStore struct{ dbs DBProvider }

func NewTableStore(dbs DBProvider) *TableStore { return &TableStore{dbs: dbs} }

func qi(name string) string { return meta.QuoteIdent(name) }

// ------------------------------------------------------------- ListRows

func (s *TableStore) ListRows(ctx context.Context, def *meta.TableDef, p ListParams) (*RowPage, error) {
	db, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return nil, err
	}

	where, args, err := buildWhere(def, p.Q, p.Filters)
	if err != nil {
		return nil, err
	}
	orderBy, err := buildOrderBy(def, p.OrderBy, p.Order)
	if err != nil {
		return nil, err
	}

	// 総件数(同じ WHERE)。全件カウントは大テーブルで重いので、
	// TOP (TotalCap+1) のサブクエリで「上限+1 まで」だけ数える。
	var total int
	countSQL := fmt.Sprintf(
		"SELECT COUNT(*) FROM (SELECT TOP (%d) 1 AS x FROM %s%s) AS capped",
		TotalCap+1, def.QualifiedName(), where)
	if err := db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}
	capped := total > TotalCap
	if capped {
		total = TotalCap + 1
	}

	// 本体。OFFSET/FETCH は ORDER BY 必須(buildOrderBy が常に返す)。
	query := fmt.Sprintf(
		"SELECT %s FROM %s%s%s OFFSET @p%d ROWS FETCH NEXT @p%d ROWS ONLY",
		buildSelectList(def, true), def.QualifiedName(), where, orderBy,
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
	return &RowPage{Rows: out, Total: total, TotalIsCapped: capped, Limit: p.Limit, Offset: p.Offset}, nil
}

// buildSelectList はイントロスペクションで得た列(+rowversion)を SELECT する。
//
// ドライバ差異を SQL 側で吸収する変換:
//   - uuid    -> LOWER(CONVERT(NVARCHAR(36), c)) : 文字列で統一(adguid と同形)
//   - decimal -> CONVERT(FLOAT, c) : interface{} スキャンで []byte になるのを回避。
//     表示・編集ツールとしては float64 の精度で足りる割り切り(仕様)。
//   - 対応外型(readonly な string 扱い) -> CONVERT(NVARCHAR(4000), c) で
//     文字列化を試みる(変換不能な型は NULL になる)。
func buildSelectList(def *meta.TableDef, includeRowVersion bool) string {
	parts := make([]string, 0, len(def.Columns)+1)
	for _, c := range def.Columns {
		switch {
		case c.Type == meta.TypeUUID:
			parts = append(parts, fmt.Sprintf("LOWER(CONVERT(NVARCHAR(36), %s)) AS %s", qi(c.Name), qi(c.Name)))
		case c.Type == meta.TypeDecimal:
			parts = append(parts, fmt.Sprintf("CONVERT(FLOAT, %s) AS %s", qi(c.Name), qi(c.Name)))
		case c.Type == meta.TypeString && c.Readonly && !c.Searchable:
			// 対応外型(introspect が string+readonly に落としたもの)
			parts = append(parts, fmt.Sprintf("TRY_CONVERT(NVARCHAR(4000), %s) AS %s", qi(c.Name), qi(c.Name)))
		default:
			parts = append(parts, qi(c.Name))
		}
	}
	if rv := def.RowVersionColumn; includeRowVersion && rv != "" {
		parts = append(parts, fmt.Sprintf("%s AS %s", qi(rv), qi(rowVersionKey)))
	}
	return strings.Join(parts, ", ")
}

// buildWhere は全体検索 q(文字列列の OR LIKE)と列フィルタ(AND)を組み立てる。
func buildWhere(def *meta.TableDef, q string, filters map[string]string) (string, []any, error) {
	var andConds []string
	var args []any

	if q != "" {
		var orConds []string
		pattern := "%" + escapeLike(q) + "%"
		for _, c := range def.Columns {
			if !c.Searchable {
				continue
			}
			args = append(args, pattern)
			orConds = append(orConds, fmt.Sprintf(`%s LIKE @p%d ESCAPE '\'`, qi(c.Name), len(args)))
		}
		if len(orConds) == 0 {
			// searchable 列が無いテーブルへの q は黙って無視せずエラーにする
			// (「効いていない検索」がユーザーに誤解を与えるため)。
			return "", nil, validationf("このテーブルには検索対象列がありません")
		}
		andConds = append(andConds, "("+strings.Join(orConds, " OR ")+")")
	}

	// 列フィルタ: 列名は必ず def と突合し、値は列型に合わせて解釈する。
	// map の走査順は不定だが AND 結合なので結果は同じ(プレースホルダ番号のみ変動)。
	for name, value := range filters {
		if value == "" {
			continue
		}
		c := def.Column(name)
		if c == nil {
			return "", nil, validationf("フィルタ列 %q は存在しません", name)
		}
		cond, condArgs, err := buildFilterCond(c, value, len(args))
		if err != nil {
			return "", nil, err
		}
		args = append(args, condArgs...)
		andConds = append(andConds, cond)
	}

	if len(andConds) == 0 {
		return "", nil, nil
	}
	return " WHERE " + strings.Join(andConds, " AND "), args, nil
}

// buildFilterCond は1列分のフィルタ条件を作る。
// string=部分一致 / int・decimal・uuid・bool=一致 / date・datetime=その日付の範囲。
func buildFilterCond(c *meta.Column, value string, argOffset int) (string, []any, error) {
	switch c.Type {
	case meta.TypeString:
		return fmt.Sprintf(`%s LIKE @p%d ESCAPE '\'`, qi(c.Name), argOffset+1),
			[]any{"%" + escapeLike(value) + "%"}, nil

	case meta.TypeInt:
		n, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil {
			return "", nil, validationf("列 %q のフィルタは整数を指定してください", c.Name)
		}
		return fmt.Sprintf("%s = @p%d", qi(c.Name), argOffset+1), []any{n}, nil

	case meta.TypeDecimal:
		f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return "", nil, validationf("列 %q のフィルタは数値を指定してください", c.Name)
		}
		return fmt.Sprintf("%s = @p%d", qi(c.Name), argOffset+1), []any{f}, nil

	case meta.TypeBool:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "true", "1":
			return fmt.Sprintf("%s = @p%d", qi(c.Name), argOffset+1), []any{true}, nil
		case "false", "0":
			return fmt.Sprintf("%s = @p%d", qi(c.Name), argOffset+1), []any{false}, nil
		}
		return "", nil, validationf("列 %q のフィルタは true/false を指定してください", c.Name)

	case meta.TypeUUID:
		if !uuidRe.MatchString(strings.TrimSpace(value)) {
			return "", nil, validationf("列 %q のフィルタは GUID 形式で指定してください", c.Name)
		}
		return fmt.Sprintf("%s = @p%d", qi(c.Name), argOffset+1), []any{strings.TrimSpace(value)}, nil

	case meta.TypeDate, meta.TypeDateTime:
		day, err := time.Parse("2006-01-02", strings.TrimSpace(value))
		if err != nil {
			return "", nil, validationf("列 %q のフィルタは YYYY-MM-DD 形式で指定してください", c.Name)
		}
		// datetime 列でも「その日」の範囲一致にする(時刻の完全一致は実用性がない)。
		return fmt.Sprintf("(%s >= @p%d AND %s < @p%d)",
				qi(c.Name), argOffset+1, qi(c.Name), argOffset+2),
			[]any{day, day.AddDate(0, 0, 1)}, nil

	default:
		return "", nil, validationf("列 %q はフィルタに対応していません", c.Name)
	}
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`, `[`, `\[`)
	return r.Replace(s)
}

// buildOrderBy はソート列をメタデータで検証し、常に主キーを末尾に足して
// ページングを安定させる(同値行の順序が呼び出しごとに揺れると
// ページ間で行が重複/欠落する)。
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
		if def.Column(orderBy) == nil {
			return "", validationf("並べ替え列 %q は存在しません", orderBy)
		}
		parts = append(parts, fmt.Sprintf("%s %s", qi(orderBy), dir))
	}
	for _, pk := range def.PrimaryKey {
		if pk == orderBy {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s %s", qi(pk), dir))
	}
	if len(parts) == 0 { // orderBy が唯一の PK と同名だった場合
		parts = append(parts, fmt.Sprintf("%s %s", qi(def.PrimaryKey[0]), dir))
	}
	return " ORDER BY " + strings.Join(parts, ", "), nil
}

// scanRows は列型を知らずに読む(動的テーブルのため)。
// JSON 化した際の表現:
//   - int系      -> int64 -> number
//   - CONVERT済み decimal -> float64 -> number
//   - nvarchar   -> string
//   - bit        -> bool
//   - date系     -> time.Time -> RFC3339 文字列
//   - rowversion -> []byte -> ここで base64 文字列へ(JSONの []byte 既定と同じ表現)
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
		// 残る []byte は rowversion のみの想定(uuid/decimal はSQL側で変換済み)。
		return base64.StdEncoding.EncodeToString(x)
	case time.Time:
		return x
	default:
		return v
	}
}
