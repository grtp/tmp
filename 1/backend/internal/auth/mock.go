package auth

// MockAuthenticator bypasses the directory and accepts a single hardcoded
// credential pair.  Use only in development (LDAP_MOCK=true).
type MockAuthenticator struct {
	Username string
	Password string
}

func (m *MockAuthenticator) Authenticate(username, password string) (*User, error) {
	if username == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	if username != m.Username || password != m.Password {
		return nil, ErrInvalidCredentials
	}
	return &User{
		Username:    username,
		DN:          "mock",
		DisplayName: username + " (mock)",
		Email:       username + "@mock.local",
	}, nil
}
