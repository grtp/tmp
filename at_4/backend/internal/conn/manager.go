package conn

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

type Manager struct {
	def  *sql.DB
	repo *Repo

	mu    sync.Mutex
	pools map[int]*sql.DB
}

func NewManager(def *sql.DB, repo *Repo) *Manager {
	return &Manager{def: def, repo: repo, pools: map[int]*sql.DB{}}
}

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
	if existing, ok := m.pools[id]; ok {
		db.Close()
		return existing, nil
	}
	m.pools[id] = db
	return db, nil
}

func (m *Manager) Invalidate(id int) {
	m.mu.Lock()
	db, ok := m.pools[id]
	delete(m.pools, id)
	m.mu.Unlock()
	if ok {
		db.Close()
	}
}

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

func (m *Manager) Close() {
	m.mu.Lock()
	pools := m.pools
	m.pools = map[int]*sql.DB{}
	m.mu.Unlock()
	for _, db := range pools {
		db.Close()
	}
}
