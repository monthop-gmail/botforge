package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type WebSearchTool struct{}

type webSearchArgs struct {
	Query string `json:"query"`
}

func (t *WebSearchTool) Name() string { return "web_search" }
func (t *WebSearchTool) Description() string {
	return "Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets. Use this when you need current information, news, or answers to questions about the real world."
}

func (t *WebSearchTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query": map[string]interface{}{
				"type":        "string",
				"description": "The search query",
			},
		},
		"required": []string{"query"},
	}
}

func (t *WebSearchTool) Execute(ctx context.Context, args json.RawMessage) (string, error) {
	var a webSearchArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return "", fmt.Errorf("invalid arguments: %w", err)
	}

	results, err := searchDuckDuckGo(ctx, a.Query)
	if err != nil {
		return "", err
	}

	if results == "" {
		return "No search results found.", nil
	}
	return results, nil
}

func searchDuckDuckGo(ctx context.Context, query string) (string, error) {
	// Use DuckDuckGo HTML lite version
	searchURL := fmt.Sprintf("https://html.duckduckgo.com/html/?q=%s", url.QueryEscape(query))

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, searchURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 200*1024))
	if err != nil {
		return "", err
	}

	return parseDDGResults(string(body)), nil
}

// parseDDGResults extracts search results from DuckDuckGo HTML.
func parseDDGResults(html string) string {
	var results []string
	maxResults := 8

	// Find result blocks - each result has class "result__a" for title/link
	// and "result__snippet" for description
	parts := strings.Split(html, "class=\"result__a\"")

	for i := 1; i < len(parts) && len(results) < maxResults; i++ {
		part := parts[i]

		// Extract URL
		linkURL := extractAttr(part, "href=\"", "\"")
		if linkURL == "" {
			continue
		}
		// DuckDuckGo wraps URLs in redirect, extract actual URL
		if strings.Contains(linkURL, "uddg=") {
			if u, err := url.QueryUnescape(extractBetween(linkURL, "uddg=", "&")); err == nil && u != "" {
				linkURL = u
			}
		}

		// Extract title
		title := extractBetween(part, ">", "</a>")
		title = stripHTMLTagsSimple(title)

		// Extract snippet
		snippet := ""
		if idx := strings.Index(part, "result__snippet"); idx != -1 {
			snippetPart := part[idx:]
			snippet = extractBetween(snippetPart, ">", "</")
			snippet = stripHTMLTagsSimple(snippet)
		}

		if title != "" {
			result := fmt.Sprintf("%d. %s\n   %s", len(results)+1, title, linkURL)
			if snippet != "" {
				result += fmt.Sprintf("\n   %s", snippet)
			}
			results = append(results, result)
		}
	}

	if len(results) == 0 {
		return ""
	}
	return strings.Join(results, "\n\n")
}

func extractAttr(s, prefix, suffix string) string {
	start := strings.Index(s, prefix)
	if start == -1 {
		return ""
	}
	s = s[start+len(prefix):]
	end := strings.Index(s, suffix)
	if end == -1 {
		return ""
	}
	return s[:end]
}

func extractBetween(s, start, end string) string {
	i := strings.Index(s, start)
	if i == -1 {
		return ""
	}
	s = s[i+len(start):]
	j := strings.Index(s, end)
	if j == -1 {
		return s
	}
	return s[:j]
}

func stripHTMLTagsSimple(s string) string {
	var result strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
		} else if r == '>' {
			inTag = false
		} else if !inTag {
			result.WriteRune(r)
		}
	}
	return strings.TrimSpace(result.String())
}
