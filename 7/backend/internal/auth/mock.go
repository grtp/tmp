package auth

import "f-tool/internal/auth/adguid"

// MockGUID はモックユーザー固定の objectGUID。開発シード
// (deploy/initdb/01_init.sql)がこの GUID に app_user_auth で権限を
// 付与しており，ディレクトリ無しで機能別認可を検証できる。
const MockGUID = adguid.GUID("00000000-0000-0000-0000-000000000001")

// MockAuthenticator はディレクトリを迂回し，固定の1組の資格情報だけを
// 受け付ける。開発専用(LDAP_MOCK=true)。本番では決して配線しない。
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
