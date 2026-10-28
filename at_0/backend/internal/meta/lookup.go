package meta

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Lookup struct {
	Columns   []string `json:"columns"`
	RefSchema string   `json:"refSchema"`
	RefTable  string   `json:"refTable"`
	RefKey    []string `json:"refKey"`
	Display   []string `json:"display"`

	Label string `json:"label,omitempty"`

	DisplayLabels map[string]string `json:"displayLabels,omitempty"`
}

func ParseLookups(raw string) ([]Lookup, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return nil, nil
	}
	var out []Lookup
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("invalid lookups json: %w", err)
	}
	return out, nil
}

type LookupDef struct {
	Index     int
	Label     string
	Columns   []string
	RefSchema string
	RefTable  string
	RefKey    []string

	RefKeyColumns []Column

	Display []Column
}

func (l *LookupDef) Alias() string { return fmt.Sprintf("lk%d", l.Index) }

func (l *LookupDef) QualifiedRef() string {
	return QuoteIdent(l.RefSchema) + "." + QuoteIdent(l.RefTable)
}

func DerivedKey(index int, refCol string) string {
	return fmt.Sprintf("lk%d.%s", index, refCol)
}

type Introspector func(schema, table string) (*Introspection, error)

func NormalizeLookups(base *Introspection, hidden []string, lookups []Lookup, intro Introspector) (string, []LookupDef, error) {
	if len(lookups) == 0 {
		return "[]", nil, nil
	}
	normalized := make([]Lookup, 0, len(lookups))
	defs := make([]LookupDef, 0, len(lookups))
	seen := map[string]struct{}{}
	for i, l := range lookups {
		n, d, err := normalizeLookup(base, hidden, l, len(defs), intro)
		if err != nil {
			return "", nil, fmt.Errorf("参照表示 %d: %w", i+1, err)
		}
		key := strings.ToLower(strings.Join(n.Columns, "\x00")) + "\x01" + strings.ToLower(n.RefSchema+"."+n.RefTable)
		if _, dup := seen[key]; dup {
			return "", nil, fmt.Errorf("参照表示 %d: 同じキー列と参照先の組が重複しています", i+1)
		}
		seen[key] = struct{}{}
		normalized = append(normalized, *n)
		defs = append(defs, *d)
	}

	if i, label, other := headerConflict(base, defs); i >= 0 {
		return "", nil, fmt.Errorf("参照表示 %d: 見出し %q が列 %q と重複しています(表示名を変えてください)", i+1, label, other)
	}
	b, err := json.Marshal(normalized)
	if err != nil {
		return "", nil, fmt.Errorf("参照表示の変換に失敗しました: %w", err)
	}
	return string(b), defs, nil
}

func ResolveLookups(base *Introspection, hidden []string, lookups []Lookup, intro Introspector) ([]LookupDef, []string) {
	var defs []LookupDef
	var warnings []string
	for i, l := range lookups {
		_, d, err := normalizeLookup(base, hidden, l, len(defs), intro)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("参照表示 %d: %v", i+1, err))
			continue
		}
		defs = append(defs, *d)
	}

	for {
		i, label, other := headerConflict(base, defs)
		if i < 0 {
			break
		}
		fixed := false
		for j := range defs[i].Display {
			dc := &defs[i].Display[j]
			if dc.Label == label && dc.Label != defaultHeader(defs[i].Label, dc.RefName) {
				warnings = append(warnings, fmt.Sprintf("参照表示 %d: 表示名 %q は列 %q と重複するため既定の %q で表示します", i+1, label, other, defaultHeader(defs[i].Label, dc.RefName)))
				dc.Label = defaultHeader(defs[i].Label, dc.RefName)
				fixed = true
				break
			}
		}
		if !fixed {
			warnings = append(warnings, fmt.Sprintf("参照表示 %d: 見出し %q が列 %q と重複しています", i+1, label, other))
			break
		}
	}
	return defs, warnings
}

func defaultHeader(label, refName string) string { return label + "." + refName }

func headerConflict(base *Introspection, defs []LookupDef) (int, string, string) {
	headers := map[string]string{}
	for _, c := range base.Columns {
		headers[strings.ToLower(c.Name)] = c.Name
	}
	for i, d := range defs {
		for _, dc := range d.Display {
			k := strings.ToLower(dc.Label)
			if other, dup := headers[k]; dup {
				return i, dc.Label, other
			}
			headers[k] = dc.Label
		}
	}
	return -1, "", ""
}

func normalizeLookup(base *Introspection, hidden []string, l Lookup, index int, intro Introspector) (*Lookup, *LookupDef, error) {
	if len(l.Columns) == 0 {
		return nil, nil, fmt.Errorf("キー列を 1 つ以上指定してください")
	}
	if len(l.RefKey) != len(l.Columns) {
		return nil, nil, fmt.Errorf("キー列(%d)と参照先のキー列(%d)の数が一致しません", len(l.Columns), len(l.RefKey))
	}
	if len(l.Display) == 0 {
		return nil, nil, fmt.Errorf("表示する列を 1 つ以上指定してください")
	}
	refSchema, refTable := strings.TrimSpace(l.RefSchema), strings.TrimSpace(l.RefTable)
	if refSchema == "" || refTable == "" {
		return nil, nil, fmt.Errorf("参照先テーブルを指定してください")
	}
	if strings.HasPrefix(strings.ToLower(refTable), "ftool_app_") {
		return nil, nil, fmt.Errorf("ftool_app_ で始まるテーブルは参照できません")
	}

	baseCols := columnIndex(base.Columns)
	hiddenSet := map[string]struct{}{}
	for _, h := range hidden {
		hiddenSet[strings.ToLower(strings.TrimSpace(h))] = struct{}{}
	}
	cols := make([]string, 0, len(l.Columns))
	colDefs := make([]*Column, 0, len(l.Columns))
	usedCols := map[string]struct{}{}
	for _, raw := range l.Columns {
		key := strings.ToLower(strings.TrimSpace(raw))
		c, ok := baseCols[key]
		if !ok {
			return nil, nil, fmt.Errorf("キー列 %q は存在しません", raw)
		}
		if _, isHidden := hiddenSet[key]; isHidden {
			return nil, nil, fmt.Errorf("除外した列 %q はキー列にできません", c.Name)
		}
		if _, dup := usedCols[key]; dup {
			return nil, nil, fmt.Errorf("キー列 %q が重複しています", c.Name)
		}
		usedCols[key] = struct{}{}
		cols = append(cols, c.Name)
		colDefs = append(colDefs, c)
	}

	ref, err := intro(refSchema, refTable)
	if err != nil {
		return nil, nil, err
	}
	if ref == nil {
		return nil, nil, fmt.Errorf("参照先テーブル %s.%s が存在しません", refSchema, refTable)
	}
	refCols := columnIndex(ref.Columns)
	refKey := make([]string, 0, len(l.RefKey))
	refKeyCols := make([]Column, 0, len(l.RefKey))
	for i, raw := range l.RefKey {
		key := strings.ToLower(strings.TrimSpace(raw))
		c, ok := refCols[key]
		if !ok {
			return nil, nil, fmt.Errorf("参照先の列 %q は存在しません", raw)
		}
		if c.Unsupported {
			return nil, nil, fmt.Errorf("参照先の列 %q は対応外の型のためキーにできません", c.Name)
		}
		if c.Type != colDefs[i].Type {
			return nil, nil, fmt.Errorf("キー列 %q(%s)と参照先の列 %q(%s)の型が一致しません", colDefs[i].Name, colDefs[i].Type, c.Name, c.Type)
		}
		refKey = append(refKey, c.Name)
		refKeyCols = append(refKeyCols, *c)
	}
	if !matchesUniqueKey(ref, refKey) {
		return nil, nil, fmt.Errorf("参照先 %s.%s の列 %s は主キーまたは一意索引ではありません(1 対 1 に引き当てられません)", ref.Schema, ref.Table, strings.Join(refKey, ", "))
	}

	label := strings.TrimSpace(l.Label)
	if label == "" {
		label = ref.Table
	}
	if len([]rune(label)) > 64 {
		return nil, nil, fmt.Errorf("見出しは 64 文字以内で指定してください")
	}

	aliases := map[string]string{}
	for rawCol, rawAlias := range l.DisplayLabels {
		alias := strings.TrimSpace(rawAlias)
		if alias == "" {
			continue
		}
		c, ok := refCols[strings.ToLower(strings.TrimSpace(rawCol))]
		if !ok {
			return nil, nil, fmt.Errorf("表示名を付けた列 %q は参照先に存在しません", rawCol)
		}
		if len([]rune(alias)) > 64 {
			return nil, nil, fmt.Errorf("列 %q の表示名は 64 文字以内で指定してください", c.Name)
		}
		aliases[strings.ToLower(c.Name)] = alias
	}

	display := make([]string, 0, len(l.Display))
	derived := make([]Column, 0, len(l.Display))
	usedDisp := map[string]struct{}{}
	normalizedAliases := map[string]string{}
	for _, raw := range l.Display {
		key := strings.ToLower(strings.TrimSpace(raw))
		c, ok := refCols[key]
		if !ok {
			return nil, nil, fmt.Errorf("表示する列 %q は参照先に存在しません", raw)
		}
		if c.Unsupported {
			return nil, nil, fmt.Errorf("表示する列 %q は対応外の型のため使えません", c.Name)
		}
		if _, dup := usedDisp[key]; dup {
			continue
		}
		usedDisp[key] = struct{}{}
		display = append(display, c.Name)
		dc := *c
		dc.Name = DerivedKey(index, c.Name)
		dc.RefName = c.Name
		dc.Derived = true
		dc.LookupIndex = index
		dc.Label = label + "." + c.Name
		if alias, ok := aliases[key]; ok {
			dc.Label = alias
			normalizedAliases[c.Name] = alias
		}
		dc.Readonly = true
		dc.Required = false
		dc.Fixed = false
		dc.Nullable = true
		derived = append(derived, dc)
	}

	for col := range aliases {
		if _, ok := usedDisp[col]; !ok {
			return nil, nil, fmt.Errorf("表示名を付けた列 %q は表示する列に含まれていません", col)
		}
	}
	n := &Lookup{Columns: cols, RefSchema: ref.Schema, RefTable: ref.Table, RefKey: refKey, Display: display}
	if label != ref.Table {
		n.Label = label
	}
	if len(normalizedAliases) > 0 {
		n.DisplayLabels = normalizedAliases
	}
	d := &LookupDef{
		Index: index, Label: label, Columns: cols,
		RefSchema: ref.Schema, RefTable: ref.Table, RefKey: refKey, RefKeyColumns: refKeyCols,
		Display: derived,
	}
	return n, d, nil
}

func columnIndex(cols []Column) map[string]*Column {
	out := make(map[string]*Column, len(cols))
	for i := range cols {
		out[strings.ToLower(cols[i].Name)] = &cols[i]
	}
	return out
}

func matchesUniqueKey(ref *Introspection, cols []string) bool {
	want := map[string]struct{}{}
	for _, c := range cols {
		want[strings.ToLower(c)] = struct{}{}
	}
	keys := ref.UniqueKeys
	if len(ref.PrimaryKey) > 0 {
		keys = append([][]string{ref.PrimaryKey}, keys...)
	}
	for _, k := range keys {
		if len(k) != len(want) {
			continue
		}
		all := true
		for _, c := range k {
			if _, ok := want[strings.ToLower(c)]; !ok {
				all = false
				break
			}
		}
		if all {
			return true
		}
	}
	return false
}

func (t *TableDef) Derived(name string) *Column {
	for i := range t.DerivedColumns {
		if t.DerivedColumns[i].Name == name {
			return &t.DerivedColumns[i]
		}
	}
	return nil
}

func (t *TableDef) AnyColumn(name string) *Column {
	if c := t.Column(name); c != nil {
		return c
	}
	return t.Derived(name)
}

func (t *TableDef) Lookup(index int) *LookupDef {
	for i := range t.Lookups {
		if t.Lookups[i].Index == index {
			return &t.Lookups[i]
		}
	}
	return nil
}

func (t *TableDef) setLookups(defs []LookupDef) {
	t.Lookups = defs
	t.DerivedColumns = nil
	for _, l := range defs {
		t.DerivedColumns = append(t.DerivedColumns, l.Display...)
	}
}
