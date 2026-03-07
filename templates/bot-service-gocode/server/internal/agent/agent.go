package agent

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/user/gocode/internal/provider"
	"github.com/user/gocode/internal/tools"
)

// Agent orchestrates the LLM ↔ tools loop.
type Agent struct {
	provider      provider.Provider
	tools         *tools.Registry
	systemPrompt  string
	maxIterations int
	workDir       string
}

// New creates a new Agent.
func New(p provider.Provider, t *tools.Registry, systemPrompt string, maxIterations int, workDir string) *Agent {
	return &Agent{
		provider:      p,
		tools:         t,
		systemPrompt:  systemPrompt,
		maxIterations: maxIterations,
		workDir:       workDir,
	}
}

// buildSystemPrompt combines the base system prompt with agents.md if found.
func (a *Agent) buildSystemPrompt() string {
	agentsContent := a.loadAgentsMD()
	if agentsContent == "" {
		return a.systemPrompt
	}
	return a.systemPrompt + "\n\n# Project Instructions (from agents.md)\n\n" + agentsContent
}

// loadAgentsMD looks for agents.md or AGENTS.md in the working directory.
func (a *Agent) loadAgentsMD() string {
	candidates := []string{"agents.md", "AGENTS.md", "Agents.md"}
	for _, name := range candidates {
		path := filepath.Join(a.workDir, name)
		data, err := os.ReadFile(path)
		if err == nil {
			content := strings.TrimSpace(string(data))
			if content != "" {
				log.Printf("Loaded %s (%d bytes)", path, len(content))
				return content
			}
		}
	}
	return ""
}

// Event is streamed to clients during agent execution.
type Event struct {
	Type       string          `json:"type"` // "text_delta", "tool_call", "tool_result", "done", "error"
	Content    string          `json:"content,omitempty"`
	ToolName   string          `json:"tool_name,omitempty"`
	ToolArgs   string          `json:"tool_args,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
}

// Run executes the agent loop for a session with a new user message.
func (a *Agent) Run(ctx context.Context, session *Session, userMessage string, events chan<- Event) error {
	defer func() {
		events <- Event{Type: "done"}
		close(events)
	}()

	// Add system prompt if first message
	if len(session.Messages) == 0 {
		session.AddMessage("system", a.buildSystemPrompt(), nil)
	}

	// Add user message
	session.AddMessage("user", userMessage, nil)

	for i := 0; i < a.maxIterations; i++ {
		// Stream from LLM
		streamCh := make(chan provider.StreamEvent, 100)

		go func() {
			// Drain channel if not consumed
			for range streamCh {
			}
		}()

		session.mu.Lock()
		msgs := make([]provider.Message, len(session.Messages))
		copy(msgs, session.Messages)
		session.mu.Unlock()

		resp, err := a.provider.Chat(ctx, provider.Request{
			Messages: msgs,
			Tools:    a.tools.Definitions(),
		}, streamCh)

		if err != nil {
			events <- Event{Type: "error", Content: err.Error()}
			return err
		}

		// No tool calls — we're done
		if len(resp.ToolCalls) == 0 {
			session.AddMessage("assistant", resp.Content, nil)
			events <- Event{Type: "text_delta", Content: resp.Content}
			return nil
		}

		// Add assistant message with tool calls
		session.AddMessage("assistant", resp.Content, resp.ToolCalls)

		// Stream any text content before tool calls
		if resp.Content != "" {
			events <- Event{Type: "text_delta", Content: resp.Content}
		}

		// Execute each tool call
		for _, tc := range resp.ToolCalls {
			events <- Event{
				Type:       "tool_call",
				ToolName:   tc.Name,
				ToolArgs:   tc.Arguments,
				ToolCallID: tc.ID,
			}

			log.Printf("Executing tool: %s(%s)", tc.Name, tc.Arguments)
			result, err := a.tools.Execute(ctx, tc.Name, tc.Arguments)
			if err != nil {
				result = fmt.Sprintf("Error: %s", err.Error())
			}

			session.AddToolResult(tc.ID, result)

			events <- Event{
				Type:       "tool_result",
				Content:    result,
				ToolName:   tc.Name,
				ToolCallID: tc.ID,
			}
		}
	}

	events <- Event{Type: "error", Content: "max iterations reached"}
	return fmt.Errorf("max iterations reached")
}
