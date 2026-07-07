package auth

import (
	"crypto/tls"
	"fmt"
	"net/url"

	"github.com/go-ldap/ldap/v3"

	"tablemaint/internal/auth/adguid"
)

type LDAPConfig struct {
	URL          string
	BaseDN       string
	UserFilter   string // must contain a single %s for the username
	BindDN       string
	BindPassword string
	StartTLS     bool
}

type LDAPAuthenticator struct{ cfg LDAPConfig }

func NewLDAPAuthenticator(cfg LDAPConfig) *LDAPAuthenticator {
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
	filter := fmt.Sprintf(a.cfg.UserFilter, ldap.EscapeFilter(username))
	res, err := conn.Search(ldap.NewSearchRequest(
		a.cfg.BaseDN,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, 0, false, // size limit 2: detect ambiguous matches
		filter,
		[]string{"cn", "displayName", "mail", "sAMAccountName", "objectGUID"},
		nil,
	))
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}
	if len(res.Entries) != 1 {
		return nil, ErrInvalidCredentials
	}
	entry := res.Entries[0]

	// objectGUID is 16 raw bytes; normalize at this boundary and never
	// let the raw form escape (see adguid).
	guid, err := adguid.FromLDAP(entry.GetRawAttributeValue("objectGUID"))
	if err != nil {
		return nil, fmt.Errorf("objectGUID: %w", err)
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
		DisplayName: firstNonEmpty(entry.GetAttributeValue("displayName"), entry.GetAttributeValue("cn"), username),
		Email:       entry.GetAttributeValue("mail"),
	}, nil
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
