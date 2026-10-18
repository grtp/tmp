package tzone

import (
	"errors"
	"fmt"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

const Default = "Asia/Tokyo"

const MaxLen = 64

var ErrInvalid = errors.New("invalid time zone")

func Load(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "Local" || utf8.RuneCountInString(name) > MaxLen {
		return nil, fmt.Errorf("%w: %q", ErrInvalid, name)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrInvalid, name)
	}
	return loc, nil
}

func LoadOrDefault(name string) (*time.Location, error) {
	if strings.TrimSpace(name) == "" {
		name = Default
	}
	return Load(name)
}

func Name(loc *time.Location) string {
	if loc == nil {
		return "UTC"
	}
	return loc.String()
}
