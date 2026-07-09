package auth

import (
	"crypto/tls"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/go-ldap/ldap/v3"

	"tablemaint/internal/auth/adguid"
)

// GUIDFormat はディレクトリが返す GUID 属性の形式。
//
//	ad-binary:   AD objectGUID。16byte mixed-endian バイナリ(adguid で正規化)。
//	uuid-string: OpenLDAP entryUUID 等。テキストの UUID。
type GUIDFormat string

const (
	GUIDFormatADBinary   GUIDFormat = "ad-binary"
	GUIDFormatUUIDString GUIDFormat = "uuid-string"
)

type LDAPConfig struct {
	URL          string
	BaseDN       string
	UserFilter   string // must contain a single %s for the username
	BindDN       string
	BindPassword string
	StartTLS     bool

	// 属性マップ(本番AD / 開発OpenLDAP の差を吸収)
	AttrGUID        string // objectGUID | entryUUID
	AttrUsername    string // sAMAccountName | uid
	AttrDisplayName string
	AttrMail        string
	GUIDFormat      GUIDFormat
}

type LDAPAuthenticator struct{ cfg LDAPConfig }

func NewLDAPAuthenticator(cfg LDAPConfig) *LDAPAuthenticator {
	if cfg.AttrGUID == "" {
		cfg.AttrGUID = "objectGUID"
	}
	if cfg.AttrUsername == "" {
		cfg.AttrUsername = "sAMAccountName"
	}
	if cfg.AttrDisplayName == "" {
		cfg.AttrDisplayName = "displayName"
	}
	if cfg.AttrMail == "" {
		cfg.AttrMail = "mail"
	}
	if cfg.GUIDFormat == "" {
		cfg.GUIDFormat = GUIDFormatADBinary
	}
	return &LDAPAuthenticator{cfg: cfg}
}

// Authenticate performs the classic search-then-bind flow:
//
//  1. bind as a service account and search for the user entry,
//  2. re-bind as that entry's DN with the supplied password.
//
// Step 2 is the actual authentication: a successful bind is proof the
// password is correct. The directory does the hash comparison, not us.
func (a *LDAPAuthenticator) Authenticate(username, password string) (*Identity, error) {
	// RFC 4513 §5.1.2: a bind with a DN but an empty password is an
	// "unauthenticated bind" that many servers treat as success. Reject
	// up front so an empty password can never authenticate anyone.
	if username == "" || password == "" {
		return nil, ErrInvalidCredentials
	}

	conn, err := a.dial()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if a.cfg.BindDN != "" {
		if err := conn.Bind(a.cfg.BindDN, a.cfg.BindPassword); err != nil {
			return nil, fmt.Errorf("service bind failed: %w", err)
		}
	}

	// EscapeFilter prevents LDAP injection via the username field.
	// entryUUID のような operational 属性は "*" では返らないため、
	// 必要な属性は必ず明示的に要求する。
	filter := fmt.Sprintf(a.cfg.UserFilter, ldap.EscapeFilter(username))
	res, err := conn.Search(ldap.NewSearchRequest(
		a.cfg.BaseDN,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, 0, false, // size limit 2: detect ambiguous matches
		filter,
		[]string{"cn", a.cfg.AttrDisplayName, a.cfg.AttrMail, a.cfg.AttrUsername, a.cfg.AttrGUID},
		nil,
	))
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}
	if len(res.Entries) != 1 {
		return nil, ErrInvalidCredentials
	}
	entry := res.Entries[0]

	guid, err := a.extractGUID(entry)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", a.cfg.AttrGUID, err)
	}

	// The real check: bind as the user.
	if err := conn.Bind(entry.DN, password); err != nil {
		if ldap.IsErrorWithCode(err, ldap.LDAPResultInvalidCredentials) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("user bind failed: %w", err)
	}

	return &Identity{
		ObjectGUID:  guid,
		Username:    username,
		DisplayName: firstNonEmpty(entry.GetAttributeValue(a.cfg.AttrDisplayName), entry.GetAttributeValue("cn"), username),
		Email:       entry.GetAttributeValue(a.cfg.AttrMail),
	}, nil
}

var uuidTextRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// extractGUID normalizes the directory's GUID attribute into the canonical
// lowercase string form regardless of the on-wire representation.
func (a *LDAPAuthenticator) extractGUID(entry *ldap.Entry) (adguid.GUID, error) {
	switch a.cfg.GUIDFormat {
	case GUIDFormatUUIDString:
		// OpenLDAP entryUUID: 既にテキストの UUID。adguid.FromLDAP に通すと
		// 文字列のバイト列として壊れるため、検証と小文字化だけ行う。
		s := entry.GetAttributeValue(a.cfg.AttrGUID)
		if !uuidTextRe.MatchString(s) {
			return "", fmt.Errorf("attribute is not a textual UUID: %q", s)
		}
		return adguid.GUID(strings.ToLower(s)), nil
	default: // GUIDFormatADBinary
		// AD objectGUID: 16 raw bytes; normalize at this boundary and never
		// let the raw form escape (see adguid).
		return adguid.FromLDAP(entry.GetRawAttributeValue(a.cfg.AttrGUID))
	}
}

func (a *LDAPAuthenticator) dial() (*ldap.Conn, error) {
	conn, err := ldap.DialURL(a.cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("ldap dial: %w", err)
	}
	if a.cfg.StartTLS {
		host := a.cfg.URL
		if u, perr := url.Parse(a.cfg.URL); perr == nil {
			host = u.Hostname()
		}
		if err := conn.StartTLS(&tls.Config{ServerName: host}); err != nil {
			conn.Close()
			return nil, fmt.Errorf("starttls: %w", err)
		}
	}
	return conn, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
