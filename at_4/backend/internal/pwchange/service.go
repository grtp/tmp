package pwchange

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"f-tool/internal/meta"
	"f-tool/internal/store"
)

type DBProvider interface {
	DB(ctx context.Context, connID *int) (*sql.DB, error)
}

type Service struct {
	repo *Repo
	dbs  DBProvider
	lock *Lockout
}

func NewService(repo *Repo, dbs DBProvider, lock *Lockout) *Service {
	return &Service{repo: repo, dbs: dbs, lock: lock}
}

func (s *Service) Repo() *Repo       { return s.repo }
func (s *Service) Lockout() *Lockout { return s.lock }

type Account struct {
	Matched int

	Name string

	stored any
}

var (
	ErrNoAccount = errors.New("account not found")

	ErrAmbiguous = errors.New("account is ambiguous")

	ErrMismatch = errors.New("current password mismatch")

	ErrLocked = errors.New("locked")

	ErrPolicy = errors.New("policy violation")

	ErrColumn = errors.New("target column mismatch")

	ErrRace = errors.New("password changed concurrently")
)

type MismatchError struct {
	Remaining int
	Locked    bool

	Alert          bool
	TargetFailures int
}

func (e *MismatchError) Error() string { return ErrMismatch.Error() }
func (e *MismatchError) Unwrap() error { return ErrMismatch }

type LockedError struct{ RetryAfter time.Duration }

func (e *LockedError) Error() string { return ErrLocked.Error() }
func (e *LockedError) Unwrap() error { return ErrLocked }

type PolicyError struct {
	Violations []Violation
	Messages   []string
}

func (e *PolicyError) Error() string { return strings.Join(e.Messages, " / ") }
func (e *PolicyError) Unwrap() error { return ErrPolicy }

func (s *Service) columns(ctx context.Context, db *sql.DB, t *Target) (*meta.Introspection, *meta.Column, *meta.Column, *meta.Column, error) {
	ins, err := meta.Introspect(ctx, db, t.Schema, t.Table)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if ins == nil {
		return nil, nil, nil, nil, fmt.Errorf("%w: テーブル %s.%s が存在しません", ErrColumn, t.Schema, t.Table)
	}
	find := func(name string) *meta.Column {
		for i := range ins.Columns {
			if strings.EqualFold(ins.Columns[i].Name, name) {
				return &ins.Columns[i]
			}
		}
		return nil
	}
	idc := find(t.IDColumn)
	pwc := find(t.PasswordColumn)
	if idc == nil || pwc == nil {
		return nil, nil, nil, nil, fmt.Errorf("%w: ID 列またはパスワード列が見つかりません", ErrColumn)
	}
	var namec *meta.Column
	if t.NameColumn != "" {
		namec = find(t.NameColumn)
		if namec == nil {
			return nil, nil, nil, nil, fmt.Errorf("%w: 名前の列が見つかりません", ErrColumn)
		}
	}
	return ins, idc, pwc, namec, nil
}

func (s *Service) lookupRow(ctx context.Context, db *sql.DB, t *Target, idc, pwc, namec *meta.Column, accountID string) (*Account, error) {
	nameExpr := "NULL"
	if namec != nil {
		nameExpr = meta.QuoteIdent(namec.Name)
	}
	q := fmt.Sprintf("SELECT TOP 2 %s, %s FROM %s.%s WHERE %s = @p1",
		nameExpr, meta.QuoteIdent(pwc.Name),
		meta.QuoteIdent(t.Schema), meta.QuoteIdent(t.Table), meta.QuoteIdent(idc.Name))
	rows, err := db.QueryContext(ctx, q, idParam(idc, accountID))
	if err != nil {
		return nil, fmt.Errorf("pwchange: lookup: %w", err)
	}
	defer rows.Close()
	acct := &Account{}
	for rows.Next() {
		var name, stored any
		if err := rows.Scan(&name, &stored); err != nil {
			return nil, fmt.Errorf("pwchange: scan: %w", err)
		}
		acct.Matched++
		if acct.Matched == 1 {
			acct.stored = stored
			acct.Name = displayName(name, accountID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if acct.Matched > 1 {
		acct.Name = ""
		acct.stored = nil
	}
	return acct, nil
}

func idParam(idc *meta.Column, accountID string) any {
	v := strings.TrimSpace(accountID)
	switch idc.Type {
	case meta.TypeInt, meta.TypeDecimal:

		n := strings.TrimLeft(v, "0")
		if n == "" {
			n = "0"
		}
		for _, c := range n {
			if c < '0' || c > '9' {
				return v
			}
		}
		return n
	}
	return v
}

func displayName(name any, fallback string) string {
	switch v := name.(type) {
	case nil:
		return fallback
	case string:
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
		return fallback
	case []byte:
		if s := strings.TrimSpace(string(v)); s != "" {
			return s
		}
		return fallback
	default:
		return fmt.Sprint(v)
	}
}

func (s *Service) Lookup(ctx context.Context, t *Target, accountID string) (*Account, error) {
	db, err := s.dbs.DB(ctx, &t.ConnectionID)
	if err != nil {
		return nil, err
	}
	_, idc, pwc, namec, err := s.columns(ctx, db, t)
	if err != nil {
		return nil, err
	}
	return s.lookupRow(ctx, db, t, idc, pwc, namec, accountID)
}

func (s *Service) Verify(ctx context.Context, t *Target, subject, accountID, current string) (*Account, error) {
	if locked, retry, err := s.lock.Status(ctx, t.ID, subject); err != nil {
		return nil, err
	} else if locked {
		return nil, &LockedError{RetryAfter: retry}
	}
	db, err := s.dbs.DB(ctx, &t.ConnectionID)
	if err != nil {
		return nil, err
	}
	_, idc, pwc, namec, err := s.columns(ctx, db, t)
	if err != nil {
		return nil, err
	}
	acct, err := s.lookupRow(ctx, db, t, idc, pwc, namec, accountID)
	if err != nil {
		return nil, err
	}
	switch acct.Matched {
	case 0:
		return acct, ErrNoAccount
	case 1:
	default:
		return acct, ErrAmbiguous
	}
	if err := s.verifyStored(ctx, t, subject, acct, current); err != nil {
		return acct, err
	}
	return acct, nil
}

func (s *Service) verifyStored(ctx context.Context, t *Target, subject string, acct *Account, current string) error {
	salt, err := s.repo.Salt(ctx, t.ID)
	if err != nil {
		return err
	}
	digest, err := t.Recipe.Digest(current, salt)
	if err != nil {
		return err
	}
	if !t.Recipe.Matches(acct.stored, digest) {
		fr, err := s.lock.RecordFailure(ctx, t.ID, subject, t.MaxFailures, t.LockFor())
		if err != nil {
			return err
		}
		return &MismatchError{Remaining: fr.Remaining, Locked: fr.Locked, Alert: fr.Alert, TargetFailures: fr.TargetFailures}
	}
	if err := s.lock.Reset(ctx, t.ID, subject); err != nil {
		return err
	}
	return nil
}

func (s *Service) Change(ctx context.Context, t *Target, subject, accountID, current, newPw string, identity []string) (*Account, error) {
	if locked, retry, err := s.lock.Status(ctx, t.ID, subject); err != nil {
		return nil, err
	} else if locked {
		return nil, &LockedError{RetryAfter: retry}
	}

	if vios := t.Policy.Check(newPw, current, identity); len(vios) > 0 {
		msgs := make([]string, 0, len(vios))
		for _, v := range vios {
			msgs = append(msgs, t.Policy.ViolationMessage(v))
		}
		return nil, &PolicyError{Violations: vios, Messages: msgs}
	}

	db, err := s.dbs.DB(ctx, &t.ConnectionID)
	if err != nil {
		return nil, err
	}
	ins, idc, pwc, namec, err := s.columns(ctx, db, t)
	if err != nil {
		return nil, err
	}
	acct, err := s.lookupRow(ctx, db, t, idc, pwc, namec, accountID)
	if err != nil {
		return nil, err
	}
	switch acct.Matched {
	case 0:
		return acct, ErrNoAccount
	case 1:
	default:
		return acct, ErrAmbiguous
	}
	if err := s.verifyStored(ctx, t, subject, acct, current); err != nil {
		return acct, err
	}

	salt, err := s.repo.Salt(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	digest, err := t.Recipe.Digest(newPw, salt)
	if err != nil {
		return nil, err
	}

	sets := []string{fmt.Sprintf("%s = @p1", meta.QuoteIdent(pwc.Name))}
	args := []any{t.Recipe.Encode(digest)}

	for _, f := range t.FixedColumns {
		var col *meta.Column
		for i := range ins.Columns {
			if strings.EqualFold(ins.Columns[i].Name, f.Name) {
				col = &ins.Columns[i]
				break
			}
		}
		if col == nil {
			return nil, fmt.Errorf("%w: 併せて更新する列 %q が見つかりません", ErrColumn, f.Name)
		}
		v, err := store.FixedValue(f, col)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrColumn, err)
		}
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = @p%d", meta.QuoteIdent(col.Name), len(args)))
	}
	args = append(args, idParam(idc, accountID), acct.stored)
	q := fmt.Sprintf("UPDATE %s.%s SET %s WHERE %s = @p%d AND %s = @p%d",
		meta.QuoteIdent(t.Schema), meta.QuoteIdent(t.Table), strings.Join(sets, ", "),
		meta.QuoteIdent(idc.Name), len(args)-1, meta.QuoteIdent(pwc.Name), len(args))
	res, err := db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("pwchange: update: %w", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return nil, ErrRace
	}
	return acct, nil
}

func ValidateColumns(ins *meta.Introspection, idCol, pwCol, nameCol string, recipe Recipe) (string, string, string, error) {
	find := func(name string) *meta.Column {
		for i := range ins.Columns {
			if strings.EqualFold(ins.Columns[i].Name, strings.TrimSpace(name)) {
				return &ins.Columns[i]
			}
		}
		return nil
	}
	idc := find(idCol)
	if idc == nil {
		return "", "", "", fmt.Errorf("%w: ID 列 %q は存在しません", ErrRecipe, idCol)
	}
	if idc.Type != meta.TypeString && idc.Type != meta.TypeInt && idc.Type != meta.TypeDecimal {
		return "", "", "", fmt.Errorf("%w: ID 列は文字列型か数値型の列を指定してください", ErrRecipe)
	}
	pwc := find(pwCol)
	if pwc == nil {
		return "", "", "", fmt.Errorf("%w: パスワード列 %q は存在しません", ErrRecipe, pwCol)
	}
	if strings.EqualFold(idc.Name, pwc.Name) {
		return "", "", "", fmt.Errorf("%w: ID 列とパスワード列に同じ列は指定できません", ErrRecipe)
	}
	isBinary := strings.Contains(pwc.SqlType, "binary")
	switch {
	case isBinary && recipe.Output != OutBinary:
		return "", "", "", fmt.Errorf("%w: パスワード列が %s のため出力形式は binary を選んでください", ErrRecipe, pwc.SqlType)
	case !isBinary && recipe.Output == OutBinary:
		return "", "", "", fmt.Errorf("%w: 出力形式 binary は varbinary 列にのみ使えます(列の型: %s)", ErrRecipe, pwc.SqlType)
	case !isBinary && pwc.Type != meta.TypeString:
		return "", "", "", fmt.Errorf("%w: パスワード列は文字列型か varbinary の列を指定してください", ErrRecipe)
	}
	if pwc.Type == meta.TypeString && pwc.MaxLength > 0 && recipe.EncodedLength() > pwc.MaxLength {
		return "", "", "", fmt.Errorf("%w: ハッシュの長さ(%d 文字)がパスワード列の長さ(%d)を超えます", ErrRecipe, recipe.EncodedLength(), pwc.MaxLength)
	}
	name := ""
	if strings.TrimSpace(nameCol) != "" {
		nc := find(nameCol)
		if nc == nil {
			return "", "", "", fmt.Errorf("%w: 名前の列 %q は存在しません", ErrRecipe, nameCol)
		}
		if strings.EqualFold(nc.Name, pwc.Name) {
			return "", "", "", fmt.Errorf("%w: 名前の列にパスワード列は指定できません", ErrRecipe)
		}
		name = nc.Name
	}
	return idc.Name, pwc.Name, name, nil
}
