package meta

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrNotFound = 管理対象として登録されていない、または実テーブルが消えた。
var ErrNotFound = errors.New("managed table not found")

// DBProvider resolves a connection id into a live pool.
// nil = 既定接続。実体は conn.Manager(利用側定義のインターフェース)。
type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

// Service builds TableDefs on demand: app_managed_tables row (アプリDB) +
// fresh catalog introspection (対象接続), cached briefly.
//
// キャッシュ TTL は短め(既定30秒)。ALTER TABLE の反映が最大 TTL 遅れる
// だけで、通常のページングでは毎回カタログを叩かずに済む。
type Service struct {
	appDB *sql.DB
	dbs   DBProvider
	ttl   time.Duration

	mu    sync.Mutex
	cache map[int]cacheEntry
}

type cacheEntry struct {
	def     *TableDef
	expires time.Time
}

func NewService(appDB *sql.DB, dbs DBProvider, ttl time.Duration) *Service {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &Service{appDB: appDB, dbs: dbs, ttl: ttl, cache: map[int]cacheEntry{}}
}

// TableDef returns the runtime definition for a managed table id.
// enabled=false のテーブルも返す(呼び出し側が判断する)。
func (s *Service) TableDef(ctx context.Context, id int) (*TableDef, error) {
	s.mu.Lock()
	if e, ok := s.cache[id]; ok && time.Now().Before(e.expires) {
		s.mu.Unlock()
		return e.def, nil
	}
	s.mu.Unlock()

	def, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.cache[id] = cacheEntry{def: def, expires: time.Now().Add(s.ttl)}
	s.mu.Unlock()
	return def, nil
}

// Invalidate drops the cache entry (managed-table 更新/削除時に呼ぶ)。
func (s *Service) Invalidate(id int) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}

// InvalidateAll drops every cache entry。キャッシュ済み def が接続名を
// 抱えているため、接続の更新/削除時はこちらを呼ぶ。
func (s *Service) InvalidateAll() {
	s.mu.Lock()
	s.cache = map[int]cacheEntry{}
	s.mu.Unlock()
}

func (s *Service) load(ctx context.Context, id int) (*TableDef, error) {
	const q = `
SELECT m.schema_name, m.table_name, m.display_name, COALESCE(m.description, N''),
       m.sort_order, m.enabled, m.connection_id, COALESCE(c.name, N'')
FROM dbo.app_managed_tables m
LEFT JOIN dbo.app_connections c ON c.id = m.connection_id
WHERE m.id = @p1`

	def := &TableDef{ID: id}
	var connID sql.NullInt64
	err := s.appDB.QueryRowContext(ctx, q, id).Scan(
		&def.Schema, &def.Table, &def.DisplayName, &def.Description,
		&def.SortOrder, &def.Enabled, &connID, &def.ConnectionName)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("meta: load managed table: %w", err)
	}
	if connID.Valid {
		v := int(connID.Int64)
		def.ConnectionID = &v
	}

	// イントロスペクションは対象接続で行う。接続解決の失敗はそのまま
	// 伝播させ、httpapi が conn.IsUnreachable で 502 に分類する。
	targetDB, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return nil, err
	}
	ins, err := Introspect(ctx, targetDB, def.Schema, def.Table)
	if err != nil {
		return nil, err
	}
	if ins == nil {
		// 登録後に実テーブルが DROP された。データ破損ではなく「無い」扱い。
		return nil, fmt.Errorf("%w: physical table %s.%s is gone", ErrNotFound, def.Schema, def.Table)
	}
	if len(ins.PrimaryKey) == 0 {
		// 登録時に PK を要求しているので通常起きない(後から PK を落とした場合)。
		return nil, fmt.Errorf("meta: table %s.%s has no primary key", def.Schema, def.Table)
	}
	def.PrimaryKey = ins.PrimaryKey
	def.RowVersionColumn = ins.RowVersionColumn
	def.Columns = ins.Columns
	return def, nil
}
