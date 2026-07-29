package authz

import "testing"

// 権限判定はこのツールの安全性の要だが従来テストが無かった。
// DB を要する Resolver ではなく,判定ロジック側を固める。

func TestLevelValid(t *testing.T) {
	for _, l := range []Level{LevelAdmin, LevelMaintainer, LevelUser} {
		if !l.Valid() {
			t.Errorf("%q は有効なレベルのはず", l)
		}
	}
	for _, l := range []Level{"", "owner", "Admin", "ADMIN"} {
		if l.Valid() {
			t.Errorf("%q は無効なレベルのはず(大文字小文字も区別する)", l)
		}
	}
}

func TestLevelCovers(t *testing.T) {
	cases := []struct {
		have Level
		min  Level
		want bool
	}{
		{LevelAdmin, LevelAdmin, true},
		{LevelAdmin, LevelMaintainer, true},
		{LevelAdmin, LevelUser, true},
		{LevelMaintainer, LevelAdmin, false},
		{LevelMaintainer, LevelMaintainer, true},
		{LevelMaintainer, LevelUser, true},
		{LevelUser, LevelAdmin, false},
		{LevelUser, LevelMaintainer, false},
		{LevelUser, LevelUser, true},
		// 未知のレベル(DB に不正値が入った場合)は何も満たさない
		{"", LevelUser, false},
		{"owner", LevelUser, false},
	}
	for _, tc := range cases {
		if got := tc.have.Covers(tc.min); got != tc.want {
			t.Errorf("Level(%q).Covers(%q) = %v, want %v", tc.have, tc.min, got, tc.want)
		}
	}
}

func testGrants(pairs map[string]Level) *Grants {
	g := &Grants{byCode: map[string]Grant{}}
	for code, lv := range pairs {
		g.byCode[code] = Grant{Code: code, Level: lv}
	}
	return g
}

func TestGrantsAllows(t *testing.T) {
	g := testGrants(map[string]Level{
		ActionTableMaint: LevelUser,
		ActionHistory:    LevelMaintainer,
	})

	if !g.Allows(ActionTableMaint, LevelUser) {
		t.Error("table-maint:user は user を満たすはず")
	}
	if g.Allows(ActionTableMaint, LevelMaintainer) {
		t.Error("table-maint:user は maintainer を満たさないはず")
	}
	if !g.Allows(ActionHistory, LevelMaintainer) {
		t.Error("history:maintainer は maintainer を満たすはず")
	}
	// 行が無い機能は「権限なし」。設定画面へ入れないことの担保。
	if g.Allows(ActionSettings, LevelUser) {
		t.Error("未付与の機能は最低レベルでも拒否するはず")
	}
}

func TestGrantsLevel(t *testing.T) {
	g := testGrants(map[string]Level{ActionSettings: LevelAdmin})

	lv, ok := g.Level(ActionSettings)
	if !ok || lv != LevelAdmin {
		t.Errorf("Level(settings) = (%q, %v), want (admin, true)", lv, ok)
	}
	if _, ok := g.Level("unknown"); ok {
		t.Error("未付与の機能は ok=false を返すはず")
	}
}

// 初回ログインで実体化する既定カードから除外する機能。
// サイドバーからのみ開くもの(設定・操作履歴)だけを外し,
// テーブルメンテは必ず既定カードに含める。
func TestSidebarOnlyActions(t *testing.T) {
	set := map[string]bool{}
	for _, code := range sidebarOnlyActions {
		set[code] = true
	}
	if !set[ActionSettings] || !set[ActionHistory] {
		t.Errorf("settings と history は除外対象のはず: %v", sidebarOnlyActions)
	}
	if set[ActionTableMaint] {
		t.Error("table-maint を除外すると初回ログインでカードが1枚も出なくなる")
	}
}
