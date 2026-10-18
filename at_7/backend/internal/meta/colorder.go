package meta

import (
	"encoding/json"
	"fmt"
	"strings"
)

func ParseColumnOrder(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return nil, nil
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("invalid column_order json: %w", err)
	}
	return out, nil
}

func NormalizeColumnOrder(ins *Introspection, hidden []string, lookups []LookupDef, order []string) (string, error) {
	if len(order) == 0 {
		return "[]", nil
	}
	base := columnIndex(ins.Columns)
	hiddenSet := map[string]struct{}{}
	for _, h := range hidden {
		hiddenSet[strings.ToLower(strings.TrimSpace(h))] = struct{}{}
	}
	derived := map[string]struct{}{}
	for _, l := range lookups {
		for _, d := range l.Display {
			derived[d.Name] = struct{}{}
		}
	}
	out := make([]string, 0, len(order))
	seen := map[string]struct{}{}
	for _, raw := range order {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		var key string
		if _, ok := derived[name]; ok {
			key = name
		} else {
			c, ok := base[strings.ToLower(name)]
			if !ok {
				return "", fmt.Errorf("表示順の列 %q は存在しません", name)
			}
			if _, isHidden := hiddenSet[strings.ToLower(name)]; isHidden {
				return "", fmt.Errorf("除外した列 %q は表示順に指定できません", c.Name)
			}
			key = c.Name
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "", fmt.Errorf("表示順の変換に失敗しました: %w", err)
	}
	return string(b), nil
}

func (t *TableDef) OrderedColumns() []Column {
	all := make([]Column, 0, len(t.Columns)+len(t.DerivedColumns))
	all = append(all, t.Columns...)
	all = append(all, t.DerivedColumns...)
	if len(t.ColumnOrder) == 0 {
		return all
	}
	pos := make(map[string]int, len(t.ColumnOrder))
	for i, name := range t.ColumnOrder {
		if _, dup := pos[name]; !dup {
			pos[name] = i
		}
	}
	out := make([]Column, 0, len(all))
	placed := make([]Column, len(t.ColumnOrder))
	used := make([]bool, len(t.ColumnOrder))
	var rest []Column
	for _, c := range all {
		if i, ok := pos[c.Name]; ok {
			placed[i] = c
			used[i] = true
		} else {
			rest = append(rest, c)
		}
	}
	for i := range placed {
		if used[i] {
			out = append(out, placed[i])
		}
	}
	return append(out, rest...)
}
