package auth

import (
	"crypto/tls"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/go-ldap/ldap/v3"

	"f-tool/internal/auth/adguid"
)

type GUIDFormat string

const (
	GUIDFormatADBinary   GUIDFormat = "ad-binary"
	GUIDFormatUUIDString GUIDFormat = "uuid-string"
)

type LDAPConfig struct {
	URL          string
	BaseDN       string
	UserFilter   string
	BindDN       string
	BindPassword string
	StartTLS     bool

	AttrGUID        string
	AttrUsername    string
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

func (a *LDAPAuthenticator) Authenticate(username, password string) (*Identity, error) {

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

	filter := fmt.Sprintf(a.cfg.UserFilter, ldap.EscapeFilter(username))
	res, err := conn.Search(ldap.NewSearchRequest(
		a.cfg.BaseDN,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, 0, false,
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

func (a *LDAPAuthenticator) extractGUID(entry *ldap.Entry) (adguid.GUID, error) {
	switch a.cfg.GUIDFormat {
	case GUIDFormatUUIDString:

		s := entry.GetAttributeValue(a.cfg.AttrGUID)
		if !uuidTextRe.MatchString(s) {
			return "", fmt.Errorf("attribute is not a textual UUID: %q", s)
		}
		return adguid.GUID(strings.ToLower(s)), nil
	default:

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
