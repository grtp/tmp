// coerce: リクエストの JSON 値を列の型に合わせて変換する。
// 変換規則の単体テストは coerce_test.go(バッチ処理本体とは独立に検証できる)。
package store

import (
	"fmt"
	"math"
	"strconv"
	"time"

	"f-tool/internal/meta"
)

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

// jst は固定値 now が刻む壁時計。相手方テーブルの読み手はローカル時刻
// (GETDATE() 相当)を期待するため,OS 設定(Local)に依存せず明示する。
var jst = time.FixedZone("JST", 9*3600)

// fixedValue は固定値指定(literal / now)から書き込む値を作る。
// literal は文字列で保持しているため,列型に合わせて解釈してから
// coerceValue の検証(長さ・形式)を通す。
func fixedValue(f meta.FixedColumn, c *meta.Column) (any, error) {
	if f.Kind == "now" {
		now := time.Now().In(jst)
		switch c.Type {
		case meta.TypeDate, meta.TypeDateTime:
			return now, nil
		case meta.TypeString:
			// 文字列列に現在時刻を刻む場合は ISO 8601(+09:00)で書く。
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
