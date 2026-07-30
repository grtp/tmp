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

// ValidatePreds checks the predicate filter only(列の存在・値の型)。
// ストリーム系ハンドラがヘッダー送信前に 400 を返すために使う。
func ValidatePreds(def *meta.TableDef, preds []predicate.Predicate) (string, []any, error) {
	return buildWhere(def, preds)
}

// ExportCSV は述語フィルタ一致の全行を CSV でストリーム出力する。
// 列は def.Columns 全列(rowversion は含めない),ヘッダー行 = 列名。
// セル表現: NULL=空文字 / bool=true・false / date=YYYY-MM-DD / datetime=RFC3339。
// 返り値は出力した行数(監査記録用)。
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
	cw.UseCRLF = true // Excel での互換性(取込側は LF/CRLF どちらも読む)

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

// csvCell は列型に応じてセルを文字列化する(JSON API と同じ値観)。
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
		// uuid/decimal は SELECT 側で変換済みのため通常は到達しない。
		return string(x)
	default:
		return fmt.Sprint(x)
	}
}
