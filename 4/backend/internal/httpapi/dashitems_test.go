package httpapi

import (
	"context"
	"testing"

	"f-tool/internal/authz"
)

// DB や権限に触れない経路(kind の判定・link の検証・action の必須項目)を
// 直接検証する。repo を呼ぶ経路(action の存在確認 / table)はここでは扱わない
// ため,ゼロ値の Server で足りる。
func newParserServer() *Server { return &Server{} }

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

func TestParseDashItemLink(t *testing.T) {
	s := newParserServer()
	in := dashItemInput{
		Kind: "link", Name: strPtr("  社内Wiki  "), URL: strPtr("https://wiki.example.local/"),
	}
	got, err := s.parseDashItem(context.Background(), in, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Name != "社内Wiki" {
		t.Errorf("Name = %q, want trimmed %q", got.Name, "社内Wiki")
	}
	if got.Icon != "open_in_new" {
		t.Errorf("Icon = %q, want default open_in_new", got.Icon)
	}
}

func TestParseDashItemLinkIconOverride(t *testing.T) {
	s := newParserServer()
	in := dashItemInput{
		Kind: "link", Name: strPtr("Wiki"), URL: strPtr("http://wiki.local/"), Icon: strPtr("book"),
	}
	got, err := s.parseDashItem(context.Background(), in, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Icon != "book" {
		t.Errorf("Icon = %q, want book", got.Icon)
	}
}

func TestParseDashItemInvalid(t *testing.T) {
	cases := []struct {
		name string
		in   dashItemInput
	}{
		{"未知の kind", dashItemInput{Kind: "widget"}},
		{"kind 空", dashItemInput{Kind: ""}},
		{"action に actionId 無し", dashItemInput{Kind: "action"}},
		{"link に name 無し", dashItemInput{Kind: "link", URL: strPtr("https://a.local/")}},
		{"link の name が空白のみ", dashItemInput{
			Kind: "link", Name: strPtr("   "), URL: strPtr("https://a.local/")}},
		{"link に url 無し", dashItemInput{Kind: "link", Name: strPtr("A")}},
		// javascript: 等を弾く(リンクカードは http(s) のみ)
		{"link の url が http(s) でない", dashItemInput{
			Kind: "link", Name: strPtr("A"), URL: strPtr("javascript:alert(1)")}},
		{"link の url が ftp", dashItemInput{
			Kind: "link", Name: strPtr("A"), URL: strPtr("ftp://a.local/")}},
	}
	s := newParserServer()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.parseDashItem(context.Background(), tc.in, nil); err == nil {
				t.Fatal("エラーを期待したが nil だった")
			} else if err.status != 400 {
				t.Errorf("status = %d, want 400", err.status)
			}
		})
	}
}

// 配布テンプレート(grants=nil)は権限検査をしないので,action は
// actionId さえあれば通る(存在確認は repo 側の FK に委ねる)。
func TestParseDashItemTemplateActionSkipsGrants(t *testing.T) {
	s := newParserServer()
	got, err := s.parseDashItem(context.Background(), dashItemInput{Kind: "action", ActionID: intPtr(7)}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ActionID != 7 {
		t.Errorf("ActionID = %d, want 7", got.ActionID)
	}
}

// 個人ダッシュボード(grants あり)でテーブルカードは table-maint 権限が要る。
// 権限が無ければ repo を見るまでもなく 403。
func TestParseDashItemTableRequiresTableMaint(t *testing.T) {
	s := newParserServer()
	grants := &authz.Grants{}
	_, err := s.parseDashItem(context.Background(),
		dashItemInput{Kind: "table", ManagedTableID: intPtr(1)}, grants)
	if err == nil {
		t.Fatal("エラーを期待したが nil だった")
	}
	if err.status != 403 {
		t.Errorf("status = %d, want 403", err.status)
	}
}

func TestParseDashItemsStopsAtFirstInvalid(t *testing.T) {
	s := newParserServer()
	ins := []dashItemInput{
		{Kind: "link", Name: strPtr("A"), URL: strPtr("https://a.local/")},
		{Kind: "bogus"},
	}
	items, err := s.parseDashItems(context.Background(), ins, nil)
	if err == nil {
		t.Fatal("エラーを期待したが nil だった")
	}
	if items != nil {
		t.Errorf("失敗時は items を返さない想定: %v", items)
	}
}
