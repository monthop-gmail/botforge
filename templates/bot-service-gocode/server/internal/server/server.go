package server

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/user/gocode/internal/agent"
)

// Server holds the HTTP server and dependencies.
type Server struct {
	agent    *agent.Agent
	sessions *agent.SessionStore
	router   *chi.Mux
}

// New creates a new Server.
func New(a *agent.Agent, sessions *agent.SessionStore) *Server {
	s := &Server{
		agent:    a,
		sessions: sessions,
		router:   chi.NewRouter(),
	}
	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	s.router.Use(middleware.Logger)
	s.router.Use(middleware.Recoverer)

	// API password authentication middleware
	if apiPassword := os.Getenv("API_PASSWORD"); apiPassword != "" {
		log.Printf("API password authentication enabled")
		s.router.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Skip auth for health check
				if r.URL.Path == "/health" {
					next.ServeHTTP(w, r)
					return
				}

				auth := r.Header.Get("Authorization")
				if auth == "" {
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}

				// Check Bearer token
				if strings.HasPrefix(auth, "Bearer ") {
					token := strings.TrimPrefix(auth, "Bearer ")
					if token == apiPassword {
						next.ServeHTTP(w, r)
						return
					}
				}

				http.Error(w, "Forbidden", http.StatusForbidden)
			})
		})
	}

	s.router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// WebSocket endpoint for streaming agent interaction
	s.router.Get("/ws/{sessionID}", s.handleWebSocket)

	// REST endpoints
	s.router.Route("/api", func(r chi.Router) {
		r.Get("/sessions", s.handleListSessions)
		r.Post("/sessions", s.handleCreateSession)
		r.Delete("/sessions/{sessionID}", s.handleDeleteSession)
		r.Post("/sessions/{sessionID}/message", s.handleSendMessage)
	})
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe(addr string) error {
	log.Printf("Server listening on %s", addr)
	return http.ListenAndServe(addr, s.router)
}

// Addr returns the formatted address string.
func Addr(host string, port int) string {
	return fmt.Sprintf("%s:%d", host, port)
}
