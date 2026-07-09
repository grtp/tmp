package conn

import (
	"context"
	"errors"
	"net"

	mssql "github.com/microsoft/go-mssqldb"
)

// IsUnreachable classifies "接続先に届かない/入れない" errors so httpapi can
// return 502 connection_unavailable instead of a generic 500.
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
		// 18456: login failed / 4060: cannot open database / 18452: not trusted
		switch sqlErr.Number {
		case 18456, 4060, 18452:
			return true
		}
	}
	return errors.Is(err, ErrDecrypt)
}
