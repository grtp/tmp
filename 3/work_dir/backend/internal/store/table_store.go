package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"tablemaint/internal/meta"
)

// rowVersionKey は行 JSON 内で rowversion を運ぶ予約キー。
// 物理列名を隠蔽し、フロントは常にこのキーで楽観ロック値を扱う。
const rowVersionKey = "$rowVersion"

// TableStore はメタデータ駆動の動的CRUD。
//
// SQLインジェクションに対する防衛線:
//   - 識別子(テーブル名/列名)は必ず meta.TableDef 由来のみを QuoteIdent で
//     括って埋め込む。TableDef の識別子はカタログのイントロスペクション結果
//     そのもの(登録時に実在確認済み)。
//   - ユーザー入力の orderBy 等は def.Column() の存在確認を通った列名に
//     限って使う。値は全てプレースホルダ。
type TableStore struct{ db *sql.DB }

func NewTableStore(db *sql.DB) *TableStore { return &TableStore{db: db} }

func qi(name string) string { return meta.QuoteIdent(name) }

// ------------------------------------------------------------- ListRows

func (s *TableStore) ListRows(ctx context.Context, def *meta.TableDef, p ListParams) (*RowPage, error) {
	where, args, err := buildWhere(def, p.Q)
	if err != nil {
		return nil, err
	}
	orderBy, err := buildOrderBy(def, p.OrderBy, p.Order)
	if err != nil {
		return nil, err
	}

	// 総件数(同じ WHERE)
	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", def.QualifiedName(), where)
	if err := s.db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}

	// 本体。OFFSET/FETCH は ORDER BY 必須(buildOrderBy が常に返す)。
	query := fmt.Sprintf(
		"SELECT %s FROM %s%s%s OFFSET @p%d ROWS FETCH NEXT @p%d ROWS ONLY",
		buildSelectList(def), def.QualifiedName(), where, orderBy,
		len(args)+1, len(args)+2,
	)
	args = append(args, p.Offset, p.Limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
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

// buildSelectList はイントロスペクションで得た列(+rowversion)を SELECT する。
//
// ドライバ差異を SQL 側で吸収する変換:
//   - uuid    -> LOWER(CONVERT(NVARCHAR(36), c)) : 文字列で統一(adguid と同形)
//   - decimal -> CONVERT(FLOAT, c) : interface{} スキャンで []byte になるのを回避。
//     表示・編集ツールとしては float64 の精度で足りる割り切り(仕様)。
//   - 対応外型(readonly な string 扱い) -> CONVERT(NVARCHAR(4000), c) で
//     文字列化を試みる(変換不能な型は NULL になる)。
func buildSelectList(def *meta.TableDef) string {
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
	if rv := def.RowVersionColumn; rv != "" {
		parts = append(parts, fmt.Sprintf("%s AS %s", qi(rv), qi(rowVersionKey)))
	}
	return strings.Join(parts, ", ")
}

// buildWhere は文字列型(searchable)列への部分一致検索を組み立てる。
func buildWhere(def *meta.TableDef, q string) (string, []any, error) {
	if q == "" {
		return "", nil, nil
	}
	var conds []string
	var args []any
	pattern := "%" + escapeLike(q) + "%"
	for _, c := range def.Columns {
		if !c.Searchable {
			continue
		}
		args = append(args, pattern)
		conds = append(conds, fmt.Sprintf(`%s LIKE @p%d ESCAPE '\'`, qi(c.Name), len(args)))
	}
	if len(conds) == 0 {
		// searchable 列が無いテーブルへの q は黙って無視せずエラーにする
		// (「効いていない検索」がユーザーに誤解を与えるため)。
		return "", nil, validationf("このテーブルには検索対象列がありません")
	}
	return " WHERE (" + strings.Join(conds, " OR ") + ")", args, nil
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
