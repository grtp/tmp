package adguid

import (
	"regexp"
	"testing"
)

var guidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// FuzzFromLDAP は任意バイト列で「16byte 以外は必ずエラー,成功時は必ず
// 小文字の正準 GUID」という不変条件を検証する。
func FuzzFromLDAP(f *testing.F) {
	f.Add([]byte("0123456789abcdef"))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, data []byte) {
		g, err := FromLDAP(data)
		if len(data) != 16 {
			if err == nil {
				t.Fatalf("len=%d でエラーになっていない", len(data))
			}
			return
		}
		if err != nil {
			t.Fatalf("16byte でエラー: %v", err)
		}
		if !guidRe.MatchString(string(g)) {
			t.Fatalf("正準形式でない: %q", g)
		}
	})
}
