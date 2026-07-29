// Package auth は身元(認証 = 誰であるか)を解決する。
// 認可(何をしてよいか)は internal/authz が担う。
package auth

import (
	"errors"

	"f-tool/internal/auth/adguid"
)

// ErrInvalidCredentials は「ユーザーの入力誤り」全般を1つに束ねる。
// HTTP 層が認証失敗を一律 401 に写像することで，ユーザー名の存在有無を
// 漏らさないため。
var ErrInvalidCredentials = errors.New("invalid credentials")

// Identity は認証成功の結果。ObjectGUID が安定キー(ユーザー名は
// 改名され得る)で，残りは表示用メタデータ。
type Identity struct {
	ObjectGUID  adguid.GUID
	Username    string
	DisplayName string
	Email       string
}

// Authenticator は HTTP 層と認証バックエンドの唯一の継ぎ目。
// 実装の選択は main.go(Composition Root)が行う。
type Authenticator interface {
	Authenticate(username, password string) (*Identity, error)
}
