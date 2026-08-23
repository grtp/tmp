package repo

import (
	"fmt"
	"strings"
)

type whereBuilder struct {
	conds []string
	args  []any
}

func (b *whereBuilder) add(cond string, v any) {
	b.args = append(b.args, v)
	b.conds = append(b.conds, fmt.Sprintf(cond, len(b.args)))
}

func (b *whereBuilder) where() (string, []any) {
	if len(b.conds) == 0 {
		return "", b.args
	}
	return " WHERE " + strings.Join(b.conds, " AND "), b.args
}

type setBuilder struct {
	sets []string
	args []any
}

func (b *setBuilder) add(col string, v any) {
	b.args = append(b.args, v)
	b.sets = append(b.sets, fmt.Sprintf("%s = @p%d", col, len(b.args)))
}

func (b *setBuilder) empty() bool { return len(b.sets) == 0 }

func (b *setBuilder) arg(v any) int {
	b.args = append(b.args, v)
	return len(b.args)
}

func (b *setBuilder) clause() string { return strings.Join(b.sets, ", ") }
