package pwchange

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"f-tool/internal/appdb"
	"f-tool/internal/auth/adguid"
	"f-tool/internal/conn"
	"f-tool/internal/meta"
)

var (
	ErrNotFound = errors.New("pwchange target not found")

	ErrConflict = errors.New("pwchange target conflict")

	ErrSaltUnset = errors.New("pwchange salt is not set")
)

type Target struct {
	ID                int
	ConnectionID      int
	ConnectionName    string
	ConnectionColor   string
	ConnectionEnabled bool

	Schema         string
	Table          string
	IDColumn       string
	PasswordColumn string

	NameColumn string

	FixedColumns []meta.FixedColumn

	Recipe Recipe
	Policy Policy

	MaxFailures int
	LockMinutes int

	SaltSet   bool
	SaltSetAt *time.Time
	SaltSetBy string

	TestAccountID string
	Enabled       bool

	CreatedBy string
	UpdatedBy string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (t *Target) Usable() bool {
	return t.Enabled && t.SaltSet && t.ConnectionEnabled
}

func (t *Target) LockFor() time.Duration { return time.Duration(t.LockMinutes) * time.Minute }

type TargetParams struct {
	ConnectionID   int
	Schema         string
	Table          string
	IDColumn       string
	PasswordColumn string
	NameColumn     string
	FixedJSON      string
	Recipe         Recipe
	Policy         Policy
	MaxFailures    int
	LockMinutes    int
	Salt           string
	TestAccountID  string
	Enabled        bool
	Actor          string
}

type TargetUpdate struct {
	IDColumn       *string
	PasswordColumn *string
	NameColumn     *string
	FixedJSON      *string
	Recipe         *Recipe
	Policy         *Policy
	MaxFailures    *int
	LockMinutes    *int
	Salt           *string
	TestAccountID  *string
	Enabled        *bool
}

type Repo struct {
	db  *sql.DB
	key []byte
}

func NewRepo(db *sql.DB, key []byte) *Repo { return &Repo{db: db, key: key} }

const targetCols = `
t.id, t.connection_id, c.name, COALESCE(c.color, N''), c.enabled,
t.schema_name, t.table_name, t.id_column, t.password_column, COALESCE(t.name_column, N''),
t.fixed_columns, t.hash_algorithm, t.hash_template, t.hash_encoding, t.hash_output, t.hash_iterations,
CASE WHEN t.salt_enc IS NULL THEN 0 ELSE 1 END, t.salt_set_at, COALESCE(t.salt_set_by, N''),
t.max_failures, t.lock_minutes,
t.policy_min_len, t.policy_max_len, t.policy_min_classes, t.policy_ascii_only, t.policy_forbid_same, t.policy_forbid_identity,
COALESCE(t.test_account_id, N''), t.enabled, t.created_by, t.updated_by, t.created_at, t.updated_at`

const targetFrom = `
FROM dbo.ftool_app_pwchange_targets t
JOIN dbo.ftool_app_connections c ON c.id = t.connection_id`

func scanTarget(row interface{ Scan(...any) error }) (*Target, error) {
	var (
		t         Target
		fxJSON    string
		alg       string
		enc       string
		out       string
		saltSetAt sql.NullTime
	)
	err := row.Scan(
		&t.ID, &t.ConnectionID, &t.ConnectionName, &t.ConnectionColor, &t.ConnectionEnabled,
		&t.Schema, &t.Table, &t.IDColumn, &t.PasswordColumn, &t.NameColumn,
		&fxJSON, &alg, &t.Recipe.Template, &enc, &out, &t.Recipe.Iterations,
		&t.SaltSet, &saltSetAt, &t.SaltSetBy,
		&t.MaxFailures, &t.LockMinutes,
		&t.Policy.MinLen, &t.Policy.MaxLen, &t.Policy.MinClasses, &t.Policy.ASCIIOnly, &t.Policy.ForbidSame, &t.Policy.ForbidIdentity,
		&t.TestAccountID, &t.Enabled, &t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("pwchange: scan target: %w", err)
	}
	t.Recipe.Algorithm = Algorithm(alg)
	t.Recipe.Encoding = Encoding(enc)
	t.Recipe.Output = Output(out)
	if saltSetAt.Valid {
		at := saltSetAt.Time
		t.SaltSetAt = &at
	}
	fx, err := meta.ParseFixedColumns(fxJSON)
	if err != nil {
		return nil, fmt.Errorf("pwchange: target %d: %w", t.ID, err)
	}
	t.FixedColumns = fx
	return &t, nil
}

func (r *Repo) List(ctx context.Context) ([]Target, error) {
	rows, err := r.db.QueryContext(ctx, appdb.Q(`SELECT `+targetCols+targetFrom+` ORDER BY c.name, t.id`))
	if err != nil {
		return nil, fmt.Errorf("pwchange: list: %w", err)
	}
	defer rows.Close()
	out := []Target{}
	for rows.Next() {
		t, err := scanTarget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (r *Repo) Get(ctx context.Context, id int) (*Target, error) {
	return scanTarget(r.db.QueryRowContext(ctx, appdb.Q(`SELECT `+targetCols+targetFrom+` WHERE t.id = @p1`), id))
}

func (r *Repo) Salt(ctx context.Context, id int) (string, error) {
	var enc []byte
	err := r.db.QueryRowContext(ctx, appdb.Q(`SELECT salt_enc FROM dbo.ftool_app_pwchange_targets WHERE id = @p1`), id).Scan(&enc)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("pwchange: load salt: %w", err)
	}
	if enc == nil {
		return "", ErrSaltUnset
	}
	plain, err := conn.Decrypt(r.key, enc)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func (r *Repo) Create(ctx context.Context, p TargetParams) (*Target, error) {

	var saltEnc []byte
	if p.Salt != "" {
		enc, err := conn.Encrypt(r.key, []byte(p.Salt))
		if err != nil {
			return nil, err
		}
		saltEnc = enc
	}
	fx := p.FixedJSON
	if strings.TrimSpace(fx) == "" {
		fx = "[]"
	}
	var id int
	err := r.db.QueryRowContext(ctx, appdb.Q(`
INSERT INTO dbo.ftool_app_pwchange_targets
    (connection_id, schema_name, table_name, id_column, password_column, name_column, fixed_columns,
     hash_algorithm, hash_template, hash_encoding, hash_output, hash_iterations,
     salt_enc, salt_set_at, salt_set_by,
     max_failures, lock_minutes,
     policy_min_len, policy_max_len, policy_min_classes, policy_ascii_only, policy_forbid_same, policy_forbid_identity,
     test_account_id, enabled, created_by, updated_by)
OUTPUT INSERTED.id
VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7,
        @p8, @p9, @p10, @p11, @p12,
        @p13, CASE WHEN @p13 IS NULL THEN NULL ELSE SYSUTCDATETIME() END, CASE WHEN @p13 IS NULL THEN NULL ELSE @p24 END,
        @p14, @p15,
        @p16, @p17, @p18, @p19, @p20, @p21,
        @p22, @p23, @p24, @p24)`),
		p.ConnectionID, p.Schema, p.Table, p.IDColumn, p.PasswordColumn, nullIfEmpty(p.NameColumn), fx,
		string(p.Recipe.Algorithm), p.Recipe.Template, string(p.Recipe.Encoding), string(p.Recipe.Output), p.Recipe.Iterations,
		saltEnc,
		p.MaxFailures, p.LockMinutes,
		p.Policy.MinLen, p.Policy.MaxLen, p.Policy.MinClasses, p.Policy.ASCIIOnly, p.Policy.ForbidSame, p.Policy.ForbidIdentity,
		nullIfEmpty(p.TestAccountID), p.Enabled, p.Actor,
	).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("%w: この接続には既に変更先が登録されています", ErrConflict)
		}
		return nil, fmt.Errorf("pwchange: create: %w", err)
	}
	return r.Get(ctx, id)
}

func (r *Repo) Update(ctx context.Context, id int, u TargetUpdate, actor string) (*Target, error) {
	var sets []string
	var args []any
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", col, len(args)))
	}
	if u.IDColumn != nil {
		add("id_column", *u.IDColumn)
	}
	if u.PasswordColumn != nil {
		add("password_column", *u.PasswordColumn)
	}
	if u.NameColumn != nil {
		add("name_column", nullIfEmpty(*u.NameColumn))
	}
	if u.FixedJSON != nil {
		fx := *u.FixedJSON
		if strings.TrimSpace(fx) == "" {
			fx = "[]"
		}
		add("fixed_columns", fx)
	}
	if u.Recipe != nil {
		add("hash_algorithm", string(u.Recipe.Algorithm))
		add("hash_template", u.Recipe.Template)
		add("hash_encoding", string(u.Recipe.Encoding))
		add("hash_output", string(u.Recipe.Output))
		add("hash_iterations", u.Recipe.Iterations)
	}
	if u.Policy != nil {
		add("policy_min_len", u.Policy.MinLen)
		add("policy_max_len", u.Policy.MaxLen)
		add("policy_min_classes", u.Policy.MinClasses)
		add("policy_ascii_only", u.Policy.ASCIIOnly)
		add("policy_forbid_same", u.Policy.ForbidSame)
		add("policy_forbid_identity", u.Policy.ForbidIdentity)
	}
	if u.MaxFailures != nil {
		add("max_failures", *u.MaxFailures)
	}
	if u.LockMinutes != nil {
		add("lock_minutes", *u.LockMinutes)
	}
	if u.Salt != nil {
		enc, err := conn.Encrypt(r.key, []byte(*u.Salt))
		if err != nil {
			return nil, err
		}
		add("salt_enc", enc)
		add("salt_set_by", actor)
		sets = append(sets, "salt_set_at = SYSUTCDATETIME()")
	}
	if u.TestAccountID != nil {
		add("test_account_id", nullIfEmpty(*u.TestAccountID))
	}
	if u.Enabled != nil {
		add("enabled", *u.Enabled)
	}
	if len(sets) == 0 {
		return r.Get(ctx, id)
	}
	add("updated_by", actor)
	args = append(args, id)
	q := fmt.Sprintf(`UPDATE dbo.ftool_app_pwchange_targets SET %s, updated_at = SYSUTCDATETIME() WHERE id = @p%d`,
		strings.Join(sets, ", "), len(args))
	res, err := r.db.ExecContext(ctx, appdb.Q(q), args...)
	if err != nil {
		return nil, fmt.Errorf("pwchange: update: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

func (r *Repo) Delete(ctx context.Context, id int) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("pwchange: begin: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, appdb.Q(`DELETE FROM dbo.ftool_app_pwchange_targets WHERE id = @p1`), id)
	if err != nil {
		return fmt.Errorf("pwchange: delete: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, appdb.Q(`
DELETE FROM dbo.ftool_app_resource_auth WHERE resource_type = N'pwchange_target' AND resource_id = @p1`), id); err != nil {
		return fmt.Errorf("pwchange: clear resource auth: %w", err)
	}
	return tx.Commit()
}

func (r *Repo) HasConsent(ctx context.Context, targetID int, guid adguid.GUID, employeeNo string) (bool, error) {
	var n int
	err := r.db.QueryRowContext(ctx, appdb.Q(`
SELECT COUNT(*) FROM dbo.ftool_app_pwchange_consents
WHERE target_id = @p1 AND object_guid = CAST(@p2 AS UNIQUEIDENTIFIER) AND employee_no = @p3`),
		targetID, string(guid), employeeNo).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("pwchange: has consent: %w", err)
	}
	return n > 0, nil
}

func (r *Repo) ConsentedTargets(ctx context.Context, guid adguid.GUID, employeeNo string) (map[int]struct{}, error) {
	rows, err := r.db.QueryContext(ctx, appdb.Q(`
SELECT target_id FROM dbo.ftool_app_pwchange_consents
WHERE object_guid = CAST(@p1 AS UNIQUEIDENTIFIER) AND employee_no = @p2`), string(guid), employeeNo)
	if err != nil {
		return nil, fmt.Errorf("pwchange: consented targets: %w", err)
	}
	defer rows.Close()
	out := map[int]struct{}{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = struct{}{}
	}
	return out, rows.Err()
}

func (r *Repo) SetConsent(ctx context.Context, targetID int, guid adguid.GUID, employeeNo string) error {
	_, err := r.db.ExecContext(ctx, appdb.Q(`
MERGE dbo.ftool_app_pwchange_consents WITH (HOLDLOCK) AS t
USING (SELECT @p1 AS target_id, CAST(@p2 AS UNIQUEIDENTIFIER) AS object_guid) AS s
ON t.target_id = s.target_id AND t.object_guid = s.object_guid
WHEN MATCHED THEN
    UPDATE SET employee_no = @p3, consented_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (target_id, object_guid, employee_no) VALUES (@p1, @p2, @p3);`),
		targetID, string(guid), employeeNo)
	if err != nil {
		return fmt.Errorf("pwchange: set consent: %w", err)
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func isUniqueViolation(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "2627") || strings.Contains(msg, "2601") ||
		strings.Contains(msg, "duplicate key") || strings.Contains(msg, "UNIQUE")
}

func FixedColumnsJSON(fx []meta.FixedColumn) (string, error) {
	if len(fx) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(fx)
	if err != nil {
		return "", fmt.Errorf("pwchange: fixed columns: %w", err)
	}
	return string(b), nil
}
