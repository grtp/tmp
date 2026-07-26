package adguid

import "testing"

func TestFromLDAP(t *testing.T) {
	tests := []struct {
		name string
		raw  []byte
		want GUID
	}{
		{
			name: "mixed endian reorder",
			raw: []byte{
				0xd4, 0xc3, 0xb2, 0xa1, // Data1 (LE) -> a1b2c3d4
				0xf6, 0xe5, //             Data2 (LE) -> e5f6
				0x08, 0x97, //             Data3 (LE) -> 9708
				0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67,
			},
			want: "a1b2c3d4-e5f6-9708-89ab-cdef01234567",
		},
		{
			name: "all zero",
			raw:  make([]byte, 16),
			want: "00000000-0000-0000-0000-000000000000",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := FromLDAP(tt.raw)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("got %s, want %s", got, tt.want)
			}
		})
	}
}

func TestFromLDAPRejectsWrongLength(t *testing.T) {
	for _, n := range []int{0, 15, 17} {
		if _, err := FromLDAP(make([]byte, n)); err == nil {
			t.Errorf("length %d: expected error", n)
		}
	}
}
