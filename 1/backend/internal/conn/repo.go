package conn

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

var (
	// ErrNotFound / ErrConflict / ErrInUse は httpapi が 404/409 に写像する。
	ErrNotFound = errors.New("connection not found")
	ErrConflict = errors.New("connection conflict")
	ErrInUse    = errors.New("connection is referenced by managed tables")
	// ErrDisabled = 無効化された接続の使用。
	ErrDisabled = errors.New("connection is disabled")
)

// Connection は API/UI 向けの形。パスワードは決して載せない。
type Connection struct {
	ID           int
	Name         string
	Host         string
	Port         int
	DatabaseName string
	Username     string
	Options      string
	// SchemaName: "" = 制限なし(全スキーマ)。非空 = この接続はそのスキーマの
	// テーブルだけ登録・閲覧できる(アクセス制限)。
	SchemaName string
	Enabled    bool
	CreatedBy  string
}

// CreateParams は新規接続をパスワード込みで運ぶ
// (パスワードを運ぶのは CreateParams / UpdateParams だけ)。
type CreateParams struct {
	Name         string
	Host         string
	Port         int
	DatabaseName string
	Username     string
	Password     string
	Options      string
	SchemaName   string
	Enabled      bool
	CreatedBy    string
}

// UpdateParams is a partial update; nil フィールドは変更しない。
type UpdateParams struct {
	Name         *string
	Host         *string
	Port         *int
	DatabaseName *string
	Username     *string
	Password     *string // nil = 変更なし
	Options      *string
	SchemaName   *string
	Enabled      *bool
}

type Repo struct {
	db  *sql.DB // アプリ自身の DB
	key []byte  // AES-256 鍵
}

func NewRepo(db *sql.DB, key []byte) *Repo { return &Repo{db: db, key: key} }

const connCols = `id, name, host, port, database_name, username, COALESCE(options, N''), COALESCE(schema_name, N''), enabled, created_by`

func scanConn(row interface{ Scan(...any) error }) (*Connection, error) {
	var c Connection
	err := row.Scan(&c.ID, &c.Name, &c.Host, &c.Port, &c.DatabaseName,
		&c.Username, &c.Options, &c.SchemaName, &c.Enabled, &c.CreatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("conn: scan: %w", err)
	}
	return &c, nil
}

func (r *Repo) List(ctx context.Context) ([]Connection, error) {
	rows, err := r.query(ctx,
		`SELECT `+connCols+` FROM dbo.ftool_app_connections ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("conn: list: %w", err)
	}
	defer rows.Close()

	out := []Connection{}
	for rows.Next() {
		c, err := scanConn(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *Repo) Get(ctx context.Context, id int) (*Connection, error) {
	return scanConn(r.queryRow(ctx,
		`SELECT `+connCols+` FROM dbo.ftool_app_connections WHERE id = @p1`, id))
}

func (r *Repo) Create(ctx context.Context, p CreateParams) (*Connection, error) {
	enc, err := Encrypt(r.key, []byte(p.Password))
	if err != nil {
		return nil, err
	}
	var id int
	err = r.queryRow(ctx, `
		INSERT INTO dbo.ftool_app_connections
			(name, host, port, database_name, username, password_enc, options, schema_name, enabled, created_by, updated_by)
		OUTPUT INSERTED.id
		VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p10)`,
		p.Name, p.Host, p.Port, p.DatabaseName, p.Username, enc,
		nullIfEmpty(p.Options), nullIfEmpty(p.SchemaName), p.Enabled, p.CreatedBy).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: 接続名 %q は既に存在します", ErrConflict, p.Name)
		}
		return nil, fmt.Errorf("conn: create: %w", err)
	}
	return r.Get(ctx, id)
}

func (r *Repo) Update(ctx context.Context, id int, p UpdateParams, updatedBy string) (*Connection, error) {
	var sets []string
	var args []any
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", col, len(args)))
	}
	if p.Name != nil {
		add("name", *p.Name)
	}
	if p.Host != nil {
		add("host", *p.Host)
	}
	if p.Port != nil {
		add("port", *p.Port)
	}
	if p.DatabaseName != nil {
		add("database_name", *p.DatabaseName)
	}
	if p.Username != nil {
		add("username", *p.Username)
	}
	if p.Password != nil {
		enc, err := Encrypt(r.key, []byte(*p.Password))
		if err != nil {
			return nil, err
		}
		add("password_enc", enc)
	}
	if p.Options != nil {
		add("options", nullIfEmpty(*p.Options))
	}
	if p.SchemaName != nil {
		add("schema_name", nullIfEmpty(*p.SchemaName))
	}
	if p.Enabled != nil {
		add("enabled", *p.Enabled)
	}
	if len(sets) == 0 {
		return r.Get(ctx, id)
	}
	add("updated_by", updatedBy)
	args = append(args, id)

	q := fmt.Sprintf(`UPDATE dbo.ftool_app_connections SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		strings.Join(sets, ", "), len(args))
	res, err := r.exec(ctx, q, args...)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: 接続名が重複しています", ErrConflict)
		}
		return nil, fmt.Errorf("conn: update: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

// Delete は ftool_app_managed_tables から参照されている接続の削除を拒否する。
// FK 制約は最後の安全網で，通常はここで ErrInUse を返す。
func (r *Repo) Delete(ctx context.Context, id int) error {
	var refs int
	if err := r.queryRow(ctx,
		`SELECT COUNT(*) FROM dbo.ftool_app_managed_tables WHERE connection_id = @p1`, id).Scan(&refs); err != nil {
		return fmt.Errorf("conn: ref count: %w", err)
	}
	if refs > 0 {
		return fmt.Errorf("%w (%d件)", ErrInUse, refs)
	}
	res, err := r.exec(ctx, `DELETE FROM dbo.ftool_app_connections WHERE id = @p1`, id)
	if err != nil {
		return fmt.Errorf("conn: delete: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DSN は接続を読み出して復号し，sqlserver:// DSN を構築する。
// enabled=0 は ErrDisabled(登録済みテーブルからの誤用防止)。
func (r *Repo) DSN(ctx context.Context, id int) (string, error) {
	var (
		c   Connection
		enc []byte
	)
	err := r.queryRow(ctx, `
		SELECT id, name, host, port, database_name, username, password_enc,
		       COALESCE(options, N''), enabled
		FROM dbo.ftool_app_connections WHERE id = @p1`, id).
		Scan(&c.ID, &c.Name, &c.Host, &c.Port, &c.DatabaseName, &c.Username,
			&enc, &c.Options, &c.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("conn: load dsn: %w", err)
	}
	if !c.Enabled {
		return "", ErrDisabled
	}
	password, err := Decrypt(r.key, enc)
	if err != nil {
		return "", err
	}
	return BuildDSN(c.Host, c.Port, c.DatabaseName, c.Username, string(password), c.Options), nil
}

// BuildDSN は資格情報をエスケープした go-mssqldb の URL DSN を構築する。
// dial timeout を短めに固定し，死んだ接続先で OS の TCP タイムアウトを
// 待たされないようにする。
func BuildDSN(host string, port int, database, username, password, options string) string {
	u := url.URL{
		Scheme: "sqlserver",
		User:   url.UserPassword(username, password),
		Host:   fmt.Sprintf("%s:%d", host, port),
	}
	q := url.Values{}
	q.Set("database", database)
	q.Set("dial timeout", "5")
	u.RawQuery = q.Encode()
	dsn := u.String()
	if options != "" {
		dsn += "&" + strings.TrimPrefix(options, "&")
	}
	return dsn
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// isUniqueViolation: mssql エラー 2601/2627。メッセージ判定(表示分類用)。
func isUniqueViolation(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "2627") || strings.Contains(msg, "2601") ||
		strings.Contains(msg, "duplicate key") || strings.Contains(msg, "UNIQUE")
}
