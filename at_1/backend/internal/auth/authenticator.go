package auth

import (
	"errors"

	"f-tool/internal/auth/adguid"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type Identity struct {
	ObjectGUID  adguid.GUID
	Username    string
	DisplayName string
	Email       string
}

type Authenticator interface {
	Authenticate(username, password string) (*Identity, error)
}
