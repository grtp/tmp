// Package adguid は Active Directory の objectGUID を正規化する。
//
// AD は objectGUID を Microsoft 独自の mixed-endian な生バイト16個で返す。
// 本パッケージが LDAP 境界で正準の文字列形式へ変換し,境界より先では
// 生バイトを一切扱わない。
package adguid

import (
	"encoding/hex"
	"fmt"
)

// GUID は正規化済み objectGUID(小文字の "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")。
// LDAP 層より先で許される唯一の表現であり,SQL Server にもこの形で保存する
// (UNIQUEIDENTIFIER は直接受け付ける)。
type GUID string

// FromLDAP は生16byteの objectGUID 属性を Microsoft 正準の文字列形式へ変換する。
//
//	bytes  0-3  : Data1(リトルエンディアン)
//	bytes  4-5  : Data2(リトルエンディアン)
//	bytes  6-7  : Data3(リトルエンディアン)
//	bytes  8-15 : Data4(そのまま)
//
// この並べ替えにより,AD ツール(Get-ADUser,ADUC)や SQL Server の
// UNIQUEIDENTIFIER が表示する文字列と一致する。
func FromLDAP(raw []byte) (GUID, error) {
	if len(raw) != 16 {
		return "", fmt.Errorf("adguid: expected 16 bytes, got %d", len(raw))
	}
	b := make([]byte, 16)
	b[0], b[1], b[2], b[3] = raw[3], raw[2], raw[1], raw[0] // Data1
	b[4], b[5] = raw[5], raw[4]                             // Data2
	b[6], b[7] = raw[7], raw[6]                             // Data3
	copy(b[8:], raw[8:])                                    // Data4

	dst := make([]byte, 32)
	hex.Encode(dst, b)
	return GUID(fmt.Sprintf("%s-%s-%s-%s-%s",
		dst[0:8], dst[8:12], dst[12:16], dst[16:20], dst[20:32])), nil
}
