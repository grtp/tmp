package repo

import (
	"reflect"
	"testing"

	"f-tool/internal/predicate"
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
		where, args, err := buildHistoryWhere(HistoryFilter{})
		if err != nil || where != "" || len(args) != 0 {
			t.Errorf("empty filter -> %q, %v, %v", where, args, err)
		}
	})

	t.Run("single pred", func(t *testing.T) {
		where, args, err := buildHistoryWhere(HistoryFilter{
			Preds: []predicate.Predicate{
				{Column: "username", Op: predicate.OpContains, Values: []string{"sato"}},
			},
		})
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := ` WHERE (username LIKE @p1 ESCAPE '\')`
		if where != want {
			t.Errorf("where = %q\nwant %q", where, want)
		}
		if len(args) != 1 || args[0] != "%sato%" {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("multiple preds join with AND and continue numbering", func(t *testing.T) {
		where, args, err := buildHistoryWhere(HistoryFilter{
			Preds: []predicate.Predicate{
				{Column: "username", Op: predicate.OpContains, Values: []string{"sato"}},
				{Column: "result", Op: predicate.OpEq, Values: []string{"failure"}},
			},
		})
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := ` WHERE (username LIKE @p1 ESCAPE '\') AND (result = @p2)`
		if where != want {
			t.Errorf("where = %q\nwant %q", where, want)
		}
		if len(args) != 2 || args[1] != "failure" {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("preds unknown column fails", func(t *testing.T) {
		_, _, err := buildHistoryWhere(HistoryFilter{
			Preds: []predicate.Predicate{
				{Column: "detail", Op: predicate.OpContains, Values: []string{"x"}},
			},
		})
		if err == nil {
			t.Errorf("unknown pred column should fail")
		}
	})
}
