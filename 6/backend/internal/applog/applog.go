// Package applog は全パッケージ共通のログ設定(log/slog)。
//
// 方針:
//   - 出力は既定でテキスト(key=value)。`podman logs` を人が読む前提のため
//     JSON より読みやすく,grep もしやすい。集約基盤へ流す場合は
//     LOG_FORMAT=json に切り替える
//   - リクエストごとに request_id を振り,ハンドラ内のログと gin の
//     アクセスログを同じ ID で突き合わせられるようにする
//   - 値そのもの(SQL の引数・業務データ)はログに載せない。載せるのは
//     「どの操作が・どの表で・どう失敗したか」まで
package applog

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"os"
	"strings"
)

type ctxKey struct{}

// Setup は既定ロガーを差し替える。format は "text"(既定)/ "json",
// level は debug/info/warn/error(既定 info)。
func Setup(format, level string) {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}
	var h slog.Handler
	if strings.EqualFold(format, "json") {
		h = slog.NewJSONHandler(os.Stderr, opts)
	} else {
		h = slog.NewTextHandler(os.Stderr, opts)
	}
	slog.SetDefault(slog.New(h))
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// NewRequestID は短いランダム ID を返す(相関用。推測されて困る値ではない)。
func NewRequestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b[:])
}

// WithRequestID はリクエスト ID を context に載せる。
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// RequestID は context のリクエスト ID を返す(無ければ "")。
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

// From は request_id を付けたロガーを返す。ハンドラ・リポジトリはこれを使う。
func From(ctx context.Context) *slog.Logger {
	if id := RequestID(ctx); id != "" {
		return slog.Default().With("request_id", id)
	}
	return slog.Default()
}
