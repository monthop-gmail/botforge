package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type ListFilesTool struct{}

type listFilesArgs struct {
	Path string `json:"path"`
}

func (t *ListFilesTool) Name() string        { return "list_files" }
func (t *ListFilesTool) Description() string { return "List files and directories at the given path." }

func (t *ListFilesTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path": map[string]interface{}{
				"type":        "string",
				"description": "The directory path to list (default: current directory)",
			},
		},
		"required": []string{"path"},
	}
}

func (t *ListFilesTool) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	var a listFilesArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return "", fmt.Errorf("invalid arguments: %w", err)
	}
	if a.Path == "" {
		a.Path = "."
	}
	entries, err := os.ReadDir(a.Path)
	if err != nil {
		return "", err
	}
	var lines []string
	for _, e := range entries {
		suffix := ""
		if e.IsDir() {
			suffix = "/"
		}
		lines = append(lines, e.Name()+suffix)
	}
	return strings.Join(lines, "\n"), nil
}
