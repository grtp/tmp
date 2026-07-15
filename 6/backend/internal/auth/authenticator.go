// Package auth resolves identities. Authentication (who are you) lives
// here; authorization (what may you do) lives in auth/roles.
package auth

import (
	"errors"

	"f-tool/internal/auth/adguid"
)

// ErrInvalidCredentials covers every "the user got it wrong" case so the
// HTTP layer maps all authentication failures to one 401 without leaking
// whether the username exists.
var ErrInvalidCredentials = errors.New("invalid credentials")

// Identity is what a successful authentication yields. ObjectGUID is the
// stable key (usernames can be renamed); the rest is display metadata.
type Identity struct {
	ObjectGUID  adguid.GUID
	Username    string
	DisplayName string
	Email       string
}

// Authenticator is the single seam between the HTTP layer and any concrete
// identity backend. main.go decides the implementation (Composition Root).
type Authenticator interface {
	Authenticate(username, password string) (*Identity, error)
}
