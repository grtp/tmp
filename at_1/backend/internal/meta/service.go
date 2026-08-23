package meta

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"f-tool/internal/appdb"
)

var ErrNotFound = errors.New("managed table not found")

type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

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

func (s *Service) Invalidate(id int) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}

func (s *Service) InvalidateAll() {
	s.mu.Lock()
	s.cache = map[int]cacheEntry{}
	s.mu.Unlock()
}

func (s *Service) load(ctx context.Context, id int) (*TableDef, error) {
	const q = `
SELECT m.schema_name, m.table_name, m.display_name, COALESCE(m.description, N''),
       m.readonly_columns, m.hidden_columns, m.fixed_columns,
       m.sort_order, m.enabled, m.connection_id, COALESCE(c.name, N'')
FROM dbo.ftool_app_managed_tables m
LEFT JOIN dbo.ftool_app_connections c ON c.id = m.connection_id
WHERE m.id = @p1`

	def := &TableDef{ID: id}
	var connID sql.NullInt64
	var roCSV, hdCSV, fxJSON string
	err := s.appDB.QueryRowContext(ctx, appdb.Q(q), id).Scan(
		&def.Schema, &def.Table, &def.DisplayName, &def.Description,
		&roCSV, &hdCSV, &fxJSON,
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

	targetDB, err := s.dbs.DB(ctx, def.ConnectionID)
	if err != nil {
		return nil, err
	}
	ins, err := Introspect(ctx, targetDB, def.Schema, def.Table)
	if err != nil {
		return nil, err
	}
	if ins == nil {

		return nil, fmt.Errorf("%w: physical table %s.%s is gone", ErrNotFound, def.Schema, def.Table)
	}
	if len(ins.PrimaryKey) == 0 {

		return nil, fmt.Errorf("meta: table %s.%s has no primary key", def.Schema, def.Table)
	}
	def.PrimaryKey = ins.PrimaryKey
	def.RowVersionColumn = ins.RowVersionColumn
	fixed, err := ParseFixedColumns(fxJSON)
	if err != nil {
		return nil, fmt.Errorf("meta: table %s.%s: %w", def.Schema, def.Table, err)
	}
	def.Columns, def.InsertBlockedColumns, def.FixedColumns, def.HiddenFixedColumns =
		applyColumnModes(ins.Columns, ins.PrimaryKey, roCSV, hdCSV, fixed)
	return def, nil
}

func ParseFixedColumns(raw string) ([]FixedColumn, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return nil, nil
	}
	var out []FixedColumn
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("invalid fixed_columns json: %w", err)
	}
	return out, nil
}

func applyColumnModes(cols []Column, pk []string, roCSV, hdCSV string, fixed []FixedColumn) ([]Column, []string, []FixedColumn, []Column) {
	ro, hd := csvSet(roCSV), csvSet(hdCSV)
	fx := map[string]FixedColumn{}
	for _, f := range fixed {
		fx[strings.ToLower(f.Name)] = f
	}
	if len(ro) == 0 && len(hd) == 0 && len(fx) == 0 {
		return cols, nil, nil, nil
	}
	pkSet := map[string]struct{}{}
	for _, p := range pk {
		pkSet[strings.ToLower(p)] = struct{}{}
	}
	out := make([]Column, 0, len(cols))
	var blocked []string
	var fxOut []FixedColumn
	var hiddenFx []Column
	for _, c := range cols {
		key := strings.ToLower(c.Name)
		if _, isPK := pkSet[key]; !isPK {

			f, isFixed := fx[key]
			isFixed = isFixed && !c.Readonly
			if _, hidden := hd[key]; hidden {

				if c.Required && !(isFixed && f.AppliesOnInsert()) {
					blocked = append(blocked, c.Name)
				}
				if isFixed {
					f.Name = c.Name
					fxOut = append(fxOut, f)
					c.Readonly = true
					c.Required = false
					c.Fixed = true
					hiddenFx = append(hiddenFx, c)
				}
				continue
			}
			if isFixed {
				c.Readonly = true
				c.Required = false
				c.Fixed = true
				f.Name = c.Name
				fxOut = append(fxOut, f)
			} else if _, readonly := ro[key]; readonly {
				c.Readonly = true
				c.Required = false
			}
		}
		out = append(out, c)
	}
	return out, blocked, fxOut, hiddenFx
}

func csvSet(csv string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, s := range strings.Split(csv, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			out[strings.ToLower(s)] = struct{}{}
		}
	}
	return out
}
