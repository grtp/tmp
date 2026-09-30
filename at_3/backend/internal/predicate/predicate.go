package predicate

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Type string

const (
	TypeString   Type = "string"
	TypeInt      Type = "int"
	TypeDecimal  Type = "decimal"
	TypeBool     Type = "bool"
	TypeDate     Type = "date"
	TypeDateTime Type = "datetime"
	TypeUUID     Type = "uuid"

	TypeEnum Type = "enum"

	TypeInvalid Type = ""
)

type Predicate struct {
	Column string   `json:"column"`
	Op     string   `json:"op"`
	Values []string `json:"values"`
	Negate bool     `json:"negate,omitempty"`
}

const (
	OpEq       = "eq"
	OpContains = "contains"
	OpGt       = "gt"
	OpGte      = "gte"
	OpLt       = "lt"
	OpLte      = "lte"
	OpRange    = "range"
)

type ColumnSpec struct {
	SQL      string
	Type     Type
	Nullable bool

	Enum []string

	DayOffsetMinutes int
}

type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func errf(format string, a ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, a...)}
}

const (
	MaxPredicates = 20
	MaxValues     = 20
)

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

	day := v.(dayRange)
	switch p.Op {
	case OpGt:
		return fmt.Sprintf("(%s >= @p%d)", spec.SQL, argOffset+1), []any{day.to}, nil
	case OpGte:
		return fmt.Sprintf("(%s >= @p%d)", spec.SQL, argOffset+1), []any{day.from}, nil
	case OpLt:
		return fmt.Sprintf("(%s < @p%d)", spec.SQL, argOffset+1), []any{day.from}, nil
	default:
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

type dayRange struct{ from, to time.Time }

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

func EscapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`, `[`, `\[`)
	return r.Replace(s)
}

func escapeLike(s string) string { return EscapeLike(s) }
