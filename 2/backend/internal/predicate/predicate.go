// Package predicate は「述語配列 → SQL WHERE 条件」の共通変換器。
// テーブルメンテ(動的テーブル)・操作履歴・ユーザー一覧の3系統が
// 同じ述語モデルでフィルタできるよう,列の許可リスト(ColumnSpec)と
// 値の型検証をここに集約する。
//
// SQL インジェクションに対する防衛線:
//   - 列の SQL 表現(識別子/式)は呼び出し側が ColumnSpec.SQL に
//     検証済みのものだけを登録する(述語の Column はそのキー照合のみ)。
//   - 値は全てプレースホルダ(@pN)。
package predicate

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Type は述語の値解釈を決める列型(meta.ColumnType と同じ語彙+enum)。
type Type string

const (
	TypeString   Type = "string"
	TypeInt      Type = "int"
	TypeDecimal  Type = "decimal"
	TypeBool     Type = "bool"
	TypeDate     Type = "date"
	TypeDateTime Type = "datetime"
	TypeUUID     Type = "uuid"
	// TypeEnum は固定候補からの選択(操作履歴の result 等)。値は Enum と照合。
	TypeEnum Type = "enum"
)

// Predicate は1つのフィルタ条件。Values が複数なら列内 OR(IN 相当)。
type Predicate struct {
	Column string   `json:"column"`
	Op     string   `json:"op"`
	Values []string `json:"values"`
	Negate bool     `json:"negate,omitempty"`
}

// 演算子。型ごとの対応は buildOne を参照。
const (
	OpEq       = "eq"       // 一致(複数値は OR)。date/datetime は「その日」の範囲
	OpContains = "contains" // 部分一致(string のみ。複数値は OR)
	OpGt       = "gt"
	OpGte      = "gte"
	OpLt       = "lt"
	OpLte      = "lte"
	OpRange    = "range" // 値2つ [min, max](両端含む。日付は日単位)
)

// ColumnSpec はフィルタ可能列の定義(許可リストの1エントリ)。
type ColumnSpec struct {
	// SQL は WHERE に埋め込む列の SQL 表現。呼び出し側が QuoteIdent 済み
	// 識別子または固定の式だけを渡す(ユーザー入力を入れてはならない)。
	SQL      string
	Type     Type
	Nullable bool
	// Enum は TypeEnum の許容値(それ以外の型では無視)。
	Enum []string
	// DayOffsetMinutes は日付値の「1日」の境界をずらす分数。
	// 列が UTC 保存・表示がローカル(例: JST=540)の場合に,ユーザーの
	// 感覚どおりの日単位フィルタにする(JST の 7/1 = UTC 6/30 15:00〜)。
	DayOffsetMinutes int
}

// ValidationError は述語の形式・値の検証エラー(HTTP 400 に対応させる)。
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func errf(format string, a ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, a...)}
}

// 述語数・値数の上限。UI 操作では到達しない値で,異常リクエストによる
// 巨大 WHERE(プレースホルダ枯渇・プラン悪化)を防ぐ。
const (
	MaxPredicates = 20
	MaxValues     = 20
)

// ParseParam はクエリパラメータ(JSON 配列文字列)を述語配列に変換する。
// 空文字は「述語なし」。
func ParseParam(raw string) ([]Predicate, error) {
	if raw == "" {
		return nil, nil
	}
	var preds []Predicate
	if err := json.Unmarshal([]byte(raw), &preds); err != nil {
		return nil, errf("preds の形式が不正です(JSON 配列)")
	}
	if len(preds) > MaxPredicates {
		return nil, errf("フィルタ条件は %d 件までです", MaxPredicates)
	}
	for _, p := range preds {
		if len(p.Values) > MaxValues {
			return nil, errf("フィルタ列 %q の値は %d 件までです", p.Column, MaxValues)
		}
	}
	return preds, nil
}

// Build は述語配列を AND 結合前提の条件片リストへ変換する。
// プレースホルダは @p(argOffset+1) から採番する。
func Build(cols map[string]ColumnSpec, preds []Predicate, argOffset int) ([]string, []any, error) {
	var conds []string
	var args []any
	for _, p := range preds {
		spec, ok := cols[p.Column]
		if !ok {
			return nil, nil, errf("フィルタ列 %q は存在しないかフィルタに対応していません", p.Column)
		}
		cond, condArgs, err := buildOne(spec, p, argOffset+len(args))
		if err != nil {
			return nil, nil, err
		}
		if p.Negate {
			// 否定は「一致しない行」に NULL 行も含める(「test を含まない」に
			// 空欄行が入らないと直感に反するため)。
			if spec.Nullable {
				cond = fmt.Sprintf("(NOT %s OR %s IS NULL)", cond, spec.SQL)
			} else {
				cond = fmt.Sprintf("(NOT %s)", cond)
			}
		}
		conds = append(conds, cond)
		args = append(args, condArgs...)
	}
	return conds, args, nil
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// buildOne は1述語分の条件を作る。返す条件は必ず括弧で自己完結させる
// (呼び出し側の NOT/AND 結合で優先順位が壊れないように)。
func buildOne(spec ColumnSpec, p Predicate, argOffset int) (string, []any, error) {
	if len(p.Values) == 0 {
		return "", nil, errf("フィルタ列 %q: 値を指定してください", p.Column)
	}

	switch p.Op {
	case OpEq:
		return buildEq(spec, p, argOffset)

	case OpContains:
		if spec.Type != TypeString {
			return "", nil, errf("フィルタ列 %q: 部分一致は文字列列のみ指定できます", p.Column)
		}
		var ors []string
		var args []any
		for _, v := range p.Values {
			args = append(args, "%"+escapeLike(v)+"%")
			ors = append(ors, fmt.Sprintf(`%s LIKE @p%d ESCAPE '\'`, spec.SQL, argOffset+len(args)))
		}
		return "(" + strings.Join(ors, " OR ") + ")", args, nil

	case OpGt, OpGte, OpLt, OpLte:
		if len(p.Values) != 1 {
			return "", nil, errf("フィルタ列 %q: 比較は値を1つだけ指定してください", p.Column)
		}
		return buildCompare(spec, p, argOffset)

	case OpRange:
		if len(p.Values) != 2 {
			return "", nil, errf("フィルタ列 %q: 範囲は最小値と最大値の2つを指定してください", p.Column)
		}
		return buildRange(spec, p, argOffset)

	default:
		return "", nil, errf("フィルタ列 %q: 演算子 %q が不正です", p.Column, p.Op)
	}
}

// buildEq は一致(複数値 OR)。date/datetime は値ごとに「その日」の範囲一致。
func buildEq(spec ColumnSpec, p Predicate, argOffset int) (string, []any, error) {
	var ors []string
	var args []any
	for _, raw := range p.Values {
		v, err := parseValue(spec, p.Column, raw)
		if err != nil {
			return "", nil, err
		}
		if day, ok := v.(dayRange); ok {
			args = append(args, day.from, day.to)
			ors = append(ors, fmt.Sprintf("(%s >= @p%d AND %s < @p%d)",
				spec.SQL, argOffset+len(args)-1, spec.SQL, argOffset+len(args)))
			continue
		}
		args = append(args, v)
		ors = append(ors, fmt.Sprintf("%s = @p%d", spec.SQL, argOffset+len(args)))
	}
	return "(" + strings.Join(ors, " OR ") + ")", args, nil
}

func buildCompare(spec ColumnSpec, p Predicate, argOffset int) (string, []any, error) {
	v, err := parseValue(spec, p.Column, p.Values[0])
	if err != nil {
		return "", nil, err
	}
	if _, isDay := v.(dayRange); !isDay {
		switch spec.Type {
		case TypeInt, TypeDecimal:
		default:
			return "", nil, errf("フィルタ列 %q: 比較は数値・日付列のみ指定できます", p.Column)
		}
		op := map[string]string{OpGt: ">", OpGte: ">=", OpLt: "<", OpLte: "<="}[p.Op]
		return fmt.Sprintf("(%s %s @p%d)", spec.SQL, op, argOffset+1), []any{v}, nil
	}
	// 日付は日単位の境界に丸める: >d は「その日の翌日以降」, <=d は「その日の終わりまで」
	day := v.(dayRange)
	switch p.Op {
	case OpGt:
		return fmt.Sprintf("(%s >= @p%d)", spec.SQL, argOffset+1), []any{day.to}, nil
	case OpGte:
		return fmt.Sprintf("(%s >= @p%d)", spec.SQL, argOffset+1), []any{day.from}, nil
	case OpLt:
		return fmt.Sprintf("(%s < @p%d)", spec.SQL, argOffset+1), []any{day.from}, nil
	default: // OpLte
		return fmt.Sprintf("(%s < @p%d)", spec.SQL, argOffset+1), []any{day.to}, nil
	}
}

func buildRange(spec ColumnSpec, p Predicate, argOffset int) (string, []any, error) {
	lo, err := parseValue(spec, p.Column, p.Values[0])
	if err != nil {
		return "", nil, err
	}
	hi, err := parseValue(spec, p.Column, p.Values[1])
	if err != nil {
		return "", nil, err
	}
	if loDay, ok := lo.(dayRange); ok {
		hiDay := hi.(dayRange)
		return fmt.Sprintf("(%s >= @p%d AND %s < @p%d)", spec.SQL, argOffset+1, spec.SQL, argOffset+2),
			[]any{loDay.from, hiDay.to}, nil
	}
	switch spec.Type {
	case TypeInt, TypeDecimal:
	default:
		return "", nil, errf("フィルタ列 %q: 範囲は数値・日付列のみ指定できます", p.Column)
	}
	return fmt.Sprintf("(%s >= @p%d AND %s <= @p%d)", spec.SQL, argOffset+1, spec.SQL, argOffset+2),
		[]any{lo, hi}, nil
}

// dayRange は日付値の「その日」[from, to) 表現。
type dayRange struct{ from, to time.Time }

// parseValue は列型に応じて値文字列を検証・変換する。
// date/datetime は dayRange を返す(演算子側で境界を選ぶ)。
func parseValue(spec ColumnSpec, column, raw string) (any, error) {
	s := strings.TrimSpace(raw)
	switch spec.Type {
	case TypeString:
		return raw, nil
	case TypeInt:
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, errf("フィルタ列 %q: 整数を指定してください", column)
		}
		return n, nil
	case TypeDecimal:
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, errf("フィルタ列 %q: 数値を指定してください", column)
		}
		return f, nil
	case TypeBool:
		switch strings.ToLower(s) {
		case "true", "1":
			return true, nil
		case "false", "0":
			return false, nil
		}
		return nil, errf("フィルタ列 %q: true/false を指定してください", column)
	case TypeUUID:
		if !uuidRe.MatchString(s) {
			return nil, errf("フィルタ列 %q: GUID 形式で指定してください", column)
		}
		return s, nil
	case TypeDate, TypeDateTime:
		day, err := time.Parse("2006-01-02", s)
		if err != nil {
			return nil, errf("フィルタ列 %q: YYYY-MM-DD 形式で指定してください", column)
		}
		from := day.Add(-time.Duration(spec.DayOffsetMinutes) * time.Minute)
		return dayRange{from: from, to: from.AddDate(0, 0, 1)}, nil
	case TypeEnum:
		for _, e := range spec.Enum {
			if s == e {
				return s, nil
			}
		}
		return nil, errf("フィルタ列 %q: %s のいずれかを指定してください", column, strings.Join(spec.Enum, "/"))
	default:
		return nil, errf("フィルタ列 %q はフィルタに対応していません", column)
	}
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`, `[`, `\[`)
	return r.Replace(s)
}
