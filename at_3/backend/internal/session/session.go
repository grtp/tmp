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

var ErrNotFound = errors.New("session not found")

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

func NewStore(rdb *redis.Client, ttl time.Duration, cookieName string, secure bool) *Store {
	return &Store{rdb: rdb, ttl: ttl, cookieName: cookieName, secure: secure}
}

func key(sid string) string        { return "sess:" + sid }
func userKey(g adguid.GUID) string { return "usersess:" + string(g) }

func (s *Store) Create(ctx context.Context, cl Claims) (string, error) {

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

	pipe.Expire(ctx, userKey(cl.ObjectGUID), 24*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("session: create: %w", err)
	}
	return sid, nil
}

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
