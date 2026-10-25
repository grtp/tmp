package auth

import (
	"fmt"
	"regexp"
	"strings"
)

type EmployeeNoExtractor struct {
	re    *regexp.Regexp
	upper bool
}

var tokenRe = regexp.MustCompile(`[A-Za-z0-9]+`)

func NewEmployeeNoExtractor(pattern string, upper bool) (*EmployeeNoExtractor, error) {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return &EmployeeNoExtractor{upper: upper}, nil
	}
	re, err := regexp.Compile(`^(?:` + pattern + `)$`)
	if err != nil {
		return nil, fmt.Errorf("employee no pattern: %w", err)
	}
	return &EmployeeNoExtractor{re: re, upper: upper}, nil
}

func (x *EmployeeNoExtractor) Extract(raw string) string {
	v := strings.TrimSpace(raw)
	if x == nil || x.re == nil {
		return x.normalize(v)
	}
	if x.re.MatchString(v) {
		return x.normalize(v)
	}
	for _, tok := range tokenRe.FindAllString(v, -1) {
		if x.re.MatchString(tok) {
			return x.normalize(tok)
		}
	}
	return ""
}

func (x *EmployeeNoExtractor) normalize(v string) string {
	if x != nil && x.upper {
		return strings.ToUpper(v)
	}
	return v
}
