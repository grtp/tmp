package conn

import (
	"context"
	"errors"
	"net"

	mssql "github.com/microsoft/go-mssqldb"
)

// IsUnreachable は「接続先に届かない/入れない」系のエラーを分類する。
// httpapi が汎用 500 ではなく 502 connection_unavailable を返すため。
// 対象: TCP 到達不能・タイムアウト・ログイン失敗・復号失敗(鍵変更)。
func IsUnreachable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrDisabled) || errors.Is(err, ErrNotFound) {
		return false // 呼び出し側で 404/409 に写像する
	}
	var netErr *net.OpError
	if errors.As(err, &netErr) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var sqlErr mssql.Error
	if errors.As(err, &sqlErr) {
		// 18456: ログイン失敗 / 4060: DB を開けない / 18452: 信頼されない接続
		switch sqlErr.Number {
		case 18456, 4060, 18452:
			return true
		}
	}
	return errors.Is(err, ErrDecrypt)
}
