package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type WebFetchTool struct{}

type webFetchArgs struct {
	URL string `json:"url"`
}

func (t *WebFetchTool) Name() string { return "web_fetch" }
func (t *WebFetchTool) Description() string {
	return "Fetch content from a URL. Returns the response body as text. Useful for reading documentation, APIs, or web pages."
}

func (t *WebFetchTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"url": map[string]interface{}{
				"type":        "string",
				"description": "The URL to fetch",
			},
		},
		"required": []string{"url"},
	}
}

func (t *WebFetchTool) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	var a webFetchArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return "", fmt.Errorf("invalid arguments: %w", err)
	}

	if !strings.HasPrefix(a.URL, "http://") && !strings.HasPrefix(a.URL, "https://") {
		return "", fmt.Errorf("invalid URL: must start with http:// or https://")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "gocode/1.0")
	req.Header.Set("Accept", "text/html,application/json,text/plain,*/*")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d %s", resp.StatusCode, resp.Status)
	}

	// Limit response size to 100KB
	body, err := io.ReadAll(io.LimitReader(resp.Body, 100*1024))
	if err != nil {
		return "", err
	}

	content := string(body)

	// Strip HTML tags for readability (basic)
	if strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
		content = stripHTMLTags(content)
	}

	// Truncate if still too long
	if len(content) > 10000 {
		content = content[:10000] + "\n... (truncated)"
	}

	return fmt.Sprintf("HTTP %d | %s\n\n%s", resp.StatusCode, resp.Header.Get("Content-Type"), content), nil
}

// stripHTMLTags removes HTML tags for basic readability.
func stripHTMLTags(s string) string {
	var result strings.Builder
	inTag := false
	lastWasSpace := false

	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			if r == '\n' || r == '\r' || r == '\t' {
				r = ' '
			}
			if r == ' ' && lastWasSpace {
				continue
			}
			lastWasSpace = r == ' '
			result.WriteRune(r)
		}
	}
	return strings.TrimSpace(result.String())
}
