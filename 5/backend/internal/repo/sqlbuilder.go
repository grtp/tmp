package repo

import (
	"fmt"
	"strings"
)

// このファイルの2つのビルダーは「@pN プレースホルダの採番と引数リストの
// 同期」という壊れやすい不変条件を1箇所に封じるためのもの。
// 以前は各リポジトリメソッドが同じ形のローカルクロージャ(add := func)を
// 持っていたが,5箇所に増えたため型に昇格した。
// どちらもゼロ値でそのまま使える。

// whereBuilder は WHERE 句(条件を AND 結合)を組み立てる。
type whereBuilder struct {
	conds []string
	args  []any
}

// add は条件を1つ追加する。cond は @p%d を1つ含む書式文字列で,
// %d には追加後の引数番号が入る。
func (b *whereBuilder) add(cond string, v any) {
	b.args = append(b.args, v)
	b.conds = append(b.conds, fmt.Sprintf(cond, len(b.args)))
}

// where は " WHERE ..." と引数を返す。条件が無ければ空文字を返す。
func (b *whereBuilder) where() (string, []any) {
	if len(b.conds) == 0 {
		return "", b.args
	}
	return " WHERE " + strings.Join(b.conds, " AND "), b.args
}

// setBuilder は UPDATE の SET 句(col = @pN をカンマ結合)を組み立てる。
// 部分更新(nil フィールドは変更しない)のリポジトリメソッドで使う。
type setBuilder struct {
	sets []string
	args []any
}

// add は「col = @pN」を1つ追加する。
func (b *setBuilder) add(col string, v any) {
	b.args = append(b.args, v)
	b.sets = append(b.sets, fmt.Sprintf("%s = @p%d", col, len(b.args)))
}

// empty は SET 対象が1つも無いか(部分更新の早期リターン判定用)。
func (b *setBuilder) empty() bool { return len(b.sets) == 0 }

// arg は SET 以外の引数(WHERE の id 等)を追加し,その @pN 番号を返す。
func (b *setBuilder) arg(v any) int {
	b.args = append(b.args, v)
	return len(b.args)
}

// clause は SET 句本体(カンマ結合)を返す。
func (b *setBuilder) clause() string { return strings.Join(b.sets, ", ") }
