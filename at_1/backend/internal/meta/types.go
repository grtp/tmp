package meta

import (
	"strings"
)

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
	Name     string
	Type     ColumnType
	Nullable bool

	Readonly bool

	Required bool

	Searchable bool

	MaxLength int

	Fixed bool
}

type FixedColumn struct {
	Name string `json:"name"`

	Kind  string `json:"kind"`
	Value string `json:"value,omitempty"`

	ApplyOn string `json:"applyOn"`
}

func (f FixedColumn) AppliesOnInsert() bool { return f.ApplyOn == "insert" || f.ApplyOn == "both" }
func (f FixedColumn) AppliesOnUpdate() bool { return f.ApplyOn == "update" || f.ApplyOn == "both" }

type TableDef struct {
	ID int

	ConnectionID *int

	ConnectionName   string
	Schema           string
	Table            string
	DisplayName      string
	Description      string
	SortOrder        int
	Enabled          bool
	PrimaryKey       []string
	RowVersionColumn string
	Columns          []Column

	InsertBlockedColumns []string

	FixedColumns []FixedColumn

	HiddenFixedColumns []Column
}

func (t *TableDef) Column(name string) *Column {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}

func (t *TableDef) FixedTarget(name string) *Column {
	if c := t.Column(name); c != nil {
		return c
	}
	for i := range t.HiddenFixedColumns {
		if t.HiddenFixedColumns[i].Name == name {
			return &t.HiddenFixedColumns[i]
		}
	}
	return nil
}

func (t *TableDef) QualifiedName() string {
	return QuoteIdent(t.Schema) + "." + QuoteIdent(t.Table)
}

func QuoteIdent(name string) string {
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
}
