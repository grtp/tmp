// Package appdb は「本ツール自身のテーブル(app_*)が置かれるスキーマ」を
// 一元管理する。
//
// ソース上のアプリDB向けSQLは従来どおり dbo.app_xxx と書き、実行直前に
// Q() が接頭辞 `dbo.` を設定スキーマへ書き換える。既定(APP_DB_SCHEMA=dbo)
// では入力をそのまま返すため、挙動は完全に従来と同一。
//
// プロセス内で単一のアプリDB/スキーマしか扱わないため、値は起動時に
// main が Configure() で一度だけ設定するパッケージ変数とする
// (以後は読み取り専用。リクエスト処理中に変更してはならない)。
//
// 注意: この置換が安全なのは、アプリDB系パッケージ(admin/audit/authz/
// conn/meta の app_ 参照)のSQLに現れる `dbo.` が app_ テーブルの
// スキーマ接頭辞に限られるため。アプリDBのSQLに別の意味で `dbo.` を
// 書かないこと(業務DB側のSQLは本パッケージを通らないので無関係)。
//
// 本番構成(2026-07時点)を前提とした注意:
//   - 本番は別ホスト上の既存 SQL Server を間借りする構成で、DB/スキーマの
//     作成は DBA が行う。接続アカウントは SQL Server 認証で、権限は
//     Configure() で設定するスキーマ内に閉じている想定
//     (CREATE SCHEMA / CREATE DATABASE 権限は無い)。
//   - そのため本パッケージ自身がスキーマや DB を作成することは無い。
//     DDL は deploy/initdb/prod-app-schema.sql(本番)/01_init.sql(開発)
//     側の責務であり、本パッケージは「どのスキーマの app_* を読むか」の
//     実行時解決のみを担う。
package appdb

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	schema = "dbo"
	prefix = "dbo."
)

// スキーマ名として受け付ける形式。QuoteIdent も併用するため保守的でよい。
var schemaRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Configure は APP_DB_SCHEMA の値を検証して設定する(起動時に一度だけ)。
func Configure(s string) error {
	if s == "" || s == "dbo" {
		schema, prefix = "dbo", "dbo."
		return nil
	}
	if !schemaRe.MatchString(s) {
		return fmt.Errorf("appdb: APP_DB_SCHEMA %q が不正です(英数字と _ のみ)", s)
	}
	schema = s
	prefix = quoteIdent(s) + "."
	return nil
}

// Schema は設定中のスキーマ名(クォートなし)を返す。カタログ照会の値用。
func Schema() string { return schema }

// Q はアプリDB向けSQLの `dbo.` 接頭辞を設定スキーマへ書き換える。
func Q(sql string) string {
	if prefix == "dbo." {
		return sql
	}
	return strings.ReplaceAll(sql, "dbo.", prefix)
}

// quoteIdent は識別子を [ ] で括る(meta.QuoteIdent と同じ規則。
// 依存を持たないためここに複製する)。
func quoteIdent(name string) string {
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
}
