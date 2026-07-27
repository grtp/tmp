// Package meta は SQL Server カタログ(INFORMATION_SCHEMA / sys.columns)
// から実行時にテーブル定義を構築する(旧・静的 YAML 埋め込みの置き換え)。
// 管理対象は ftool_app_managed_tables に登録された schema.table。
package meta

import (
	"strings"
)

// ColumnType はフロントへ公開する正規化済みの型。
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
	// Readonly: IDENTITY・計算列・対応外型。編集 UI とバッチの防衛線。
	Readonly bool
	// Required: NOT NULL かつデフォルト値なし(insert 時に必須)。
	Required bool
	// Searchable: 文字列型の列。q パラメータの LIKE 対象。
	Searchable bool
	// MaxLength: 文字列型の最大文字数(nvarchar(n) 由来。MAX/その他は 0)。
	MaxLength int
	// Fixed: 固定値列(保存時にサーバーが自動セット)。true なら Readonly も true。
	Fixed bool
}

// FixedColumn は固定値列の指定
// (ftool_app_managed_tables.fixed_columns の1要素)。
type FixedColumn struct {
	Name string `json:"name"`
	// Kind: "literal"(固定文字列) or "now"(保存時のサーバー現在時刻 UTC)。
	Kind  string `json:"kind"`
	Value string `json:"value,omitempty"`
	// ApplyOn: "insert" / "update" / "both"。
	ApplyOn string `json:"applyOn"`
}

// AppliesOnInsert / AppliesOnUpdate は適用タイミングの判定ヘルパー。
func (f FixedColumn) AppliesOnInsert() bool { return f.ApplyOn == "insert" || f.ApplyOn == "both" }
func (f FixedColumn) AppliesOnUpdate() bool { return f.ApplyOn == "update" || f.ApplyOn == "both" }

// TableDef は実行時のテーブル定義: ftool_app_managed_tables の行 +
// 最新のカタログイントロスペクション。
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
	// InsertBlockedColumns: 除外(hidden)された NOT NULL・デフォルトなし列。
	// 1つでもあると INSERT が必ず失敗するため，UI は新規/取込を無効化し，
	// batch も事前に親切なエラーで拒否する。
	InsertBlockedColumns []string
	// FixedColumns: 固定値列の指定(実在し PK/自動readonly でない列に正規化済み)。
	// store が insert/update 時に値を自動セットする。除外(hidden)との併用可:
	// その場合列は Columns には現れず(画面から見えない),保存時の自動セット
	// だけが生きる。
	FixedColumns []FixedColumn
	// HiddenFixedColumns: 除外+固定の列定義。Columns から除去された列のうち
	// 固定値を持つもの(store が値の型変換に使う。SELECT/表示には出さない)。
	HiddenFixedColumns []Column
}

// Column は列名で列定義を返す(無ければ nil)。
func (t *TableDef) Column(name string) *Column {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}

// FixedTarget は固定値の適用先列を返す(表示列に加え,除外+固定の列も対象)。
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

// QualifiedName は SQL に埋め込める "[schema].[table]" を返す。
// 識別子はカタログ由来(登録時に実在確認済み)だが，防衛として QuoteIdent
// で `]` をエスケープする。
func (t *TableDef) QualifiedName() string {
	return QuoteIdent(t.Schema) + "." + QuoteIdent(t.Table)
}

// QuoteIdent brackets an identifier, doubling any `]` (QUOTENAME 相当)。
// 動的テーブルの識別子は必ずこの関数を通して SQL に埋め込む。
func QuoteIdent(name string) string {
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
}
