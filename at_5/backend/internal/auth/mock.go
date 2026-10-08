package auth

import "f-tool/internal/auth/adguid"

const MockGUID = adguid.GUID("00000000-0000-0000-0000-000000000001")

type MockAuthenticator struct {
	Username string
	Password string

	EmployeeNo string
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
		Department:  "開発部",
		Title:       "テスター",
		MemberOf:    []string{"CN=Testers,DC=example,DC=local"},
		EmployeeNo:  m.EmployeeNo,
	}, nil
}
