package adguid

import (
	"encoding/hex"
	"fmt"
)

type GUID string

func FromLDAP(raw []byte) (GUID, error) {
	if len(raw) != 16 {
		return "", fmt.Errorf("adguid: expected 16 bytes, got %d", len(raw))
	}
	b := make([]byte, 16)
	b[0], b[1], b[2], b[3] = raw[3], raw[2], raw[1], raw[0]
	b[4], b[5] = raw[5], raw[4]
	b[6], b[7] = raw[7], raw[6]
	copy(b[8:], raw[8:])

	dst := make([]byte, 32)
	hex.Encode(dst, b)
	return GUID(fmt.Sprintf("%s-%s-%s-%s-%s",
		dst[0:8], dst[8:12], dst[12:16], dst[16:20], dst[20:32])), nil
}
