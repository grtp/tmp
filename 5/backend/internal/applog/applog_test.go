package applog

import (
	"context"
	"testing"
)

func TestRequestIDRoundTrip(t *testing.T) {
	ctx := WithRequestID(context.Background(), "abc123")
	if got := RequestID(ctx); got != "abc123" {
		t.Fatalf("RequestID = %q, want abc123", got)
	}
}

func TestRequestIDAbsent(t *testing.T) {
	if got := RequestID(context.Background()); got != "" {
		t.Fatalf("未設定なら空文字を返す想定: %q", got)
	}
}

func TestNewRequestIDIsUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		id := NewRequestID()
		if id == "" || id == "unknown" {
			t.Fatalf("不正な ID: %q", id)
		}
		if seen[id] {
			t.Fatalf("ID が重複した: %q", id)
		}
		seen[id] = true
	}
}

func TestParseLevel(t *testing.T) {
	cases := map[string]string{
		"debug": "DEBUG", "info": "INFO", "WARN": "WARN",
		"warning": "WARN", "error": "ERROR", "": "INFO", "なにか": "INFO",
	}
	for in, want := range cases {
		if got := parseLevel(in).String(); got != want {
			t.Errorf("parseLevel(%q) = %s, want %s", in, got, want)
		}
	}
}
