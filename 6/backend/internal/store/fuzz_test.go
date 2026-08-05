package store

import (
	"testing"

	"f-tool/internal/meta"
)

var fuzzTypes = []meta.ColumnType{
	meta.TypeString, meta.TypeInt, meta.TypeDecimal, meta.TypeBool,
	meta.TypeDate, meta.TypeDateTime, meta.TypeUUID,
}

// FuzzCoerceValue は任意入力で panic しないこと,成功時の値が列型に
// 対応した Go 型であることを検証する(JSON 由来の string/float64/bool/nil)。
func FuzzCoerceValue(f *testing.F) {
	f.Add(uint8(1), "42", 3.14, true, uint8(0))
	f.Add(uint8(6), "2026-07-20", 0.0, false, uint8(0))
	f.Fuzz(func(t *testing.T, typIdx uint8, s string, fl float64, b bool, sel uint8) {
		c := &meta.Column{Name: "c", Type: fuzzTypes[int(typIdx)%len(fuzzTypes)], MaxLength: 10}
		var v any
		switch sel % 4 {
		case 0:
			v = s
		case 1:
			v = fl
		case 2:
			v = b
		case 3:
			v = nil
		}
		got, err := coerceValue(c, v)
		if err != nil || got == nil {
			return
		}
		switch c.Type {
		case meta.TypeInt:
			if _, ok := got.(int64); !ok {
				t.Fatalf("int 列の成功値が int64 でない: %T", got)
			}
		case meta.TypeBool:
			if _, ok := got.(bool); !ok {
				t.Fatalf("bool 列の成功値が bool でない: %T", got)
			}
		case meta.TypeString, meta.TypeUUID:
			if _, ok := got.(string); !ok {
				t.Fatalf("%s 列の成功値が string でない: %T", c.Type, got)
			}
		}
	})
}
