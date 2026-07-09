// Package meta builds table definitions at runtime from the SQL Server
// catalog (INFORMATION_SCHEMA / sys.columns), replacing the old statically
// embedded YAML. 管理対象は app_managed_tables に登録された schema.table。
package meta

import (
	"strings"
)

// ColumnType is the normalized type exposed to the frontend.
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
	Name       string
	Type       ColumnType
	Nullable   bool
	// Readonly: IDENTITY・計算列・対応外型。編集 UI とバッチの防衛線。
	Readonly   bool
	// Required: NOT NULL かつデフォルト値なし(insert 時に必須)。
	Required   bool
	// Searchable: 文字列型の列。q パラメータの LIKE 対象。
	Searchable bool
	// MaxLength: 文字列型の最大文字数(nvarchar(n) 由来。MAX/その他は 0)。
	MaxLength  int
}

// TableDef is a runtime table definition: the app_managed_tables row
// combined with fresh catalog introspection.
type TableDef struct {
	ID int
	// ConnectionID: nil = 既定接続(アプリ自身の DB)。
	ConnectionID *int
	// ConnectionName: 接続の表示名(既定接続は "")。監査 target に使う。
	ConnectionName   string
	Schema           string
	Table            string
	DisplayName      string
	Description      string
	SortOrder        int
	Enabled          bool
	PrimaryKey       []string
	RowVersionColumn string // "" = 楽観ロックなし(last-write-wins)
	Columns          []Column
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

// QualifiedName returns "[schema].[table]" safe to interpolate into SQL.
// 識別子はカタログ由来(登録時に実在確認済み)だが、防衛として QuoteIdent
// で `]` をエスケープする。
func (t *TableDef) QualifiedName() string {
	return QuoteIdent(t.Schema) + "." + QuoteIdent(t.Table)
}

// QuoteIdent brackets an identifier, doubling any `]` (QUOTENAME 相当)。
// 動的テーブルの識別子は必ずこの関数を通して SQL に埋め込む。
func QuoteIdent(name string) string {
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
}
