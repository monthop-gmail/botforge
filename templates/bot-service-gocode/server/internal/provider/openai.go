package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAIProvider implements Provider for OpenAI-compatible APIs.
type OpenAIProvider struct {
	client *openai.Client
	model  string
}

// NewOpenAI creates a new OpenAI-compatible provider.
func NewOpenAI(baseURL, apiKey, model string) *OpenAIProvider {
	config := openai.DefaultConfig(apiKey)
	if baseURL != "" {
		config.BaseURL = baseURL
	}
	return &OpenAIProvider{
		client: openai.NewClientWithConfig(config),
		model:  model,
	}
}

func (p *OpenAIProvider) Chat(ctx context.Context, req Request, stream chan<- StreamEvent) (*Response, error) {
	messages := toOpenAIMessages(req.Messages)
	tools := toOpenAITools(req.Tools)

	chatReq := openai.ChatCompletionRequest{
		Model:    p.model,
		Messages: messages,
		Stream:   true,
	}
	if len(tools) > 0 {
		chatReq.Tools = tools
	}

	streamer, err := p.client.CreateChatCompletionStream(ctx, chatReq)
	if err != nil {
		return nil, err
	}
	defer streamer.Close()

	var contentBuf string
	toolCallsMap := make(map[int]*ToolCall)

	for {
		chunk, err := streamer.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		delta := chunk.Choices[0].Delta

		// Text content
		if delta.Content != "" {
			contentBuf += delta.Content
			if stream != nil {
				stream <- StreamEvent{Type: "text_delta", Content: delta.Content}
			}
		}

		// Tool calls (streamed incrementally)
		for _, tc := range delta.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			existing, ok := toolCallsMap[idx]
			if !ok {
				existing = &ToolCall{}
				toolCallsMap[idx] = existing
			}
			if tc.ID != "" {
				existing.ID = tc.ID
			}
			if tc.Function.Name != "" {
				existing.Name = tc.Function.Name
			}
			existing.Arguments += tc.Function.Arguments
		}
	}

	// Collect tool calls
	var toolCalls []ToolCall
	for i := 0; i < len(toolCallsMap); i++ {
		if tc, ok := toolCallsMap[i]; ok {
			toolCalls = append(toolCalls, *tc)
			if stream != nil {
				stream <- StreamEvent{Type: "tool_call", ToolCall: tc}
			}
		}
	}

	if stream != nil {
		stream <- StreamEvent{Type: "done"}
	}

	return &Response{
		Content:   contentBuf,
		ToolCalls: toolCalls,
	}, nil
}

func toOpenAIMessages(msgs []Message) []openai.ChatCompletionMessage {
	var result []openai.ChatCompletionMessage
	for _, m := range msgs {
		msg := openai.ChatCompletionMessage{
			Role:    m.Role,
			Content: m.Content,
		}
		if m.ToolCallID != "" {
			msg.ToolCallID = m.ToolCallID
		}
		for _, tc := range m.ToolCalls {
			msg.ToolCalls = append(msg.ToolCalls, openai.ToolCall{
				ID:   tc.ID,
				Type: openai.ToolTypeFunction,
				Function: openai.FunctionCall{
					Name:      tc.Name,
					Arguments: tc.Arguments,
				},
			})
		}
		result = append(result, msg)
	}
	return result
}

func toOpenAITools(tools []ToolDefinition) []openai.Tool {
	var result []openai.Tool
	for _, t := range tools {
		params, _ := json.Marshal(t.Parameters)
		result = append(result, openai.Tool{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  json.RawMessage(params),
			},
		})
	}
	return result
}
