package conn

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := LoadKey(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := testKey(t)
	for _, plain := range []string{"", "p@ss w0rd!", "日本語パスワード", "very-long-" + string(bytes.Repeat([]byte{'x'}, 200))} {
		blob, err := Encrypt(key, []byte(plain))
		if err != nil {
			t.Fatal(err)
		}
		got, err := Decrypt(key, blob)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != plain {
			t.Errorf("round trip mismatch: got %q want %q", got, plain)
		}
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	blob, err := Encrypt(testKey(t), []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	other, _ := LoadKey(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32)))
	if _, err := Decrypt(other, blob); err == nil {
		t.Error("expected error with wrong key")
	}
}

func TestDecryptRejectsTampered(t *testing.T) {
	key := testKey(t)
	blob, err := Encrypt(key, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	blob[len(blob)-1] ^= 0xff
	if _, err := Decrypt(key, blob); err == nil {
		t.Error("expected error for tampered ciphertext")
	}
}

func TestLoadKeyValidation(t *testing.T) {
	if _, err := LoadKey(""); err == nil {
		t.Error("empty key must fail")
	}
	if _, err := LoadKey("not-base64!!"); err == nil {
		t.Error("invalid base64 must fail")
	}
	if _, err := LoadKey(base64.StdEncoding.EncodeToString([]byte("short"))); err == nil {
		t.Error("short key must fail")
	}
}
