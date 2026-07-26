package httpapi

import (
	"reflect"
	"testing"

	api "f-tool/gen/api"
	"f-tool/internal/meta"
)

func TestAuditTarget(t *testing.T) {
	if got := auditTarget("", "dbo", "t"); got != "dbo.t" {
		t.Errorf("default conn: %q", got)
	}
	if got := auditTarget("本番", "dbo", "t"); got != "本番:dbo.t" {
		t.Errorf("named conn: %q", got)
	}
}

func TestSplitCSV(t *testing.T) {
	if got := splitCSV(" a , ,b,"); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Errorf("splitCSV = %v", got)
	}
	if got := splitCSV(""); got != nil {
		t.Errorf("splitCSV(\"\") = %v, want nil", got)
	}
}

func TestOrEmptyArray(t *testing.T) {
	if got := orEmptyArray("  "); got != "[]" {
		t.Errorf("blank -> %q", got)
	}
	if got := orEmptyArray(`[{"a":1}]`); got != `[{"a":1}]` {
		t.Errorf("json passthrough -> %q", got)
	}
}

// columnModesCSV はアダプタなので、nil の解釈と api 型 -> meta 型の変換だけを
// 確認する。検証ルール本体は meta.NormalizeColumnModes のテストが持つ。
func TestColumnModesCSVAdapter(t *testing.T) {
	ins := &meta.Introspection{
		Schema: "dbo", Table: "t",
		PrimaryKey: []string{"Id"},
		Columns: []meta.Column{
			{Name: "Id", Type: meta.TypeInt, Readonly: true},
			{Name: "Name", Type: meta.TypeString},
			{Name: "UpdatedAt", Type: meta.TypeDateTime},
		},
	}

	t.Run("nil inputs mean no specification", func(t *testing.T) {
		ro, hd, fx, err := columnModesCSV(ins, nil, nil, nil)
		if err != nil || ro != "" || hd != "" || fx != "[]" {
			t.Errorf("nil inputs -> %q %q %q %v", ro, hd, fx, err)
		}
	})

	t.Run("api types converted through", func(t *testing.T) {
		fx := []api.FixedColumn{
			{Name: "UpdatedAt", Kind: api.Now, ApplyOn: api.FixedColumnApplyOnBoth},
			{Name: "Name", Kind: api.Literal, Value: ptr("x"), ApplyOn: api.FixedColumnApplyOnInsert},
		}
		_, _, fxJSON, err := columnModesCSV(ins, nil, nil, &fx)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := `[{"name":"UpdatedAt","kind":"now","applyOn":"both"},` +
			`{"name":"Name","kind":"literal","value":"x","applyOn":"insert"}]`
		if fxJSON != want {
			t.Errorf("fxJSON = %s\nwant %s", fxJSON, want)
		}
	})

	t.Run("nil literal value becomes empty and is rejected downstream", func(t *testing.T) {
		fx := []api.FixedColumn{{Name: "Name", Kind: api.Literal, ApplyOn: api.FixedColumnApplyOnBoth}}
		if _, _, _, err := columnModesCSV(ins, nil, nil, &fx); err == nil {
			t.Errorf("literal without value should fail")
		}
	})
}

func TestFixedToAPI(t *testing.T) {
	in := []meta.FixedColumn{
		{Name: "A", Kind: "now", ApplyOn: "both"},
		{Name: "B", Kind: "literal", Value: "x", ApplyOn: "insert"},
	}
	out := fixedToAPI(in)
	if len(out) != 2 {
		t.Fatalf("len = %d", len(out))
	}
	if out[0].Value != nil {
		t.Errorf("now should have nil Value")
	}
	if out[1].Value == nil || *out[1].Value != "x" {
		t.Errorf("literal Value lost: %+v", out[1])
	}
}
