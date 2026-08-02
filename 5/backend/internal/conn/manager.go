package conn

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// Manager は登録接続ごとの *sql.DB を遅延 open してキャッシュする。
//
//   - connID == nil -> 既定接続(アプリ自身の DB。main が所有し Close しない)
//   - connID != nil -> ftool_app_connections から DSN を構築して遅延 open + キャッシュ
//
// 外部接続のプールは控えめな上限にする(接続が増えても既定 DB を圧迫しない)。
type Manager struct {
	def  *sql.DB
	repo *Repo

	mu    sync.Mutex
	pools map[int]*sql.DB
}

func NewManager(def *sql.DB, repo *Repo) *Manager {
	return &Manager{def: def, repo: repo, pools: map[int]*sql.DB{}}
}

// DB は接続 id のプールを返す(nil = 既定接続)。
func (m *Manager) DB(ctx context.Context, connID *int) (*sql.DB, error) {
	if connID == nil {
		return m.def, nil
	}
	id := *connID

	m.mu.Lock()
	if db, ok := m.pools[id]; ok {
		m.mu.Unlock()
		return db, nil
	}
	m.mu.Unlock()

	// DSN 構築(復号)はロック外で行い,失敗をキャッシュしない。
	dsn, err := m.repo.DSN(ctx, id)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return nil, fmt.Errorf("conn: open pool %d: %w", id, err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)

	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.pools[id]; ok { // 競合した open は片方を捨てる
		db.Close()
		return existing, nil
	}
	m.pools[id] = db
	return db, nil
}

// Invalidate closes and drops the pool (接続の更新/削除/無効化時)。
// (*sql.DB).Close は実行中のクエリの完了を待つのでリクエスト中でも安全。
func (m *Manager) Invalidate(id int) {
	m.mu.Lock()
	db, ok := m.pools[id]
	delete(m.pools, id)
	m.mu.Unlock()
	if ok {
		db.Close()
	}
}

// Test pings a DSN with its own short timeout (保存前テスト/疎通確認用)。
func (m *Manager) Test(ctx context.Context, dsn string) error {
	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	tctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return db.PingContext(tctx)
}

// Close shuts down every non-default pool (プロセス終了時)。
func (m *Manager) Close() {
	m.mu.Lock()
	pools := m.pools
	m.pools = map[int]*sql.DB{}
	m.mu.Unlock()
	for _, db := range pools {
		db.Close()
	}
}
