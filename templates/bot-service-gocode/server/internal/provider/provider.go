package provider

import (
	"context"
)

// ToolDefinition describes a tool the LLM can call.
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// ToolCall represents a tool invocation from the LLM.
type ToolCall struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// Message represents a chat message.
type Message struct {
	Role       string     `json:"role"` // "system", "user", "assistant", "tool"
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// StreamEvent is sent during streaming.
type StreamEvent struct {
	Type      string   `json:"type"` // "text_delta", "tool_call", "done", "error"
	Content   string   `json:"content,omitempty"`
	ToolCall  *ToolCall `json:"tool_call,omitempty"`
}

// Request to the LLM provider.
type Request struct {
	Messages []Message
	Tools    []ToolDefinition
}

// Response from the LLM provider.
type Response struct {
	Content   string
	ToolCalls []ToolCall
}

// Provider is the interface for LLM backends.
type Provider interface {
	// Chat sends a request and streams events back.
	Chat(ctx context.Context, req Request, stream chan<- StreamEvent) (*Response, error)
}
