package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/user/gocode/internal/provider"
)

// Tool is the interface all tools must implement.
type Tool interface {
	Name() string
	Description() string
	Parameters() map[string]interface{}
	Execute(ctx context.Context, args json.RawMessage) (string, error)
}

// Registry manages available tools.
type Registry struct {
	tools map[string]Tool
}

// NewRegistry creates a registry with all built-in tools.
func NewRegistry(workDir string) *Registry {
	r := &Registry{tools: make(map[string]Tool)}
	r.Register(&ReadFileTool{})
	r.Register(&WriteFileTool{})
	r.Register(&EditFileTool{})
	r.Register(&ListFilesTool{})
	r.Register(&GrepTool{})
	r.Register(&WebFetchTool{})
	r.Register(&WebSearchTool{})
	r.Register(&ShellTool{WorkDir: workDir})
	return r
}

// Register adds a tool.
func (r *Registry) Register(t Tool) {
	r.tools[t.Name()] = t
}

// Definitions returns tool definitions for the LLM.
func (r *Registry) Definitions() []provider.ToolDefinition {
	var defs []provider.ToolDefinition
	for _, t := range r.tools {
		defs = append(defs, provider.ToolDefinition{
			Name:        t.Name(),
			Description: t.Description(),
			Parameters:  t.Parameters(),
		})
	}
	return defs
}

// Execute runs a tool by name.
func (r *Registry) Execute(ctx context.Context, name string, argsJSON string) (string, error) {
	t, ok := r.tools[name]
	if !ok {
		return "", fmt.Errorf("unknown tool: %s", name)
	}
	result, err := t.Execute(ctx, json.RawMessage(argsJSON))
	if err != nil {
		return fmt.Sprintf("Error: %s", err.Error()), nil
	}
	return result, nil
}
