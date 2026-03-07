package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type GrepTool struct{}

type grepArgs struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
	Include string `json:"include"`
}

func (t *GrepTool) Name() string { return "grep" }
func (t *GrepTool) Description() string {
	return "Search for a text pattern in files. Returns matching lines with file paths and line numbers. Searches recursively in directories."
}

func (t *GrepTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"pattern": map[string]interface{}{
				"type":        "string",
				"description": "The text pattern to search for (case-insensitive substring match)",
			},
			"path": map[string]interface{}{
				"type":        "string",
				"description": "File or directory to search in (default: current directory)",
			},
			"include": map[string]interface{}{
				"type":        "string",
				"description": "File extension filter, e.g. '.go' or '.ts' (optional)",
			},
		},
		"required": []string{"pattern"},
	}
}

func (t *GrepTool) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	var a grepArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return "", fmt.Errorf("invalid arguments: %w", err)
	}
	if a.Path == "" {
		a.Path = "."
	}

	pattern := strings.ToLower(a.Pattern)
	var results []string
	maxResults := 50

	err := filepath.Walk(a.Path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			if name == ".git" || name == "node_modules" || name == "vendor" || name == "__pycache__" {
				return filepath.SkipDir
			}
			return nil
		}
		if len(results) >= maxResults {
			return filepath.SkipAll
		}

		// Filter by extension
		if a.Include != "" && !strings.HasSuffix(path, a.Include) {
			return nil
		}

		// Skip binary/large files
		if info.Size() > 1024*1024 {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		lineNum := 0
		for scanner.Scan() {
			lineNum++
			line := scanner.Text()
			if strings.Contains(strings.ToLower(line), pattern) {
				results = append(results, fmt.Sprintf("%s:%d: %s", path, lineNum, line))
				if len(results) >= maxResults {
					break
				}
			}
		}
		return nil
	})

	if err != nil {
		return "", err
	}

	if len(results) == 0 {
		return fmt.Sprintf("No matches found for '%s'", a.Pattern), nil
	}

	output := strings.Join(results, "\n")
	if len(results) >= maxResults {
		output += fmt.Sprintf("\n... (truncated, showing first %d matches)", maxResults)
	}
	return output, nil
}
