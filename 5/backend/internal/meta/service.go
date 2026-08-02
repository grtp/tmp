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

// ErrNotFound = 管理対象として登録されていない,または実テーブルが消えた。
var ErrNotFound = errors.New("managed table not found")

// DBProvider は接続 id から生きたプールを解決する。
// nil = 既定接続。実体は conn.Manager(利用側定義のインターフェース)。
type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

// Service builds TableDefs on demand: ftool_app_managed_tables row (アプリDB) +
// fresh catalog introspection (対象接続), cached briefly.
//
// キャッシュ TTL は短め(既定30秒)。ALTER TABLE の反映が最大 TTL 遅れる
// だけで,通常のページングでは毎回カタログを叩かずに済む。
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

// TableDef は管理テーブル id の実行時定義を返す。
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

// Invalidate drops one cache entry (managed-table 更新/削除時に呼ぶ)。
func (s *Service) Invalidate(id int) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}

// InvalidateAll drops every cache entry. キャッシュ済み def が接続名を
// 抱えているため,接続の更新/削除時はこちらを呼ぶ。
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

	// イントロスペクションは対象接続で行う。接続解決の失敗はそのまま
	// 伝播させ,httpapi が conn.IsUnreachable で 502 に分類する。
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
	fixed, err := ParseFixedColumns(fxJSON)
	if err != nil {
		return nil, fmt.Errorf("meta: table %s.%s: %w", def.Schema, def.Table, err)
	}
	def.Columns, def.InsertBlockedColumns, def.FixedColumns, def.HiddenFixedColumns =
		applyColumnModes(ins.Columns, ins.PrimaryKey, roCSV, hdCSV, fixed)
	return def, nil
}

// ParseFixedColumns decodes the fixed_columns JSON(” と '[]' は「なし」)。
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

// applyColumnModes は登録時の列モード指定をイントロスペクション結果へ重ねる。
// hidden 列は定義ごと除去する(SELECT・フィルタ・batch・CSV・履歴の全てから
// 構造的に消える)。readonly 列は表示のみに落とす。fixed 列は表示のみ+
// Fixed フラグ(保存時に store が値を自動セットする)。
// hidden+fixed の併用可(S45): 列は除去しつつ固定値の自動セットだけが生きる。
// 主キー列への指定は無視する(行の特定に必須のため。登録時にも拒否している)。
// DB 側でリネーム/DROP された列名は黙って無視する(テーブルを壊さない)。
// 第2戻り値は除去した列のうち Required(NOT NULL・デフォルトなし)だったもの:
// 1つでもあると INSERT が必ず失敗する(UI が新規/取込を無効化する根拠)。
// ただし insert に適用される固定値を持つ列は,サーバーが値を入れるので数えない。
// 第3戻り値は正規化済みの固定値指定,第4戻り値は除外+固定の列定義
// (store が値の型変換に使う)。
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
			// 自動 readonly(IDENTITY/計算列/rowversion 等)には固定値を適用できない
			// (書き込み自体が失敗するため)。指定が残っていても黙って無視する。
			f, isFixed := fx[key]
			isFixed = isFixed && !c.Readonly
			if _, hidden := hd[key]; hidden {
				// insert で自動セットされる固定値を持つならサーバーが値を
				// 供給できるため「新規作成不能」には数えない
				// (applyOn=update のみの場合は従来どおり数える)。
				if c.Required && !(isFixed && f.AppliesOnInsert()) {
					blocked = append(blocked, c.Name)
				}
				if isFixed {
					f.Name = c.Name // カタログ上の正確な列名に正規化
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
				f.Name = c.Name // カタログ上の正確な列名に正規化
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

// csvSet は CSV 文字列を小文字キーの集合にする(SQL Server 既定の CI 照合に合わせる)。
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
