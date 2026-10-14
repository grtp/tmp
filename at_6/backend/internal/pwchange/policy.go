package pwchange

import (
	"fmt"
	"strings"
	"unicode"
)

type Policy struct {
	MinLen     int
	MaxLen     int
	MinClasses int
	ASCIIOnly  bool

	ForbidSame bool

	ForbidIdentity bool
}

type Violation string

const (
	VioTooShort Violation = "too_short"
	VioTooLong  Violation = "too_long"
	VioClasses  Violation = "classes"
	VioASCII    Violation = "ascii"
	VioSame     Violation = "same"
	VioIdentity Violation = "identity"
	VioEmpty    Violation = "empty"
)

const MaxPasswordLen = 512

func (p Policy) Validate() error {
	if p.MinLen < 1 || p.MinLen > MaxPasswordLen {
		return fmt.Errorf("%w: 最小長は 1〜%d で指定してください", ErrRecipe, MaxPasswordLen)
	}
	if p.MaxLen < p.MinLen || p.MaxLen > MaxPasswordLen {
		return fmt.Errorf("%w: 最大長は最小長以上 %d 以下で指定してください", ErrRecipe, MaxPasswordLen)
	}
	if p.MinClasses < 0 || p.MinClasses > 4 {
		return fmt.Errorf("%w: 必要な文字種の数は 0〜4 で指定してください", ErrRecipe)
	}
	return nil
}

func (p Policy) Check(newPw, currentPw string, identity []string) []Violation {
	var out []Violation
	if newPw == "" {
		return []Violation{VioEmpty}
	}
	n := len([]rune(newPw))
	if n < p.MinLen {
		out = append(out, VioTooShort)
	}
	if n > p.MaxLen {
		out = append(out, VioTooLong)
	}
	if p.ASCIIOnly {
		for _, c := range newPw {
			if c < 0x21 || c > 0x7e {
				out = append(out, VioASCII)
				break
			}
		}
	}
	if p.MinClasses > 0 && countClasses(newPw) < p.MinClasses {
		out = append(out, VioClasses)
	}
	if p.ForbidSame && currentPw != "" && newPw == currentPw {
		out = append(out, VioSame)
	}
	if p.ForbidIdentity {
		lower := strings.ToLower(newPw)
		for _, id := range identity {
			id = strings.ToLower(strings.TrimSpace(id))
			if len([]rune(id)) >= 3 && strings.Contains(lower, id) {
				out = append(out, VioIdentity)
				break
			}
		}
	}
	return out
}

func countClasses(s string) int {
	var upper, lower, digit, other bool
	for _, c := range s {
		switch {
		case unicode.IsUpper(c):
			upper = true
		case unicode.IsLower(c):
			lower = true
		case unicode.IsDigit(c):
			digit = true
		default:
			other = true
		}
	}
	n := 0
	for _, b := range []bool{upper, lower, digit, other} {
		if b {
			n++
		}
	}
	return n
}

func (p Policy) ViolationMessage(v Violation) string {
	switch v {
	case VioEmpty:
		return "新しいパスワードを入力してください"
	case VioTooShort:
		return fmt.Sprintf("%d 文字以上で指定してください", p.MinLen)
	case VioTooLong:
		return fmt.Sprintf("%d 文字以下で指定してください", p.MaxLen)
	case VioClasses:
		return fmt.Sprintf("英大文字・英小文字・数字・記号のうち %d 種類以上を使ってください", p.MinClasses)
	case VioASCII:
		return "半角英数字と記号のみ使えます(空白は不可)"
	case VioSame:
		return "現在のパスワードと同じものは使えません"
	case VioIdentity:
		return "社員番号やユーザー名を含むものは使えません"
	}
	return string(v)
}
