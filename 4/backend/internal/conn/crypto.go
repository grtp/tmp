// Package conn は登録された接続先 SQL Server を管理する:
// 暗号化された資格情報の保存(ftool_app_connections),DSN 構築,
// 接続 id ごとの *sql.DB 遅延プール。
//
// 「既定接続」(アプリ自身の DB = env MSSQL_DSN) はこのパッケージの管理外で,
// connection_id = nil として Manager.DB が既定プールを返す。
package conn

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// gcmNonceSize は password_enc の先頭に連結する nonce 長。
// 将来鍵ローテーションが必要になったら先頭 1byte を key-id に使える余地を
// 残すため,blob 形式の解釈はこのパッケージに閉じている。
const gcmNonceSize = 12

// LoadKey は base64 の CONN_ENC_KEY を復号し,厳密に 32byte を要求する
// (AES-256). 空文字は「未設定」としてエラー。
func LoadKey(b64 string) ([]byte, error) {
	if b64 == "" {
		return nil, errors.New("conn: CONN_ENC_KEY is not set (base64 32 bytes, e.g. `openssl rand -base64 32`)")
	}
	key, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("conn: CONN_ENC_KEY is not valid base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("conn: CONN_ENC_KEY must decode to 32 bytes, got %d", len(key))
	}
	return key, nil
}

// Encrypt は nonce || AES-256-GCM(平文) を返す。
func Encrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("conn: cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("conn: gcm: %w", err)
	}
	nonce := make([]byte, gcmNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("conn: nonce: %w", err)
	}
	return append(nonce, gcm.Seal(nil, nonce, plaintext, nil)...), nil
}

// Decrypt は Encrypt の逆変換。
func Decrypt(key, blob []byte) ([]byte, error) {
	if len(blob) < gcmNonceSize+16 { // nonce + GCM タグ
		return nil, errors.New("conn: ciphertext too short")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("conn: cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("conn: gcm: %w", err)
	}
	plaintext, err := gcm.Open(nil, blob[:gcmNonceSize], blob[gcmNonceSize:], nil)
	if err != nil {
		// 鍵ローテーション後の旧データ等。呼び出し側は「接続不可」(502)として扱う。
		return nil, errors.Join(ErrDecrypt, err)
	}
	return plaintext, nil
}

// ErrDecrypt marks decryption failures (CONN_ENC_KEY 変更後の旧データ等)。
var ErrDecrypt = errors.New("conn: decrypt failed (CONN_ENC_KEY changed?)")
