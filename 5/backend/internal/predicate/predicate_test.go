package predicate

import (
	"strings"
	"testing"
	"time"
)

func specs() map[string]ColumnSpec {
	return map[string]ColumnSpec{
		"name":  {SQL: "[name]", Type: TypeString, Nullable: true},
		"code":  {SQL: "[code]", Type: TypeString},
		"val":   {SQL: "[val]", Type: TypeInt},
		"rate":  {SQL: "[rate]", Type: TypeDecimal, Nullable: true},
		"ok":    {SQL: "[ok]", Type: TypeBool},
		"day":   {SQL: "[day]", Type: TypeDate, Nullable: true},
		"at":    {SQL: "[at]", Type: TypeDateTime},
		"gid":   {SQL: "[gid]", Type: TypeUUID},
		"state": {SQL: "[state]", Type: TypeEnum, Enum: []string{"success", "failure"}},
	}
}

func mustBuild(t *testing.T, preds []Predicate, argOffset int) ([]string, []any) {
	t.Helper()
	conds, args, err := Build(specs(), preds, argOffset)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	return conds, args
}

func TestBuildBasicOps(t *testing.T) {
	t.Run("string contains with OR values", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "code", Op: OpContains, Values: []string{"B-1", "C_2"}},
		}, 0)
		want := `([code] LIKE @p1 ESCAPE '\' OR [code] LIKE @p2 ESCAPE '\')`
		if conds[0] != want {
			t.Errorf("cond = %s, want %s", conds[0], want)
		}
		if args[0] != "%B-1%" || args[1] != `%C\_2%` {
			t.Errorf("args should be escaped LIKE patterns: %v", args)
		}
	})

	t.Run("int eq multiple = OR", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "val", Op: OpEq, Values: []string{"1", "2"}},
		}, 0)
		want := "([val] = @p1 OR [val] = @p2)"
		if conds[0] != want || args[0] != int64(1) || args[1] != int64(2) {
			t.Errorf("got %s %v", conds[0], args)
		}
	})

	t.Run("decimal comparisons", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "rate", Op: OpGte, Values: []string{"1.5"}},
		}, 0)
		if conds[0] != "([rate] >= @p1)" || args[0] != 1.5 {
			t.Errorf("got %s %v", conds[0], args)
		}
	})

	t.Run("int range inclusive", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "val", Op: OpRange, Values: []string{"10", "20"}},
		}, 0)
		if conds[0] != "([val] >= @p1 AND [val] <= @p2)" || args[0] != int64(10) || args[1] != int64(20) {
			t.Errorf("got %s %v", conds[0], args)
		}
	})

	t.Run("bool eq", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "ok", Op: OpEq, Values: []string{"true"}},
		}, 0)
		if conds[0] != "([ok] = @p1)" || args[0] != true {
			t.Errorf("got %s %v", conds[0], args)
		}
	})

	t.Run("enum eq validates against allowed values", func(t *testing.T) {
		if _, _, err := Build(specs(), []Predicate{
			{Column: "state", Op: OpEq, Values: []string{"bogus"}},
		}, 0); err == nil {
			t.Errorf("enum value outside allowed set should fail")
		}
		conds, args := mustBuild(t, []Predicate{
			{Column: "state", Op: OpEq, Values: []string{"success"}},
		}, 0)
		if conds[0] != "([state] = @p1)" || args[0] != "success" {
			t.Errorf("got %s %v", conds[0], args)
		}
	})
}

func TestBuildDates(t *testing.T) {
	day := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	next := day.AddDate(0, 0, 1)

	t.Run("eq means whole-day range", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "at", Op: OpEq, Values: []string{"2026-07-01"}},
		}, 0)
		if conds[0] != "(([at] >= @p1 AND [at] < @p2))" {
			t.Errorf("cond = %s", conds[0])
		}
		if args[0] != day || args[1] != next {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("lte includes the whole end day", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "day", Op: OpLte, Values: []string{"2026-07-01"}},
		}, 0)
		if conds[0] != "([day] < @p1)" || args[0] != next {
			t.Errorf("got %s %v", conds[0], args)
		}
	})

	t.Run("gt starts from the next day", func(t *testing.T) {
		_, args := mustBuild(t, []Predicate{
			{Column: "day", Op: OpGt, Values: []string{"2026-07-01"}},
		}, 0)
		if args[0] != next {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("day offset shifts boundaries (JST)", func(t *testing.T) {
		cols := map[string]ColumnSpec{
			"at": {SQL: "[at]", Type: TypeDateTime, DayOffsetMinutes: 540},
		}
		_, args, err := Build(cols, []Predicate{
			{Column: "at", Op: OpEq, Values: []string{"2026-07-01"}},
		}, 0)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		wantFrom := time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC)
		if args[0] != wantFrom || args[1] != wantFrom.AddDate(0, 0, 1) {
			t.Errorf("JST day should span UTC 6/30 15:00〜7/1 15:00: %v", args)
		}
	})

	t.Run("range spans whole days", func(t *testing.T) {
		conds, args := mustBuild(t, []Predicate{
			{Column: "at", Op: OpRange, Values: []string{"2026-07-01", "2026-07-31"}},
		}, 0)
		if conds[0] != "([at] >= @p1 AND [at] < @p2)" {
			t.Errorf("cond = %s", conds[0])
		}
		if args[1] != time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC) {
			t.Errorf("end should be exclusive next-day midnight: %v", args[1])
		}
	})
}

func TestBuildNegate(t *testing.T) {
	t.Run("negate on non-nullable", func(t *testing.T) {
		conds, _ := mustBuild(t, []Predicate{
			{Column: "code", Op: OpContains, Values: []string{"x"}, Negate: true},
		}, 0)
		if !strings.HasPrefix(conds[0], "(NOT (") || strings.Contains(conds[0], "IS NULL") {
			t.Errorf("cond = %s", conds[0])
		}
	})

	t.Run("negate on nullable keeps NULL rows", func(t *testing.T) {
		conds, _ := mustBuild(t, []Predicate{
			{Column: "name", Op: OpContains, Values: []string{"x"}, Negate: true},
		}, 0)
		if !strings.Contains(conds[0], "OR [name] IS NULL") {
			t.Errorf("negation on nullable column should include NULL rows: %s", conds[0])
		}
	})
}

func TestBuildPlaceholderOffset(t *testing.T) {
	conds, args := mustBuild(t, []Predicate{
		{Column: "val", Op: OpEq, Values: []string{"1"}},
		{Column: "code", Op: OpContains, Values: []string{"a"}},
	}, 3)
	if conds[0] != "([val] = @p4)" {
		t.Errorf("first cond should start at offset+1: %s", conds[0])
	}
	if !strings.Contains(conds[1], "@p5") {
		t.Errorf("second cond should continue numbering: %s", conds[1])
	}
	if len(args) != 2 {
		t.Errorf("args = %v", args)
	}
}

func TestBuildValidation(t *testing.T) {
	cases := []struct {
		name string
		pred Predicate
	}{
		{"unknown column", Predicate{Column: "gone", Op: OpEq, Values: []string{"1"}}},
		{"empty values", Predicate{Column: "val", Op: OpEq, Values: nil}},
		{"bad op", Predicate{Column: "val", Op: "like", Values: []string{"1"}}},
		{"contains on int", Predicate{Column: "val", Op: OpContains, Values: []string{"1"}}},
		{"compare on string", Predicate{Column: "code", Op: OpGt, Values: []string{"a"}}},
		{"compare on bool", Predicate{Column: "ok", Op: OpGt, Values: []string{"true"}}},
		{"range needs two values", Predicate{Column: "val", Op: OpRange, Values: []string{"1"}}},
		{"compare needs one value", Predicate{Column: "val", Op: OpGt, Values: []string{"1", "2"}}},
		{"bad int", Predicate{Column: "val", Op: OpEq, Values: []string{"x"}}},
		{"bad bool", Predicate{Column: "ok", Op: OpEq, Values: []string{"maybe"}}},
		{"bad date", Predicate{Column: "day", Op: OpEq, Values: []string{"2026/07/01"}}},
		{"bad uuid", Predicate{Column: "gid", Op: OpEq, Values: []string{"not-a-guid"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := Build(specs(), []Predicate{tc.pred}, 0)
			if err == nil {
				t.Errorf("should fail")
			}
			var ve *ValidationError
			if !asValidation(err, &ve) {
				t.Errorf("error should be ValidationError: %T", err)
			}
		})
	}
}

func asValidation(err error, target **ValidationError) bool {
	v, ok := err.(*ValidationError)
	if ok {
		*target = v
	}
	return ok
}

func TestParseParam(t *testing.T) {
	t.Run("empty means none", func(t *testing.T) {
		preds, err := ParseParam("")
		if err != nil || preds != nil {
			t.Errorf("got %v %v", preds, err)
		}
	})
	t.Run("valid json", func(t *testing.T) {
		preds, err := ParseParam(`[{"column":"val","op":"eq","values":["1"],"negate":true}]`)
		if err != nil || len(preds) != 1 || !preds[0].Negate {
			t.Errorf("got %+v %v", preds, err)
		}
	})
	t.Run("bad json", func(t *testing.T) {
		if _, err := ParseParam("{"); err == nil {
			t.Errorf("should fail")
		}
	})
	t.Run("too many predicates", func(t *testing.T) {
		raw := "["
		for i := 0; i <= MaxPredicates; i++ {
			if i > 0 {
				raw += ","
			}
			raw += `{"column":"val","op":"eq","values":["1"]}`
		}
		raw += "]"
		if _, err := ParseParam(raw); err == nil {
			t.Errorf("should fail")
		}
	})
}
