package repo

import (
	"reflect"
	"testing"
	"time"
)

func TestWhereBuilder(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		var b whereBuilder
		where, args := b.where()
		if where != "" || len(args) != 0 {
			t.Errorf("empty builder -> %q, %v", where, args)
		}
	})

	t.Run("numbering follows argument order", func(t *testing.T) {
		var b whereBuilder
		b.add("a = @p%d", 1)
		b.add("b LIKE @p%d", "x")
		b.add("c >= @p%d", 3)
		where, args := b.where()
		want := " WHERE a = @p1 AND b LIKE @p2 AND c >= @p3"
		if where != want {
			t.Errorf("where = %q, want %q", where, want)
		}
		if !reflect.DeepEqual(args, []any{1, "x", 3}) {
			t.Errorf("args = %v", args)
		}
	})
}

func TestSetBuilder(t *testing.T) {
	var b setBuilder
	if !b.empty() {
		t.Errorf("zero value should be empty")
	}
	b.add("name", "n")
	b.add("enabled", true)
	if b.empty() {
		t.Errorf("builder with sets should not be empty")
	}
	if got, want := b.clause(), "name = @p1, enabled = @p2"; got != want {
		t.Errorf("clause = %q, want %q", got, want)
	}
	// arg は SET の後ろに引数を足し、その番号を返す(WHERE id = @pN 用)。
	if n := b.arg(99); n != 3 {
		t.Errorf("arg number = %d, want 3", n)
	}
	if !reflect.DeepEqual(b.args, []any{"n", true, 99}) {
		t.Errorf("args = %v", b.args)
	}
}

func TestBuildHistoryWhere(t *testing.T) {
	t.Run("no filter", func(t *testing.T) {
		where, args := buildHistoryWhere(HistoryFilter{})
		if where != "" || len(args) != 0 {
			t.Errorf("empty filter -> %q, %v", where, args)
		}
	})

	t.Run("all filters, LIKE escaped", func(t *testing.T) {
		from := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
		to := from.AddDate(0, 0, 19)
		where, args := buildHistoryWhere(HistoryFilter{
			Username: "50%_off", ActionCode: "table_maint", Target: "dbo.t",
			Operation: "rows.batch", ClientIP: "10.0.", Result: "success",
			From: &from, To: &to,
		})
		want := ` WHERE username LIKE @p1 ESCAPE '\' AND action_code = @p2` +
			` AND target LIKE @p3 ESCAPE '\' AND operation LIKE @p4 ESCAPE '\'` +
			` AND client_ip LIKE @p5 ESCAPE '\' AND result = @p6` +
			` AND occurred_at >= @p7 AND occurred_at <= @p8`
		if where != want {
			t.Errorf("where = %q\nwant %q", where, want)
		}
		if len(args) != 8 {
			t.Fatalf("args len = %d, want 8", len(args))
		}
		// 部分一致用に % で挟み、ユーザー入力の % と _ はエスケープされる。
		if args[0] != `%50\%\_off%` {
			t.Errorf("username arg = %q", args[0])
		}
		if args[6] != from || args[7] != to {
			t.Errorf("time args = %v, %v", args[6], args[7])
		}
	})
}
