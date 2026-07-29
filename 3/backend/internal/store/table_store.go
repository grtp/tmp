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

// rowVersionKey は行 JSON 内で rowversion を運ぶ予約キー。
// 物理列名を隠蔽し，フロントは常にこのキーで楽観ロック値を扱う。
const rowVersionKey = "$rowVersion"

// DBProvider resolves a connection id into a live pool (実体は conn.Manager)。
type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

// TableStore is the metadata-driven dynamic CRUD engine. 実行先は def.ConnectionID が指す
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

	// 総件数(同じ WHERE)。2026-07-23 決定: 件数カップ(10,000+)を廃止し
	// 正確な COUNT(*) を返す(カップがあると末尾ページへ到達できず，
	// 追加した行が見えない問題があった)。
	var total int
	countSQL := fmt.Sprintf(
		"SELECT COUNT(*) FROM %s%s", def.QualifiedName(), where)
	if err := db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
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

// predSpecs は def のフィルタ可能列を predicate の許可リストへ変換する。
// 対応外型(introspect が string+readonly に落としたもの)は UI 同様
// フィルタ不可として除外する。
func predSpecs(def *meta.TableDef) map[string]predicate.ColumnSpec {
	out := make(map[string]predicate.ColumnSpec, len(def.Columns))
	for _, c := range def.Columns {
		if c.Type == meta.TypeString && c.Readonly && !c.Searchable {
			continue
		}
		out[c.Name] = predicate.ColumnSpec{
			SQL:      qi(c.Name),
			Type:     predicateType(c.Type),
			Nullable: c.Nullable,
		}
	}
	return out
}

// predicateType は meta の列型を predicate 層の型へ写す。
// meta.ColumnType と predicate.Type は別々の enum で(前者はカタログの
// イントロスペクション結果,後者はフィルタ意味論),両者の文字列値が
// 現在たまたま一致しているだけ。ここを直接キャスト(predicate.Type(c.Type))
// にしていた場合,meta 側に型を追加してもコンパイルは通ってしまい,
// 未対応の値が predicate.Build まで届いて実行時に初めて気づく形になる。
// この switch を経由させることで,対応漏れは predicate.TypeInvalid を返し,
// predicate 側の default 節で「フィルタに対応していません」と安全側に
// 倒れる(不明な列を誤った意味論でフィルタすることはない)。
// meta に新しい ColumnType を足したら,このswitchにもケースを足すこと
// (table_store_test.go の TestPredicateTypeCoversAllColumnTypes が漏れを検出する)。
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

// buildWhere はチップフィルタの述語(演算子・列内OR・否定)から WHERE を
// 組み立てる。
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

// buildOrderBy はソート列をメタデータで検証し，常に主キーを末尾に足して
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
