package repo

import (
	"strings"
	"testing"
)

// authPredSpec は機能コードを SQL 文字列へ埋め込むため,埋め込む前に
// actionCodeRe で形を絞っている。ここが緩むと SQL インジェクションに
// 直結するため,許可/拒否の境界をテストで固定する。
func TestActionCodeRe(t *testing.T) {
	ok := []string{"tables", "history", "settings", "a", "user-mgmt2", "abc-123"}
	for _, c := range ok {
		if !actionCodeRe.MatchString(c) {
			t.Errorf("%q は許可されるべき", c)
		}
	}
	ng := []string{
		"",            // 空
		"Table-Maint", // 大文字
		"table maint", // 空白
		"table_maint", // アンダースコア
		"table'maint", // 単一引用符(文字列リテラルの脱出)
		"a'; DROP TABLE x--",
		"日本語",
		"table.maint",
		"table/maint",
	}
	for _, c := range ng {
		if actionCodeRe.MatchString(c) {
			t.Errorf("%q は拒否されるべき", c)
		}
	}
}

// 権限列のスペックは「行が無い = 権限なし」を表すため Nullable であること,
// および想定レベル3種だけを列挙値に持つことを固定する。
func TestAuthPredSpec(t *testing.T) {
	spec := authPredSpec("tables")

	if !spec.Nullable {
		t.Error("権限なし(行なし)を NULL として扱うため Nullable であるべき")
	}
	if got := strings.Count(spec.SQL, "'"); got != 2 {
		t.Errorf("SQL 中の単一引用符は code を囲む2つだけのはず: %q", spec.SQL)
	}
	if !strings.Contains(spec.SQL, "a.code = N'tables'") {
		t.Errorf("code が条件に入っていない: %q", spec.SQL)
	}
	want := map[string]bool{"user": true, "maintainer": true, "admin": true}
	if len(spec.Enum) != len(want) {
		t.Fatalf("Enum = %v, want %v", spec.Enum, want)
	}
	for _, e := range spec.Enum {
		if !want[e] {
			t.Errorf("想定外の列挙値: %q", e)
		}
	}
}

// ユーザー一覧のフィルタ可能列。フロントの users-grid が送る列名と
// 対応しているため,勝手に減らすと絞り込みが 400 になる。
func TestUsersPredSpecs(t *testing.T) {
	specs := usersPredSpecs()
	for _, col := range []string{"username", "displayName", "email", "lastLoginAt"} {
		if _, ok := specs[col]; !ok {
			t.Errorf("%q が抜けている", col)
		}
	}
	// 最終ログインは UTC 保存・JST 表示。日単位フィルタは JST の境界で解釈する。
	if got := specs["lastLoginAt"].DayOffsetMinutes; got != 540 {
		t.Errorf("lastLoginAt の DayOffsetMinutes = %d, want 540(JST)", got)
	}
}
