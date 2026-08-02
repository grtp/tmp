package conn

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"

	mssql "github.com/microsoft/go-mssqldb"
)

// IsUnreachable が誤判定すると,httpapi 側の応答コードが変わる
// (502 connection_unavailable か 500 internal か)。呼び出し側は接続の
// 有効/無効(409/404 相当)とネットワーク到達性(502)を区別するために
// これに依存しているので,分類の境界を固定する。
func TestIsUnreachable(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"ErrDisabled は呼び出し側で 409 に写す", ErrDisabled, false},
		{"ErrNotFound は呼び出し側で 404 に写す", ErrNotFound, false},
		{"ErrDecrypt(鍵変更)", ErrDecrypt, true},
		{"ラップされた ErrDecrypt", fmt.Errorf("wrap: %w", ErrDecrypt), true},
		{"net.OpError(到達不能)", &net.OpError{Op: "dial", Err: errors.New("refused")}, true},
		{"context.DeadlineExceeded", context.DeadlineExceeded, true},
		{"ラップされた DeadlineExceeded", fmt.Errorf("query: %w", context.DeadlineExceeded), true},
		{"mssql ログイン失敗(18456)", mssql.Error{Number: 18456, Message: "login failed"}, true},
		{"mssql DBを開けない(4060)", mssql.Error{Number: 4060, Message: "cannot open database"}, true},
		{"mssql 信頼されない接続(18452)", mssql.Error{Number: 18452, Message: "untrusted"}, true},
		{"mssql その他のエラー番号は分類しない", mssql.Error{Number: 547, Message: "fk violation"}, false},
		{"無関係なエラーは分類しない", errors.New("something else"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsUnreachable(tc.err); got != tc.want {
				t.Errorf("IsUnreachable(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
