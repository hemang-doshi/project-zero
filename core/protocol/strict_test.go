package protocol

import (
	"testing"
)

func TestRejectAmbiguousJSON(t *testing.T) {
	for _, b := range []string{`{"x":1,"x":2}`, `{"x":{"a":1,"a":2}}`, `{} {}`, `{"x":[[[[[[[[[0]]]]]]]]]}`} {
		if ValidateJSON([]byte(b)) == nil {
			t.Fatal("accepted", b)
		}
	}
}
