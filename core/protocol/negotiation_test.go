package protocol

import (
	"encoding/json"
	"testing"
)

func TestRejectUnsupportedRequiredProfiles(t *testing.T) {
	for _, s := range []string{`{"versions":["9.0"],"max_frame":8192}`, `{"versions":["0.1"],"required_features":["unlock"],"max_frame":8192}`, `{"versions":["0.1"],"max_frame":100}`} {
		if Negotiate(json.RawMessage(s)) == nil {
			t.Fatalf("accepted %s", s)
		}
	}
	if e := Negotiate(json.RawMessage(`{"versions":["0.1"],"max_frame":8192,"future":true}`)); e != nil {
		t.Fatal(e)
	}
}
