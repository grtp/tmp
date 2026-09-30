package conn

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

const gcmNonceSize = 12

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

func Decrypt(key, blob []byte) ([]byte, error) {
	if len(blob) < gcmNonceSize+16 {
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

		return nil, errors.Join(ErrDecrypt, err)
	}
	return plaintext, nil
}

var ErrDecrypt = errors.New("conn: decrypt failed (CONN_ENC_KEY changed?)")
