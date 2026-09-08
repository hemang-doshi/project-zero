package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestInvalidDisplayStateRejectedBeforeDispatch(t *testing.T) {
	r := openTest(t, filepath.Join(t.TempDir(), "zero.db"))
	r.Enroll(context.Background(), "desk", "fp", []string{"display.render"})
	_, e := r.Execute(context.Background(), "owner", Request{ID: "bad", Op: "capabilities.invoke", Body: json.RawMessage(`{"node":"desk","capability":"display.render","input":{"state":"HACKED"}}`)})
	if e == nil {
		t.Fatal("invalid state reached approval/dispatch")
	}
}
