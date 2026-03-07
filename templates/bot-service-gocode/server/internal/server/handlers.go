package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/user/gocode/internal/agent"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WebSocket message from client.
type wsMessage struct {
	Type    string `json:"type"`    // "message", "cancel"
	Content string `json:"content"` // user message
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")

	// Get or create session
	session, ok := s.sessions.Get(sessionID)
	if !ok {
		session = s.sessions.Create(sessionID)
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	for {
		var msg wsMessage
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		if msg.Type != "message" || msg.Content == "" {
			continue
		}

		// Run agent and stream events
		events := make(chan agent.Event, 100)
		go func() {
			if err := s.agent.Run(r.Context(), session, msg.Content, events); err != nil {
				log.Printf("Agent error: %v", err)
			}
		}()

		for event := range events {
			if err := conn.WriteJSON(event); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		}
	}
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions := s.sessions.List()
	type sessionInfo struct {
		ID        string    `json:"id"`
		CreatedAt time.Time `json:"created_at"`
		Messages  int       `json:"message_count"`
	}
	var result []sessionInfo
	for _, sess := range sessions {
		result = append(result, sessionInfo{
			ID:        sess.ID,
			CreatedAt: sess.CreatedAt,
			Messages:  len(sess.Messages),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	id := fmt.Sprintf("session-%d", time.Now().UnixNano())
	sess := s.sessions.Create(id)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":         sess.ID,
		"created_at": sess.CreatedAt,
	})
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")
	s.sessions.Delete(sessionID)
	w.WriteHeader(http.StatusNoContent)
}

// handleSendMessage runs the agent synchronously and returns the result as JSON.
func (s *Server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionID")

	session, ok := s.sessions.Get(sessionID)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "session not found"})
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "missing 'content' in request body"})
		return
	}

	events := make(chan agent.Event, 100)
	go func() {
		if err := s.agent.Run(r.Context(), session, body.Content, events); err != nil {
			log.Printf("Agent error: %v", err)
		}
	}()

	var resultText string
	var isError bool
	for event := range events {
		switch event.Type {
		case "text_delta":
			resultText += event.Content
		case "error":
			resultText += event.Content
			isError = true
		}
	}

	if resultText == "" {
		resultText = "Done. (no text output)"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"result":     resultText,
		"session_id": sessionID,
		"is_error":   isError,
	})
}
