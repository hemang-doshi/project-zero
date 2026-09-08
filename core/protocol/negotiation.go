package protocol

import (
	"encoding/json"
	"fmt"
)

func Negotiate(body json.RawMessage) error {
	var p struct {
		Versions []string `json:"versions"`
		Required []string `json:"required_features"`
		MaxFrame int      `json:"max_frame"`
	}
	if e := json.Unmarshal(body, &p); e != nil {
		return e
	}
	supported := false
	for _, v := range p.Versions {
		if v == "0.1" {
			supported = true
		}
	}
	if !supported || len(p.Required) > 0 || p.MaxFrame < MaxFrame {
		return fmt.Errorf("unsupported protocol profile")
	}
	return nil
}
