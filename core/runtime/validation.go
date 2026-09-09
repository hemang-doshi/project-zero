package runtime

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Validate additions before dry-run or dispatch; existing protocol operations retain compatibility.
func validatePersonalFields(op string, body map[string]json.RawMessage) error {
	fields, known := map[string]string{
		"projects.add": "id name path aliases removed", "projects.remove": "id",
		"context.assert": "dimension value expected_revision expires_at source evidence observed_at classification revision cleared", "context.clear": "dimension expected_revision",
		"integrations.connect": "id", "integrations.disconnect": "id",
		"integration.observed": "id enabled status project_id observed_at data message",
		"policies.apply":       "id", "policies.disable": "id", "policies.review": "id review",
		"notifications.claim": "id", "notifications.result": "id state", "intent.run": "text",
		"session.end": "expected_revision",
	}[op]
	if !known {
		return nil
	}
	for key := range body {
		found := false
		for _, allowed := range strings.Fields(fields) {
			if key == allowed {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("VALIDATION: unsupported %s field %s", op, key)
		}
	}
	return nil
}
