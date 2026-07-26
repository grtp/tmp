package store

import (
	"strings"
	"testing"
	"time"

	"f-tool/internal/meta"
)

func TestCoerceValue(t *testing.T) {
	col := func(typ meta.ColumnType, maxLen int) *meta.Column {
		return &meta.Column{Name: "c", Type: typ, MaxLength: maxLen}
	}

	t.Run("nil passes through", func(t *testing.T) {
		got, err := coerceValue(col(meta.TypeInt, 0), nil)
		if got != nil || err != nil {
			t.Errorf("nil -> %v, %v", got, err)
		}
	})

	t.Run("int", func(t *testing.T) {
		got, err := coerceValue(col(meta.TypeInt, 0), float64(42))
		if err != nil || got != int64(42) {
			t.Errorf("int 42 -> %v (%T), %v", got, got, err)
		}
		if _, err := coerceValue(col(meta.TypeInt, 0), 1.5); err == nil {
			t.Errorf("non-integer float should fail")
		}
		if _, err := coerceValue(col(meta.TypeInt, 0), "42"); err == nil {
			t.Errorf("string for int should fail")
		}
	})

	t.Run("decimal", func(t *testing.T) {
		got, err := coerceValue(col(meta.TypeDecimal, 0), 1.25)
		if err != nil || got != 1.25 {
			t.Errorf("decimal -> %v, %v", got, err)
		}
	})

	t.Run("bool", func(t *testing.T) {
		got, err := coerceValue(col(meta.TypeBool, 0), true)
		if err != nil || got != true {
			t.Errorf("bool -> %v, %v", got, err)
		}
		if _, err := coerceValue(col(meta.TypeBool, 0), "true"); err == nil {
			t.Errorf("string for bool should fail")
		}
	})

	t.Run("string with MaxLength in runes", func(t *testing.T) {
		if _, err := coerceValue(col(meta.TypeString, 3), "あいう"); err != nil {
			t.Errorf("3 runes within max 3 should pass: %v", err)
		}
		if _, err := coerceValue(col(meta.TypeString, 3), "あいうえ"); err == nil {
			t.Errorf("4 runes over max 3 should fail")
		}
	})

	t.Run("uuid", func(t *testing.T) {
		ok := "01234567-89ab-CDEF-0123-456789abcdef"
		if got, err := coerceValue(col(meta.TypeUUID, 0), ok); err != nil || got != ok {
			t.Errorf("uuid -> %v, %v", got, err)
		}
		if _, err := coerceValue(col(meta.TypeUUID, 0), "not-a-guid"); err == nil {
			t.Errorf("bad uuid should fail")
		}
	})

	t.Run("date and datetime", func(t *testing.T) {
		got, err := coerceValue(col(meta.TypeDate, 0), "2026-07-19")
		if err != nil {
			t.Fatalf("date: %v", err)
		}
		if tm := got.(time.Time); tm.Year() != 2026 || tm.Month() != 7 || tm.Day() != 19 {
			t.Errorf("date parsed wrong: %v", tm)
		}
		for _, s := range []string{"2026-07-19T12:34:56Z", "2026-07-19T12:34:56", "2026-07-19T12:34", "2026-07-19"} {
			if _, err := coerceValue(col(meta.TypeDateTime, 0), s); err != nil {
				t.Errorf("datetime %q should parse: %v", s, err)
			}
		}
		if _, err := coerceValue(col(meta.TypeDateTime, 0), "19/07/2026"); err == nil {
			t.Errorf("unsupported layout should fail")
		}
	})
}

func TestFixedValue(t *testing.T) {
	col := func(typ meta.ColumnType) *meta.Column { return &meta.Column{Name: "c", Type: typ} }

	t.Run("now for datetime returns JST time", func(t *testing.T) {
		got, err := fixedValue(meta.FixedColumn{Kind: "now"}, col(meta.TypeDateTime))
		if err != nil {
			t.Fatalf("now: %v", err)
		}
		tm, ok := got.(time.Time)
		if !ok || tm.Location() != jst {
			t.Errorf("now -> %v (%T), want JST time.Time", got, got)
		}
		if d := time.Since(tm); d < 0 || d > time.Minute {
			t.Errorf("now not close to current time: %v", tm)
		}
	})

	t.Run("now for string returns RFC3339 with +09:00", func(t *testing.T) {
		got, err := fixedValue(meta.FixedColumn{Kind: "now"}, col(meta.TypeString))
		if err != nil {
			t.Fatalf("now/string: %v", err)
		}
		s := got.(string)
		if _, perr := time.Parse(time.RFC3339, s); perr != nil {
			t.Errorf("now/string not RFC3339: %v", s)
		}
		if !strings.HasSuffix(s, "+09:00") {
			t.Errorf("now/string not JST offset: %v", s)
		}
	})

	t.Run("now for int is rejected", func(t *testing.T) {
		if _, err := fixedValue(meta.FixedColumn{Kind: "now"}, col(meta.TypeInt)); err == nil {
			t.Errorf("now for int should fail")
		}
	})

	t.Run("literal per column type", func(t *testing.T) {
		if got, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "42"}, col(meta.TypeInt)); err != nil || got != int64(42) {
			t.Errorf("literal int -> %v, %v", got, err)
		}
		if got, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "1.5"}, col(meta.TypeDecimal)); err != nil || got != 1.5 {
			t.Errorf("literal decimal -> %v, %v", got, err)
		}
		if got, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "true"}, col(meta.TypeBool)); err != nil || got != true {
			t.Errorf("literal bool -> %v, %v", got, err)
		}
		if got, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "hello"}, col(meta.TypeString)); err != nil || got != "hello" {
			t.Errorf("literal string -> %v, %v", got, err)
		}
		if _, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "2026-07-19"}, col(meta.TypeDate)); err != nil {
			t.Errorf("literal date should parse: %v", err)
		}
	})

	t.Run("literal parse errors", func(t *testing.T) {
		if _, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "abc"}, col(meta.TypeInt)); err == nil || !strings.Contains(err.Error(), "数値") {
			t.Errorf("literal abc for int should fail with 数値 message: %v", err)
		}
		if _, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "yes"}, col(meta.TypeBool)); err == nil {
			t.Errorf("literal yes for bool should fail")
		}
	})

	t.Run("literal string honors MaxLength", func(t *testing.T) {
		c := &meta.Column{Name: "c", Type: meta.TypeString, MaxLength: 2}
		if _, err := fixedValue(meta.FixedColumn{Kind: "literal", Value: "abc"}, c); err == nil {
			t.Errorf("literal over MaxLength should fail via coerceValue")
		}
	})
}
