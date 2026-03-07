package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type EditFileTool struct{}

type editFileArgs struct {
	Path      string `json:"path"`
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
}

func (t *EditFileTool) Name() string { return "edit_file" }
func (t *EditFileTool) Description() string {
	return "Edit a file by replacing an exact string match. The old_string must appear exactly once in the file. Use read_file first to see the current content."
}

func (t *EditFileTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path": map[string]interface{}{
				"type":        "string",
				"description": "The file path to edit",
			},
			"old_string": map[string]interface{}{
				"type":        "string",
				"description": "The exact string to find and replace (must be unique in the file)",
			},
			"new_string": map[string]interface{}{
				"type":        "string",
				"description": "The string to replace it with",
			},
		},
		"required": []string{"path", "old_string", "new_string"},
	}
}

func (t *EditFileTool) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	var a editFileArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return "", fmt.Errorf("invalid arguments: %w", err)
	}

	data, err := os.ReadFile(a.Path)
	if err != nil {
		return "", err
	}

	content := string(data)
	count := strings.Count(content, a.OldString)

	if count == 0 {
		return "", fmt.Errorf("old_string not found in %s", a.Path)
	}
	if count > 1 {
		return "", fmt.Errorf("old_string found %d times in %s (must be unique, provide more context)", count, a.Path)
	}

	newContent := strings.Replace(content, a.OldString, a.NewString, 1)

	if err := os.WriteFile(a.Path, []byte(newContent), 0o644); err != nil {
		return "", err
	}

	return fmt.Sprintf("Successfully edited %s", a.Path), nil
}
