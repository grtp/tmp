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
	UserFilter   string // ユーザー名を埋める %s を1つだけ含むこと
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

// NewLDAPAuthenticator は未指定の属性名を AD の既定値で埋める
// (objectGUID / sAMAccountName / displayName / mail，ad-binary)。
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

// Authenticate は定石の search-then-bind を行う:
//
//  1. サービスアカウントで bind してユーザーエントリを検索し，
//  2. そのエントリの DN と入力パスワードで bind し直す。
//
// 認証の実体は手順2で，bind 成功がパスワード正当性の証明。
// ハッシュ比較はディレクトリ側の仕事であり，こちらでは行わない。
func (a *LDAPAuthenticator) Authenticate(username, password string) (*Identity, error) {
	// RFC 4513 §5.1.2: DN あり・パスワード空の bind は "unauthenticated
	// bind" として成功扱いにするサーバーが多い。空パスワードで誰も
	// 認証できないよう先頭で拒否する。
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

	// EscapeFilter でユーザー名経由の LDAP インジェクションを防ぐ。
	// entryUUID のような operational 属性は "*" では返らないため，
	// 必要な属性は必ず明示的に要求する。
	filter := fmt.Sprintf(a.cfg.UserFilter, ldap.EscapeFilter(username))
	res, err := conn.Search(ldap.NewSearchRequest(
		a.cfg.BaseDN,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, 0, false, // size limit 2: 曖昧一致(2件以上)の検出用
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

	// 認証の本体: ユーザー自身として bind する。
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

// extractGUID はディレクトリの GUID 属性を，ワイヤ上の表現に関わらず
// 正準の小文字文字列形式へ正規化する。
func (a *LDAPAuthenticator) extractGUID(entry *ldap.Entry) (adguid.GUID, error) {
	switch a.cfg.GUIDFormat {
	case GUIDFormatUUIDString:
		// OpenLDAP entryUUID: 既にテキストの UUID。adguid.FromLDAP に通すと
		// 文字列のバイト列として壊れるため，検証と小文字化だけ行う。
		s := entry.GetAttributeValue(a.cfg.AttrGUID)
		if !uuidTextRe.MatchString(s) {
			return "", fmt.Errorf("attribute is not a textual UUID: %q", s)
		}
		return adguid.GUID(strings.ToLower(s)), nil
	default: // GUIDFormatADBinary
		// AD objectGUID: 生16byte。この境界で正規化し，生バイトを外へ出さない
		// (adguid 参照)。
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
