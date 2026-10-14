package conn

import (
	"context"
	"errors"
	"net"

	mssql "github.com/microsoft/go-mssqldb"
)

func IsUnreachable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrDisabled) || errors.Is(err, ErrNotFound) {
		return false
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

		switch sqlErr.Number {
		case 18456, 4060, 18452:
			return true
		}
	}
	return errors.Is(err, ErrDecrypt)
}
