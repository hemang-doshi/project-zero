package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type bounded struct{ bytes.Buffer }

func (b *bounded) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 65536 {
		return 0, fmt.Errorf("git output limit")
	}
	return b.Buffer.Write(p)
}
func Status(ctx context.Context, path string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", path, "status", "--porcelain=v2", "--branch", "--untracked-files=normal")
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "GIT_") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null", "GIT_TERMINAL_PROMPT=0")
	var out bounded
	cmd.Stdout = &out
	cmd.Stderr = &bounded{}
	if e := cmd.Run(); e != nil {
		return nil, fmt.Errorf("Git status unavailable")
	}
	data := map[string]string{"branch": "unknown", "dirty": "false", "ahead": "unknown", "behind": "unknown"}
	for _, line := range strings.Split(out.String(), "\n") {
		switch {
		case strings.HasPrefix(line, "# branch.head "):
			data["branch"] = strings.TrimPrefix(line, "# branch.head ")
		case strings.HasPrefix(line, "# branch.ab "):
			parts := strings.Fields(line)
			if len(parts) == 4 {
				data["ahead"] = strings.TrimPrefix(parts[2], "+")
				data["behind"] = strings.TrimPrefix(parts[3], "-")
			}
		case line != "" && !strings.HasPrefix(line, "#"):
			data["dirty"] = "true"
		}
	}
	return data, nil
}
