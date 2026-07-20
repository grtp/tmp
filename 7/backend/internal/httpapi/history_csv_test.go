package httpapi

import (
	"strings"
	"testing"
)

func TestSummarizeDetail(t *testing.T) {
	cases := []struct {
		name, operation, detail, want string
	}{
		{"empty detail", "rows.batch", "", ""},
		{"broken json", "rows.batch", "{broken", ""},
		{"unknown operation", "login", `{"foo":1}`, ""},

		{"batch success counts", "rows.batch",
			`{"inserted":2,"updated":1,"deleted":0}`, "追加2件・更新1件"},
		{"batch failure uses request arrays sorted", "rows.batch",
			`{"inserts":[{},{}],"deletes":[{}]}`, "削除1件・追加2件"},
		{"batch error appended", "rows.batch",
			`{"inserted":1,"error":"boom"}`, "追加1件・エラー: boom"},

		{"rows export", "rows.export", `{"rows":120}`, "120件を出力"},
		{"history export", "history.export", `{"rows":3}`, "3件を出力"},

		{"dash-template count", "dash-template.update", `{"name":"営業","count":4}`, "項目4件を設定"},
		{"dash-template name only", "dash-template.create", `{"name":"営業"}`, "営業"},
		{"dash-template id fallback", "dash-template.delete", `{"id":7}`, "id=7"},

		{"managed-table displayName", "managed-table.create", `{"displayName":"大量データ"}`, "大量データ"},

		// user-link: データ最小化後の detail 形式。
		{"user-link action", "user-link.create", `{"id":1,"kind":"action","actionId":2,"actionCode":"table_maint"}`, "action:table_maint"},
		{"user-link table", "user-link.create", `{"id":1,"kind":"table","managedTableId":3,"managedTableName":"顧客"}`, "table:顧客"},
		{"user-link plain link", "user-link.delete", `{"id":1,"kind":"link"}`, "link"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := summarizeDetail(c.operation, c.detail); got != c.want {
				t.Errorf("summarizeDetail(%q, %s) = %q, want %q", c.operation, c.detail, got, c.want)
			}
		})
	}

	t.Run("long error is truncated to 60 runes", func(t *testing.T) {
		long := strings.Repeat("え", 100)
		got := summarizeDetail("rows.batch", `{"inserted":1,"error":"`+long+`"}`)
		want := "追加1件・エラー: " + strings.Repeat("え", 60) + "…"
		if got != want {
			t.Errorf("truncation wrong: %q", got)
		}
	})
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("abc", 3); got != "abc" {
		t.Errorf("no truncation expected: %q", got)
	}
	if got := truncateRunes("あいうえお", 3); got != "あいう…" {
		t.Errorf("rune truncation wrong: %q", got)
	}
}
