package store

import (
	"testing"

	"f-tool/internal/meta"
	"f-tool/internal/predicate"
)

// meta.ColumnType と predicate.Type は別々の enum で,値の文字列表現が
// たまたま一致しているだけ。predicateType はその対応を明示する switch
// なので,meta に型が追加されたのにここへケースを足し忘れると,この
// テストが「対応表に載っていない値がある」ことで壊れて気づける
// (直接キャストのままだと壊れず,実行時まで気づけない)。
func TestPredicateTypeCoversAllColumnTypes(t *testing.T) {
	all := []meta.ColumnType{
		meta.TypeString, meta.TypeInt, meta.TypeDecimal, meta.TypeBool,
		meta.TypeDate, meta.TypeDateTime, meta.TypeUUID,
	}
	for _, mt := range all {
		if got := predicateType(mt); got == predicate.TypeInvalid {
			t.Errorf("predicateType(%q) は未対応(TypeInvalid)。predicateType の switch にケースを追加すること", mt)
		}
	}
}

// 未知の meta.ColumnType(将来の追加を模したもの)は,対応するケースが
// 無ければ TypeInvalid を返し,フィルタとしては安全側(拒否)に倒れる
// ことを固定する。
func TestPredicateTypeUnknownIsInvalid(t *testing.T) {
	if got := predicateType(meta.ColumnType("money")); got != predicate.TypeInvalid {
		t.Errorf("predicateType(unknown) = %q, want TypeInvalid", got)
	}
}
