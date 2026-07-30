package meta

import (
	"encoding/json"
	"testing"
)

// FuzzParseFixedColumns は任意 JSON で panic しないこと,成功時は
// 再マーシャル可能な値が返ることを検証する。
func FuzzParseFixedColumns(f *testing.F) {
	f.Add(`[{"name":"a","kind":"now","applyOn":"both"}]`)
	f.Add(`[]`)
	f.Add(`{broken`)
	f.Fuzz(func(t *testing.T, raw string) {
		out, err := ParseFixedColumns(raw)
		if err != nil {
			return
		}
		if _, merr := json.Marshal(out); merr != nil {
			t.Fatalf("成功結果が再マーシャル不能: %v", merr)
		}
	})
}

// FuzzNormalizeColumnModes は任意の列モード指定で panic しないこと,
// 成功時の fxJSON が必ず ParseFixedColumns で読み戻せることを検証する。
func FuzzNormalizeColumnModes(f *testing.F) {
	f.Add("name", "note", "UpdatedAt", "now", "", "both")
	f.Add("", "", "Count", "literal", "1", "insert")
	f.Fuzz(func(t *testing.T, ro, hd, fxName, fxKind, fxValue, fxApply string) {
		ins := &Introspection{
			Schema: "dbo", Table: "t",
			PrimaryKey: []string{"Id"},
			Columns: []Column{
				{Name: "Id", Type: TypeInt, Readonly: true},
				{Name: "Name", Type: TypeString},
				{Name: "Note", Type: TypeString},
				{Name: "Count", Type: TypeInt},
				{Name: "UpdatedAt", Type: TypeDateTime},
			},
		}
		fixed := []FixedColumn{{Name: fxName, Kind: fxKind, Value: fxValue, ApplyOn: fxApply}}
		_, _, fxJSON, err := NormalizeColumnModes(ins, []string{ro}, []string{hd}, fixed)
		if err != nil {
			return
		}
		if _, perr := ParseFixedColumns(fxJSON); perr != nil {
			t.Fatalf("成功時の fxJSON が読み戻せない: %q: %v", fxJSON, perr)
		}
	})
}
