package pwchange

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"strings"
	"unicode/utf16"

	"golang.org/x/text/encoding/japanese"
)

type Algorithm string

const (
	AlgSHA256 Algorithm = "sha256"
	AlgSHA1   Algorithm = "sha1"
	AlgSHA512 Algorithm = "sha512"
	AlgMD5    Algorithm = "md5"
)

type Encoding string

const (
	EncUTF8    Encoding = "utf8"
	EncUTF16LE Encoding = "utf16le"
	EncSJIS    Encoding = "sjis"
)

type Output string

const (
	OutHex      Output = "hex"
	OutHexUpper Output = "hexupper"
	OutBase64   Output = "base64"
	OutBinary   Output = "binary"
)

const MaxIterations = 100000

type Recipe struct {
	Algorithm  Algorithm
	Template   string
	Encoding   Encoding
	Output     Output
	Iterations int
}

var ErrRecipe = errors.New("recipe")

type tokenKind int

const (
	tokLiteral tokenKind = iota
	tokInput
	tokSalt
)

type token struct {
	kind tokenKind
	text string
}

func parseTemplate(t string) ([]token, error) {
	var out []token
	var lit strings.Builder
	flush := func() {
		if lit.Len() > 0 {
			out = append(out, token{kind: tokLiteral, text: lit.String()})
			lit.Reset()
		}
	}
	for i := 0; i < len(t); {
		if t[i] != '$' {
			lit.WriteByte(t[i])
			i++
			continue
		}
		rest := t[i:]
		switch {
		case strings.HasPrefix(rest, "$input"):
			flush()
			out = append(out, token{kind: tokInput})
			i += len("$input")
		case strings.HasPrefix(rest, "$salt"):
			flush()
			out = append(out, token{kind: tokSalt})
			i += len("$salt")
		case strings.HasPrefix(rest, "$$"):
			lit.WriteByte('$')
			i += 2
		default:
			return nil, fmt.Errorf("%w: テンプレートの %d 文字目に不明なプレースホルダがあります($input / $salt / $$ のみ使えます)", ErrRecipe, i+1)
		}
	}
	flush()
	return out, nil
}

func (r Recipe) Validate() error {
	switch r.Algorithm {
	case AlgSHA256, AlgSHA1, AlgSHA512, AlgMD5:
	default:
		return fmt.Errorf("%w: アルゴリズム %q は使えません", ErrRecipe, r.Algorithm)
	}
	switch r.Encoding {
	case EncUTF8, EncUTF16LE, EncSJIS:
	default:
		return fmt.Errorf("%w: エンコーディング %q は使えません", ErrRecipe, r.Encoding)
	}
	switch r.Output {
	case OutHex, OutHexUpper, OutBase64, OutBinary:
	default:
		return fmt.Errorf("%w: 出力形式 %q は使えません", ErrRecipe, r.Output)
	}
	if r.Iterations < 1 || r.Iterations > MaxIterations {
		return fmt.Errorf("%w: 反復回数は 1〜%d で指定してください", ErrRecipe, MaxIterations)
	}
	if len(r.Template) > 200 {
		return fmt.Errorf("%w: テンプレートは 200 文字以内で指定してください", ErrRecipe)
	}
	toks, err := parseTemplate(r.Template)
	if err != nil {
		return err
	}
	inputs := 0
	for _, t := range toks {
		if t.kind == tokInput {
			inputs++
		}
	}
	if inputs != 1 {
		return fmt.Errorf("%w: テンプレートには $input をちょうど 1 回含めてください", ErrRecipe)
	}
	return nil
}

func (r Recipe) UsesSalt() bool {
	toks, err := parseTemplate(r.Template)
	if err != nil {
		return false
	}
	for _, t := range toks {
		if t.kind == tokSalt {
			return true
		}
	}
	return false
}

func (r Recipe) Compose(input, salt string) (string, error) {
	toks, err := parseTemplate(r.Template)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, t := range toks {
		switch t.kind {
		case tokInput:
			b.WriteString(input)
		case tokSalt:
			b.WriteString(salt)
		default:
			b.WriteString(t.text)
		}
	}
	return b.String(), nil
}

func encodeBytes(s string, enc Encoding) ([]byte, error) {
	switch enc {
	case EncUTF8:
		return []byte(s), nil
	case EncUTF16LE:
		u := utf16.Encode([]rune(s))
		out := make([]byte, 0, len(u)*2)
		for _, c := range u {
			out = append(out, byte(c), byte(c>>8))
		}
		return out, nil
	case EncSJIS:
		b, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte(s))
		if err != nil {

			return nil, fmt.Errorf("%w: Shift_JIS で表現できない文字が含まれています", ErrRecipe)
		}
		return b, nil
	}
	return nil, fmt.Errorf("%w: エンコーディング %q は使えません", ErrRecipe, enc)
}

func (r Recipe) newHash() hash.Hash {
	switch r.Algorithm {
	case AlgSHA1:
		return sha1.New()
	case AlgSHA512:
		return sha512.New()
	case AlgMD5:
		return md5.New()
	default:
		return sha256.New()
	}
}

func (r Recipe) Digest(input, salt string) ([]byte, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	s, err := r.Compose(input, salt)
	if err != nil {
		return nil, err
	}
	b, err := encodeBytes(s, r.Encoding)
	if err != nil {
		return nil, err
	}
	h := r.newHash()
	h.Write(b)
	sum := h.Sum(nil)
	for i := 1; i < r.Iterations; i++ {
		h.Reset()
		h.Write(sum)
		sum = h.Sum(nil)
	}
	return sum, nil
}

func (r Recipe) Encode(digest []byte) any {
	switch r.Output {
	case OutHexUpper:
		return strings.ToUpper(hex.EncodeToString(digest))
	case OutBase64:
		return base64.StdEncoding.EncodeToString(digest)
	case OutBinary:
		return digest
	default:
		return hex.EncodeToString(digest)
	}
}

func (r Recipe) Matches(stored any, digest []byte) bool {
	var raw []byte
	switch v := stored.(type) {
	case nil:
		return false
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		raw = []byte(fmt.Sprint(v))
	}
	if r.Output == OutBinary {
		return subtle.ConstantTimeCompare(raw, digest) == 1
	}
	want := fmt.Sprint(r.Encode(digest))
	got := strings.TrimSpace(string(raw))
	if r.Output == OutHex || r.Output == OutHexUpper {
		want = strings.ToLower(want)
		got = strings.ToLower(got)
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (r Recipe) EncodedLength() int {
	n := r.newHash().Size()
	switch r.Output {
	case OutBinary:
		return n
	case OutBase64:
		return base64.StdEncoding.EncodedLen(n)
	default:
		return n * 2
	}
}
