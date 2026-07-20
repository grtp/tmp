package meta

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

type Introspection struct {
	Schema           string
	Table            string
	PrimaryKey       []string
	RowVersionColumn string
	Columns          []Column
}

// sqlTypeMap: SQL Server 型(小文字) → 正規化型。
// ここに無い型(varbinary/xml/geography 等)は string + readonly に落とし，
// テーブル全体を使用不能にはしない。
var sqlTypeMap = map[string]ColumnType{
	"nvarchar": TypeString, "varchar": TypeString, "nchar": TypeString,
	"char": TypeString, "ntext": TypeString, "text": TypeString,
	"int": TypeInt, "bigint": TypeInt, "smallint": TypeInt, "tinyint": TypeInt,
	"decimal": TypeDecimal, "numeric": TypeDecimal, "money": TypeDecimal,
	"smallmoney": TypeDecimal, "float": TypeDecimal, "real": TypeDecimal,
	"bit":      TypeBool,
	"date":     TypeDate,
	"datetime": TypeDateTime, "datetime2": TypeDateTime,
	"smalldatetime": TypeDateTime, "datetimeoffset": TypeDateTime,
	"uniqueidentifier": TypeUUID,
}

// Introspect は schema.table の列/主キー/rowversion をカタログから読む。
// テーブルが存在しない場合は (nil, nil) を返す(呼び出し側で 404 にする)。
func Introspect(ctx context.Context, db *sql.DB, schema, table string) (*Introspection, error) {
	// OBJECT_ID はパラメータ化できるので識別子の埋め込みが不要。
	qualified := QuoteIdent(schema) + "." + QuoteIdent(table)

	const colQ = `
SELECT c.name, t.name AS type_name, c.is_nullable, c.is_identity, c.is_computed,
       c.max_length,
       CASE WHEN dc.object_id IS NOT NULL THEN 1 ELSE 0 END AS has_default
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
LEFT JOIN sys.default_constraints dc
       ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE c.object_id = OBJECT_ID(@p1)
ORDER BY c.column_id`

	rows, err := db.QueryContext(ctx, colQ, qualified)
	if err != nil {
		return nil, fmt.Errorf("meta: introspect columns: %w", err)
	}
	defer rows.Close()

	out := &Introspection{Schema: schema, Table: table}
	for rows.Next() {
		var (
			name, typeName                   string
			nullable, isIdentity, isComputed bool
			maxLength                        int
			hasDefault                       bool
		)
		if err := rows.Scan(&name, &typeName, &nullable, &isIdentity, &isComputed, &maxLength, &hasDefault); err != nil {
			return nil, fmt.Errorf("meta: scan column: %w", err)
		}
		typeName = strings.ToLower(typeName)

		// rowversion 列は通常列として公開せず，楽観ロック専用に扱う。
		if typeName == "rowversion" || typeName == "timestamp" {
			out.RowVersionColumn = name
			continue
		}

		col := Column{Name: name, Nullable: nullable}
		ct, supported := sqlTypeMap[typeName]
		if !supported {
			// 対応外型: 表示はできるが編集不可。
			col.Type = TypeString
			col.Readonly = true
		} else {
			col.Type = ct
			col.Readonly = isIdentity || isComputed
		}
		if col.Type == TypeString && supported {
			col.Searchable = true
			// nchar/nvarchar の max_length はバイト数(文字数の2倍)。-1 = MAX。
			if maxLength > 0 {
				if typeName == "nvarchar" || typeName == "nchar" || typeName == "ntext" {
					col.MaxLength = maxLength / 2
				} else {
					col.MaxLength = maxLength
				}
			}
		}
		col.Required = !nullable && !hasDefault && !col.Readonly
		out.Columns = append(out.Columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out.Columns) == 0 && out.RowVersionColumn == "" {
		return nil, nil // テーブルが存在しない
	}

	pk, err := fetchPrimaryKey(ctx, db, schema, table)
	if err != nil {
		return nil, err
	}
	out.PrimaryKey = pk
	return out, nil
}

func fetchPrimaryKey(ctx context.Context, db *sql.DB, schema, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT kcu.COLUMN_NAME
		FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
		JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
		  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
		 AND tc.TABLE_SCHEMA   = kcu.TABLE_SCHEMA
		WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
		  AND tc.TABLE_SCHEMA = @p1 AND tc.TABLE_NAME = @p2
		ORDER BY kcu.ORDINAL_POSITION`, schema, table)
	if err != nil {
		return nil, fmt.Errorf("meta: fetch pk: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type CandidateTable struct {
	Schema        string
	Table         string
	HasPrimaryKey bool
}

// RegisteredKey は ListCandidates の除外セット用のキーを作る。
// lower 折りたたみで比較する(SQL Server の既定 CI 照合に合わせる。
// CS 照合のサーバーでは大文字小文字違いの別テーブルを取りこぼす既知の限界)。
func RegisteredKey(schema, table string) string {
	return strings.ToLower(schema) + "\x00" + strings.ToLower(table)
}

// ListCandidates は対象 db で登録可能な BASE TABLE を列挙する。
// app_% と registered に含まれるものは除外する。
//
// 登録済みの除外はメモリ差分で行う。候補は対象接続のカタログ，登録情報は
// アプリ DB にあり，別サーバー間で NOT EXISTS 結合ができないため。
func ListCandidates(ctx context.Context, db *sql.DB, schemaFilter string, registered map[string]struct{}) ([]CandidateTable, error) {
	const q = `
SELECT t.TABLE_SCHEMA, t.TABLE_NAME,
       CASE WHEN EXISTS (
           SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
             AND tc.TABLE_SCHEMA = t.TABLE_SCHEMA AND tc.TABLE_NAME = t.TABLE_NAME
       ) THEN 1 ELSE 0 END AS has_pk
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE'
  AND t.TABLE_NAME NOT LIKE 'app[_]%'
  AND (@p1 = N'' OR t.TABLE_SCHEMA = @p1)
ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME`

	rows, err := db.QueryContext(ctx, q, schemaFilter)
	if err != nil {
		return nil, fmt.Errorf("meta: list candidates: %w", err)
	}
	defer rows.Close()

	out := []CandidateTable{}
	for rows.Next() {
		var c CandidateTable
		if err := rows.Scan(&c.Schema, &c.Table, &c.HasPrimaryKey); err != nil {
			return nil, err
		}
		if _, ok := registered[RegisteredKey(c.Schema, c.Table)]; ok {
			continue
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Schema != out[j].Schema {
			return out[i].Schema < out[j].Schema
		}
		return out[i].Table < out[j].Table
	})
	return out, rows.Err()
}
