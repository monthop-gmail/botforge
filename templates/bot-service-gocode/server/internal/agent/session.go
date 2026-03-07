package agent

import (
	"sync"
	"time"

	"github.com/user/gocode/internal/provider"
)

// Session holds conversation state.
type Session struct {
	ID        string             `json:"id"`
	Messages  []provider.Message `json:"messages"`
	CreatedAt time.Time          `json:"created_at"`
	mu        sync.Mutex
}

// AddMessage appends a message to the session.
func (s *Session) AddMessage(role, content string, toolCalls []provider.ToolCall) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Messages = append(s.Messages, provider.Message{
		Role:      role,
		Content:   content,
		ToolCalls: toolCalls,
	})
}

// AddToolResult appends a tool result message.
func (s *Session) AddToolResult(toolCallID, content string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Messages = append(s.Messages, provider.Message{
		Role:       "tool",
		Content:    content,
		ToolCallID: toolCallID,
	})
}

// SessionStore manages sessions in memory.
type SessionStore struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

func NewSessionStore() *SessionStore {
	return &SessionStore{sessions: make(map[string]*Session)}
}

func (s *SessionStore) Create(id string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := &Session{
		ID:        id,
		CreatedAt: time.Now(),
	}
	s.sessions[id] = sess
	return sess
}

func (s *SessionStore) Get(id string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	return sess, ok
}

func (s *SessionStore) List() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Session
	for _, sess := range s.sessions {
		result = append(result, sess)
	}
	return result
}

func (s *SessionStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}
