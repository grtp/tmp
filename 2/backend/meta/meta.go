// Package meta loads the statically embedded table definitions
// (tables/*.yaml) and exposes them as an immutable Registry.
//
// テーブルの追加 = tables/ に YAML を置いて再ビルド。
// ここが「静的にビルドへ組み込む」の実体。
package meta

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed tables/*.yaml
var tableFS embed.FS

// ColumnType is the normalized type exposed to the frontend.
// The mapping to concrete SQL Server types lives in verify.go.
type ColumnType string

const (
	TypeString   ColumnType = "string"
	TypeInt      ColumnType = "int"
	TypeDecimal  ColumnType = "decimal"
	TypeBool     ColumnType = "bool"
	TypeDate     ColumnType = "date"
	TypeDateTime ColumnType = "datetime"
	TypeUUID     ColumnType = "uuid"
)

type Column struct {
	Name        string     `yaml:"name"`
	DisplayName string     `yaml:"displayName"`
	Type        ColumnType `yaml:"type"`
	Nullable    bool       `yaml:"nullable"`
	Readonly    bool       `yaml:"readonly"`
	Required    bool       `yaml:"required"`
	Searchable  bool       `yaml:"searchable"`
	MaxLength   int        `yaml:"maxLength"`
	Min         *float64   `yaml:"min"`
	Max         *float64   `yaml:"max"`
	Enum        []string   `yaml:"enum"`
}

type Permissions struct {
	Read  []string `yaml:"read"`
	Write []string `yaml:"write"`
}

type Protect struct {
	Kind   string `yaml:"kind"` // "lastRowMatching"
	Column string `yaml:"column"`
	Value  string `yaml:"value"`
}

type Guards struct {
	DenyInsert bool      `yaml:"denyInsert"`
	DenyDelete bool      `yaml:"denyDelete"`
	Protect    []Protect `yaml:"protect"`
}

type TableDef struct {
	// Name is the API identifier, derived from the file name
	// (products.yaml -> "products"). Not present inside the YAML.
	Name string `yaml:"-"`

	Schema           string      `yaml:"schema"`
	Table            string      `yaml:"table"`
	DisplayName      string      `yaml:"displayName"`
	Description      string      `yaml:"description"`
	PrimaryKey       []string    `yaml:"primaryKey"`
	RowVersionColumn string      `yaml:"rowVersionColumn"`
	Permissions      Permissions `yaml:"permissions"`
	Guards           Guards      `yaml:"guards"`
	Columns          []Column    `yaml:"columns"`
}

// Column returns the column definition by name, or nil.
func (t *TableDef) Column(name string) *Column {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}

// CanRead / CanWrite check role-based access defined in the YAML.
func (t *TableDef) CanRead(role string) bool  { return contains(t.Permissions.Read, role) }
func (t *TableDef) CanWrite(role string) bool { return contains(t.Permissions.Write, role) }

// QualifiedName returns "[schema].[table]" with identifiers validated
// at load time, safe to interpolate into SQL.
func (t *TableDef) QualifiedName() string {
	return fmt.Sprintf("[%s].[%s]", t.Schema, t.Table)
}

// Registry is the immutable set of loaded table definitions.
type Registry struct {
	tables map[string]*TableDef
}

func (r *Registry) Get(name string) (*TableDef, bool) {
	t, ok := r.tables[name]
	return t, ok
}

// All returns definitions sorted by name (stable menu order).
func (r *Registry) All() []*TableDef {
	out := make([]*TableDef, 0, len(r.tables))
	for _, t := range r.tables {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

var (
	nameRe  = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	identRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	roleSet = map[string]bool{"admin": true, "maintainer": true, "user": true}
)

// Load parses and structurally validates every embedded YAML.
// It fails fast: a single bad definition prevents startup.
func Load() (*Registry, error) {
	entries, err := fs.Glob(tableFS, "tables/*.yaml")
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("meta: no table definitions embedded")
	}

	reg := &Registry{tables: make(map[string]*TableDef, len(entries))}
	for _, p := range entries {
		name := strings.TrimSuffix(path.Base(p), ".yaml")
		raw, err := tableFS.ReadFile(p)
		if err != nil {
			return nil, err
		}
		var def TableDef
		dec := yaml.NewDecoder(strings.NewReader(string(raw)))
		dec.KnownFields(true) // typo in a key = load error, not silent ignore
		if err := dec.Decode(&def); err != nil {
			return nil, fmt.Errorf("meta: %s: %w", p, err)
		}
		def.Name = name
		if err := validate(&def); err != nil {
			return nil, fmt.Errorf("meta: %s: %w", p, err)
		}
		reg.tables[name] = &def
	}
	return reg, nil
}

func validate(t *TableDef) error {
	if !nameRe.MatchString(t.Name) {
		return fmt.Errorf("file name %q must match %s", t.Name, nameRe)
	}
	if !identRe.MatchString(t.Schema) || !identRe.MatchString(t.Table) {
		return fmt.Errorf("schema/table must be valid identifiers")
	}
	if t.DisplayName == "" {
		return fmt.Errorf("displayName is required")
	}
	if len(t.PrimaryKey) == 0 {
		return fmt.Errorf("primaryKey must have at least one column")
	}
	if len(t.Columns) == 0 {
		return fmt.Errorf("columns must not be empty")
	}
	for _, r := range append(append([]string{}, t.Permissions.Read...), t.Permissions.Write...) {
		if !roleSet[r] {
			return fmt.Errorf("unknown role %q", r)
		}
	}

	seen := map[string]bool{}
	valid := map[ColumnType]bool{
		TypeString: true, TypeInt: true, TypeDecimal: true,
		TypeBool: true, TypeDate: true, TypeDateTime: true, TypeUUID: true,
	}
	for _, c := range t.Columns {
		if !identRe.MatchString(c.Name) {
			return fmt.Errorf("column %q: invalid identifier", c.Name)
		}
		if seen[c.Name] {
			return fmt.Errorf("column %q: duplicate", c.Name)
		}
		seen[c.Name] = true
		if !valid[c.Type] {
			return fmt.Errorf("column %q: unknown type %q", c.Name, c.Type)
		}
		if c.Readonly && c.Required {
			return fmt.Errorf("column %q: readonly and required are mutually exclusive", c.Name)
		}
	}
	for _, pk := range t.PrimaryKey {
		if !seen[pk] {
			return fmt.Errorf("primaryKey %q is not a defined column", pk)
		}
	}
	if rv := t.RowVersionColumn; rv != "" && !identRe.MatchString(rv) {
		return fmt.Errorf("rowVersionColumn %q: invalid identifier", rv)
	}
	for _, g := range t.Guards.Protect {
		if g.Kind != "lastRowMatching" {
			return fmt.Errorf("guards.protect: unknown kind %q", g.Kind)
		}
		if !seen[g.Column] {
			return fmt.Errorf("guards.protect: column %q is not defined", g.Column)
		}
	}
	return nil
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
