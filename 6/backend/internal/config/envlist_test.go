package config

import (
	"reflect"
	"testing"
)

// TRUSTED_PROXIES の分解。ここが緩いと空文字が CIDR として gin に渡り
// 起動失敗する,あるいは意図しない範囲を信頼してしまう。
func TestEnvList(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"未設定", "", nil},
		{"空白のみ", "   ", nil},
		{"1件", "10.89.0.0/24", []string{"10.89.0.0/24"}},
		{"複数", "10.89.0.0/24,10.88.0.0/16", []string{"10.89.0.0/24", "10.88.0.0/16"}},
		{"空白入り", " 10.89.0.0/24 , 127.0.0.1 ", []string{"10.89.0.0/24", "127.0.0.1"}},
		{"末尾カンマ", "10.89.0.0/24,", []string{"10.89.0.0/24"}},
		{"連続カンマ", "10.89.0.0/24,,127.0.0.1", []string{"10.89.0.0/24", "127.0.0.1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TEST_LIST", tc.raw)
			if got := envList("TEST_LIST"); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("envList(%q) = %#v, want %#v", tc.raw, got, tc.want)
			}
		})
	}
}
