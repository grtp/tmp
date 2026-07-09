// Package adguid normalizes Active Directory objectGUID values.
//
// AD returns objectGUID as 16 raw bytes in Microsoft's mixed-endian
// layout. This package converts them into the canonical string form at
// the LDAP boundary; nothing past that boundary handles raw bytes.
package adguid

import (
	"encoding/hex"
	"fmt"
)

// GUID is a normalized objectGUID ("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
// lowercase). This is the ONLY representation allowed past the LDAP layer,
// and the value stored in SQL Server (UNIQUEIDENTIFIER accepts it directly).
type GUID string

// FromLDAP converts the raw 16-byte objectGUID attribute into Microsoft's
// canonical string form.
//
//	bytes  0-3  : Data1, little-endian
//	bytes  4-5  : Data2, little-endian
//	bytes  6-7  : Data3, little-endian
//	bytes  8-15 : Data4, as-is
//
// Reordering here makes the string match what AD tools (Get-ADUser, ADUC)
// and SQL Server's UNIQUEIDENTIFIER display.
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
