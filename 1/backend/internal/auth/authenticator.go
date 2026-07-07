package auth

// Authenticator is the single seam between the HTTP layer and any
// concrete identity backend (LDAP, mock, …).
type Authenticator interface {
	Authenticate(username, password string) (*User, error)
}
