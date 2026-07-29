// Package session はログインセッションを Valkey(Redis 互換)に保存する。
// キーは httpOnly cookie で運ぶ推測不能なランダムセッション ID。
//
// 設計:
//   - キー sess:{sid}。値はログイン時点の身元情報 JSON。
//   - TTL はスライディング: Get のたびに GETEX で延長する(既定30分)。
//   - 権限(auth_level)はセッションに入れない。毎リクエスト DB から解決する
//     ことで，admin による権限変更が再ログインなしで反映される。
//   - usersess:{guid} に発行済み sid の SET を持つ(将来の強制失効用)。
//   - Valkey 断は fail-closed: ログインは 503，既存リクエストは 401 相当。
package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"f-tool/internal/auth/adguid"
)

// ErrNotFound means the session is missing or expired(ユーザー操作で回復可能)。
// それ以外のエラーは Valkey 障害(インフラ)として扱う。
var ErrNotFound = errors.New("session not found")

// Claims はログイン時点の身元スナップショット。
// 権限は含めない(毎リクエスト DB から解決。パッケージコメント参照)。
type Claims struct {
	ObjectGUID  adguid.GUID `json:"guid"`
	Username    string      `json:"username"`
	DisplayName string      `json:"displayName"`
	Email       string      `json:"email"`
	LoginAt     time.Time   `json:"loginAt"`
	IP          string      `json:"ip"`
}

type Store struct {
	rdb        *redis.Client
	ttl        time.Duration
	cookieName string
	secure     bool
}

// NewStore returns a Store; ttl はスライディング有効期限(既定30分)。
func NewStore(rdb *redis.Client, ttl time.Duration, cookieName string, secure bool) *Store {
	return &Store{rdb: rdb, ttl: ttl, cookieName: cookieName, secure: secure}
}

func key(sid string) string        { return "sess:" + sid }
func userKey(g adguid.GUID) string { return "usersess:" + string(g) }

func (s *Store) Create(ctx context.Context, cl Claims) (string, error) {
	// 256bit ランダム。推測不能であることがセッションの安全性の全て。
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("session: rand: %w", err)
	}
	sid := base64.RawURLEncoding.EncodeToString(raw)

	body, err := json.Marshal(cl)
	if err != nil {
		return "", fmt.Errorf("session: marshal: %w", err)
	}

	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, key(sid), body, s.ttl)
	pipe.SAdd(ctx, userKey(cl.ObjectGUID), sid)
	// SET 自体にも TTL を張り，ログアウト漏れの sid が無限に溜まらないようにする。
	pipe.Expire(ctx, userKey(cl.ObjectGUID), 24*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("session: create: %w", err)
	}
	return sid, nil
}

// Get は sid の Claims を返し，TTL を先送りする(GETEX)。
func (s *Store) Get(ctx context.Context, sid string) (*Claims, error) {
	body, err := s.rdb.GetEx(ctx, key(sid), s.ttl).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("session: get: %w", err)
	}
	var cl Claims
	if err := json.Unmarshal(body, &cl); err != nil {
		return nil, fmt.Errorf("session: unmarshal: %w", err)
	}
	return &cl, nil
}

func (s *Store) Delete(ctx context.Context, sid string, guid adguid.GUID) error {
	pipe := s.rdb.TxPipeline()
	pipe.Del(ctx, key(sid))
	pipe.SRem(ctx, userKey(guid), sid)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("session: delete: %w", err)
	}
	return nil
}

// RevokeUser removes every session of a user (権限剥奪時などに使用)。
func (s *Store) RevokeUser(ctx context.Context, guid adguid.GUID) error {
	sids, err := s.rdb.SMembers(ctx, userKey(guid)).Result()
	if err != nil {
		return fmt.Errorf("session: revoke: %w", err)
	}
	keys := make([]string, 0, len(sids)+1)
	for _, sid := range sids {
		keys = append(keys, key(sid))
	}
	keys = append(keys, userKey(guid))
	if err := s.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("session: revoke del: %w", err)
	}
	return nil
}

func (s *Store) SIDFromRequest(r *http.Request) string {
	ck, err := r.Cookie(s.cookieName)
	if err != nil {
		return ""
	}
	return ck.Value
}

// Max-Age は付けない(ブラウザ側はセッションcookie扱い)。寿命の正は Valkey の TTL。
func (s *Store) Cookie(sid string) *http.Cookie {
	return &http.Cookie{
		Name:     s.cookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Store) ExpiredCookie() *http.Cookie {
	return &http.Cookie{
		Name:     s.cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}
}
