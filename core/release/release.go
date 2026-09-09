package release

import (
	_ "embed"
	"encoding/json"
)

//go:embed manifest.json
var manifest []byte

type Info struct {
	Version         string   `json:"version"`
	Build           string   `json:"build"`
	Protocols       []string `json:"protocols"`
	RenderSchemas   []string `json:"render_schemas"`
	DatabaseVersion int      `json:"database_version"`
}

func Current() Info {
	var v Info
	if e := json.Unmarshal(manifest, &v); e != nil {
		panic(e)
	}
	return v
}
