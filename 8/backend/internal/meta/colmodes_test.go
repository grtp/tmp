package meta

import (
	"strings"
	"testing"
)

func testIntrospection() *Introspection {
	return &Introspection{
		Schema: "dbo", Table: "t",
		PrimaryKey: []string{"Id"},
		Columns: []Column{
			{Name: "Id", Type: TypeInt, Readonly: true},
			{Name: "Name", Type: TypeString},
			{Name: "Note", Type: TypeString},
			{Name: "Count", Type: TypeInt},
			{Name: "UpdatedAt", Type: TypeDateTime},
			{Name: "Computed", Type: TypeString, Readonly: true},
		},
	}
}

func TestNormalizeColumnModes(t *testing.T) {
	t.Run("empty inputs give empty CSVs and []", func(t *testing.T) {
		ro, hd, fx, err := NormalizeColumnModes(testIntrospection(), nil, nil, nil)
		if err != nil || ro != "" || hd != "" || fx != "[]" {
			t.Errorf("empty inputs -> %q %q %q %v", ro, hd, fx, err)
		}
	})

	t.Run("names normalized to catalog casing, same-mode dup folded", func(t *testing.T) {
		ro, hd, fx, err := NormalizeColumnModes(testIntrospection(),
			[]string{" name ", "NAME"}, []string{"note"}, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if ro != "Name" || hd != "Note" || fx != "[]" {
			t.Errorf("got %q %q %q", ro, hd, fx)
		}
	})

	t.Run("unknown column rejected", func(t *testing.T) {
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), []string{"gone"}, nil, nil); err == nil {
			t.Errorf("unknown column should fail")
		}
	})

	t.Run("primary key rejected", func(t *testing.T) {
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), []string{"id"}, nil, nil); err == nil {
			t.Errorf("PK column should fail")
		}
	})

	t.Run("cross-mode duplicate rejected", func(t *testing.T) {
		_, _, _, err := NormalizeColumnModes(testIntrospection(),
			[]string{"Name"}, []string{"name"}, nil)
		if err == nil || !strings.Contains(err.Error(), "複数のモード") {
			t.Errorf("cross-mode dup should fail: %v", err)
		}
	})

	t.Run("valid fixed columns serialized to JSON", func(t *testing.T) {
		fixed := []FixedColumn{
			{Name: "updatedat", Kind: "now", ApplyOn: "both"},
			{Name: "Count", Kind: "literal", Value: "1", ApplyOn: "insert"},
		}
		_, _, fxJSON, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := `[{"name":"UpdatedAt","kind":"now","applyOn":"both"},` +
			`{"name":"Count","kind":"literal","value":"1","applyOn":"insert"}]`
		if fxJSON != want {
			t.Errorf("fxJSON = %s\nwant %s", fxJSON, want)
		}
	})

	t.Run("fixed literal requires a value", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "Name", Kind: "literal", ApplyOn: "both"}}
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed); err == nil {
			t.Errorf("literal without value should fail")
		}
	})

	t.Run("fixed now only for date/datetime/string", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "Count", Kind: "now", ApplyOn: "both"}}
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed); err == nil {
			t.Errorf("now for int should fail")
		}
	})

	t.Run("fixed on auto-readonly column rejected", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "Computed", Kind: "now", ApplyOn: "both"}}
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed); err == nil {
			t.Errorf("fixed on auto-readonly should fail")
		}
	})

	t.Run("fixed duplicate rejected", func(t *testing.T) {
		fixed := []FixedColumn{
			{Name: "UpdatedAt", Kind: "now", ApplyOn: "both"},
			{Name: "updatedat", Kind: "now", ApplyOn: "both"},
		}
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed); err == nil {
			t.Errorf("duplicate fixed column should fail")
		}
	})

	t.Run("invalid kind rejected", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "UpdatedAt", Kind: "sometimes", ApplyOn: "both"}}
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed); err == nil {
			t.Errorf("invalid kind should fail")
		}
	})

	t.Run("invalid applyOn rejected", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "UpdatedAt", Kind: "now", ApplyOn: "sometimes"}}
		if _, _, _, err := NormalizeColumnModes(testIntrospection(), nil, nil, fixed); err == nil {
			t.Errorf("invalid applyOn should fail")
		}
	})
}
