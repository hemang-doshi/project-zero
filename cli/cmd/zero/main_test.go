package main

import (
	"errors"
	"testing"
)

func TestStableErrorExitCategories(t *testing.T) {
	for _, v := range []struct {
		s    string
		code int
	}{{"VALIDATION: malformed", 2}, {"AUTHORIZATION: denied", 3}, {"CONFLICT: old revision", 4}, {"DEADLINE: expired", 5}, {"dial unix: connection refused", 1}} {
		if c := exitCode(errors.New(v.s)); c != v.code {
			t.Fatalf("%s: %d", v.s, c)
		}
	}
}
