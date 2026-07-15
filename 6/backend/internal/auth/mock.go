package auth

import "f-tool/internal/auth/adguid"

// MockGUID is the fixed objectGUID the mock user carries. The dev seed SQL
// (deploy/initdb) registers this GUID in app_user_roles so role-based
// behavior can be exercised without AD.
const MockGUID = adguid.GUID("00000000-0000-0000-0000-000000000001")

// MockAuthenticator bypasses the directory and accepts a single hardcoded
// credential pair. Dev only (LDAP_MOCK=true); never wired in production.
type MockAuthenticator struct {
	Username string
	Password string
}

func (m *MockAuthenticator) Authenticate(username, password string) (*Identity, error) {
	if username == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	if username != m.Username || password != m.Password {
		return nil, ErrInvalidCredentials
	}
	return &Identity{
		ObjectGUID:  MockGUID,
		Username:    username,
		DisplayName: username + " (mock)",
		Email:       username + "@mock.local",
	}, nil
}
