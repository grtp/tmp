package meta

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
)

// typeMap: YAML の正規化型 → 許容する SQL Server 型 (小文字)。
var typeMap = map[ColumnType][]string{
	TypeString:   {"nvarchar", "varchar", "nchar", "char", "ntext"},
	TypeInt:      {"int", "bigint", "smallint", "tinyint"},
	TypeDecimal:  {"decimal", "numeric", "money", "float", "real"},
	TypeBool:     {"bit"},
	TypeDate:     {"date"},
	TypeDateTime: {"datetime", "datetime2", "smalldatetime", "datetimeoffset"},
	TypeUUID:     {"uniqueidentifier"},
}

type dbColumn struct {
	dataType  string
	nullable  bool
	maxLength sql.NullInt64
}

// VerifyAgainstDB は全定義を INFORMATION_SCHEMA と突合する。
// 不一致は error を返し、呼び出し側(main)はプロセスを起動させない。
// 「定義と実DBのズレに気づかず稼働する」ことを最悪ケースとして扱う。
func VerifyAgainstDB(ctx context.Context, db *sql.DB, reg *Registry) error {
	for _, t := range reg.All() {
		if err := verifyTable(ctx, db, t); err != nil {
			return fmt.Errorf("meta verify [%s]: %w", t.Name, err)
		}
		log.Printf("meta verify [%s]: ok (%s)", t.Name, t.QualifiedName())
	}
	return nil
}

func verifyTable(ctx context.Context, db *sql.DB, t *TableDef) error {
	cols, err := fetchColumns(ctx, db, t.Schema, t.Table)
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return fmt.Errorf("table %s does not exist", t.QualifiedName())
	}

	// 1) YAML の全列が実在し、型・NULL可否・長さが整合するか。
	//    (逆方向 = YAMLに書いていない物理列は不問: 部分公開を許すため)
	for _, c := range t.Columns {
		dc, ok := cols[strings.ToLower(c.Name)]
		if !ok {
			return fmt.Errorf("column %q not found in database", c.Name)
		}
		if !typeAllowed(c.Type, dc.dataType) {
			return fmt.Errorf("column %q: yaml type %q does not accept sql type %q",
				c.Name, c.Type, dc.dataType)
		}
		// DB が NOT NULL なのに YAML が nullable=true → INSERT が実行時に必ず失敗しうる。起動失敗。
		if c.Nullable && !dc.nullable {
			return fmt.Errorf("column %q: yaml says nullable but database is NOT NULL", c.Name)
		}
		// 逆(YAML=false, DB=NULL可)は安全側の食い違いなので警告のみ。
		if !c.Nullable && dc.nullable && !c.Readonly {
			log.Printf("meta verify [%s]: warn: column %q is nullable in db but not in yaml", t.Name, c.Name)
		}
		if c.MaxLength > 0 && dc.maxLength.Valid && dc.maxLength.Int64 > 0 &&
			int64(c.MaxLength) > dc.maxLength.Int64 {
			return fmt.Errorf("column %q: yaml maxLength %d exceeds database length %d",
				c.Name, c.MaxLength, dc.maxLength.Int64)
		}
	}

	// 2) 主キーが実DBの PK と一致するか。
	pk, err := fetchPrimaryKey(ctx, db, t.Schema, t.Table)
	if err != nil {
		return err
	}
	if !sameSet(t.PrimaryKey, pk) {
		return fmt.Errorf("primaryKey mismatch: yaml=%v db=%v", t.PrimaryKey, pk)
	}

	// 3) rowversion 列の型確認。
	if rv := t.RowVersionColumn; rv != "" {
		dc, ok := cols[strings.ToLower(rv)]
		if !ok {
			return fmt.Errorf("rowVersionColumn %q not found in database", rv)
		}
		if dc.dataType != "rowversion" && dc.dataType != "timestamp" {
			return fmt.Errorf("rowVersionColumn %q has type %q, want rowversion", rv, dc.dataType)
		}
	}
	return nil
}

func fetchColumns(ctx context.Context, db *sql.DB, schema, table string) (map[string]dbColumn, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
		FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]dbColumn{}
	for rows.Next() {
		var name, dataType, isNullable string
		var maxLen sql.NullInt64
		if err := rows.Scan(&name, &dataType, &isNullable, &maxLen); err != nil {
			return nil, err
		}
		out[strings.ToLower(name)] = dbColumn{
			dataType:  strings.ToLower(dataType),
			nullable:  isNullable == "YES",
			maxLength: maxLen,
		}
	}
	return out, rows.Err()
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
		return nil, err
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

func typeAllowed(t ColumnType, sqlType string) bool {
	for _, a := range typeMap[t] {
		if a == sqlType {
			return true
		}
	}
	return false
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]bool{}
	for _, x := range a {
		m[strings.ToLower(x)] = true
	}
	for _, x := range b {
		if !m[strings.ToLower(x)] {
			return false
		}
	}
	return true
}
