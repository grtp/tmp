package meta

import (
	"reflect"
	"testing"
)

func TestCsvSet(t *testing.T) {
	got := csvSet(" Name , VALUE ,, name ")
	want := map[string]struct{}{"name": {}, "value": {}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("csvSet = %v, want %v", got, want)
	}
	if len(csvSet("")) != 0 {
		t.Errorf("csvSet(\"\") should be empty")
	}
}

func TestParseFixedColumns(t *testing.T) {
	for _, raw := range []string{"", "  ", "[]", " [] "} {
		got, err := ParseFixedColumns(raw)
		if err != nil || got != nil {
			t.Errorf("ParseFixedColumns(%q) = %v, %v; want nil, nil", raw, got, err)
		}
	}

	got, err := ParseFixedColumns(`[{"name":"updated_at","kind":"now","applyOn":"both"}]`)
	if err != nil {
		t.Fatalf("ParseFixedColumns: %v", err)
	}
	want := []FixedColumn{{Name: "updated_at", Kind: "now", ApplyOn: "both"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseFixedColumns = %+v, want %+v", got, want)
	}

	if _, err := ParseFixedColumns("{broken"); err == nil {
		t.Errorf("ParseFixedColumns(broken json) should fail")
	}
}

func TestFixedColumnApplies(t *testing.T) {
	cases := []struct {
		applyOn  string
		ins, upd bool
	}{
		{"insert", true, false},
		{"update", false, true},
		{"both", true, true},
		{"", false, false},
	}
	for _, c := range cases {
		f := FixedColumn{ApplyOn: c.applyOn}
		if f.AppliesOnInsert() != c.ins || f.AppliesOnUpdate() != c.upd {
			t.Errorf("ApplyOn=%q: insert=%v update=%v, want %v/%v",
				c.applyOn, f.AppliesOnInsert(), f.AppliesOnUpdate(), c.ins, c.upd)
		}
	}
}

func TestApplyColumnModes(t *testing.T) {
	cols := func() []Column {
		return []Column{
			{Name: "Id", Type: TypeInt, Readonly: true}, // PK(IDENTITY 想定)
			{Name: "Name", Type: TypeString, Required: true},
			{Name: "Note", Type: TypeString},
			{Name: "Secret", Type: TypeString, Required: true},
			{Name: "UpdatedAt", Type: TypeDateTime},
			{Name: "RowVer", Type: TypeString, Readonly: true}, // 自動 readonly
		}
	}
	pk := []string{"Id"}

	t.Run("no modes returns input as-is", func(t *testing.T) {
		in := cols()
		out, blocked, fx, hfx := applyColumnModes(in, pk, "", "", nil)
		if !reflect.DeepEqual(out, in) || blocked != nil || fx != nil || hfx != nil {
			t.Errorf("unexpected change without modes: %+v %v %v %v", out, blocked, fx, hfx)
		}
	})

	t.Run("hidden required column is removed and blocked", func(t *testing.T) {
		out, blocked, _, _ := applyColumnModes(cols(), pk, "", "secret", nil)
		for _, c := range out {
			if c.Name == "Secret" {
				t.Errorf("Secret should be removed")
			}
		}
		if !reflect.DeepEqual(blocked, []string{"Secret"}) {
			t.Errorf("blocked = %v, want [Secret]", blocked)
		}
	})

	t.Run("readonly drops Required, PK spec ignored", func(t *testing.T) {
		out, _, _, _ := applyColumnModes(cols(), pk, "name,id", "", nil)
		var name, id Column
		for _, c := range out {
			switch c.Name {
			case "Name":
				name = c
			case "Id":
				id = c
			}
		}
		if !name.Readonly || name.Required {
			t.Errorf("Name should be readonly and not required: %+v", name)
		}
		if !id.Readonly || id.Fixed {
			t.Errorf("Id (PK) should keep catalog state: %+v", id)
		}
	})

	t.Run("fixed sets flags and normalizes name", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "UPDATEDAT", Kind: "now", ApplyOn: "both"}}
		out, _, fx, _ := applyColumnModes(cols(), pk, "", "", fixed)
		var ua Column
		for _, c := range out {
			if c.Name == "UpdatedAt" {
				ua = c
			}
		}
		if !ua.Fixed || !ua.Readonly || ua.Required {
			t.Errorf("UpdatedAt flags wrong: %+v", ua)
		}
		if len(fx) != 1 || fx[0].Name != "UpdatedAt" {
			t.Errorf("fxOut should have catalog-normalized name: %+v", fx)
		}
	})

	t.Run("fixed on auto-readonly column is ignored", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "RowVer", Kind: "literal", Value: "x", ApplyOn: "both"}}
		out, _, fx, _ := applyColumnModes(cols(), pk, "", "", fixed)
		if len(fx) != 0 {
			t.Errorf("fixed spec on auto-readonly column should be dropped: %+v", fx)
		}
		for _, c := range out {
			if c.Name == "RowVer" && c.Fixed {
				t.Errorf("RowVer should not be Fixed")
			}
		}
	})

	t.Run("unknown column names are silently ignored", func(t *testing.T) {
		out, blocked, fx, hfx := applyColumnModes(cols(), pk, "gone1", "gone2",
			[]FixedColumn{{Name: "gone3", Kind: "now", ApplyOn: "both"}})
		if len(out) != len(cols()) || blocked != nil || len(fx) != 0 || len(hfx) != 0 {
			t.Errorf("dropped/renamed DB columns must not break the table: %v %v %v", out, blocked, fx)
		}
	})

	t.Run("hidden+fixed removes column but keeps fixed spec", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "SECRET", Kind: "literal", Value: "v", ApplyOn: "both"}}
		out, blocked, fx, hfx := applyColumnModes(cols(), pk, "", "secret", fixed)
		for _, c := range out {
			if c.Name == "Secret" {
				t.Errorf("Secret should be removed from visible columns")
			}
		}
		// insert にも適用される固定値があるので新規作成不能には数えない
		if len(blocked) != 0 {
			t.Errorf("blocked = %v, want empty (fixed value covers insert)", blocked)
		}
		if len(fx) != 1 || fx[0].Name != "Secret" {
			t.Errorf("fxOut should carry catalog-normalized fixed spec: %+v", fx)
		}
		if len(hfx) != 1 || hfx[0].Name != "Secret" || !hfx[0].Fixed || !hfx[0].Readonly {
			t.Errorf("HiddenFixedColumns should carry the removed column def: %+v", hfx)
		}
	})

	t.Run("hidden+fixed with applyOn=update still blocks insert", func(t *testing.T) {
		fixed := []FixedColumn{{Name: "Secret", Kind: "literal", Value: "v", ApplyOn: "update"}}
		_, blocked, _, _ := applyColumnModes(cols(), pk, "", "secret", fixed)
		if !reflect.DeepEqual(blocked, []string{"Secret"}) {
			t.Errorf("blocked = %v, want [Secret] (fixed value does not cover insert)", blocked)
		}
	})
}

func TestFixedTarget(t *testing.T) {
	def := &TableDef{
		Columns:            []Column{{Name: "Name", Type: TypeString}},
		HiddenFixedColumns: []Column{{Name: "Secret", Type: TypeString, Fixed: true}},
	}
	if c := def.FixedTarget("Name"); c == nil || c.Name != "Name" {
		t.Errorf("FixedTarget should find visible column: %+v", c)
	}
	if c := def.FixedTarget("Secret"); c == nil || c.Name != "Secret" {
		t.Errorf("FixedTarget should find hidden+fixed column: %+v", c)
	}
	if c := def.FixedTarget("Gone"); c != nil {
		t.Errorf("FixedTarget should return nil for unknown column: %+v", c)
	}
}
