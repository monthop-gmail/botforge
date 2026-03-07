package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"github.com/user/gocode/internal/agent"
	"github.com/user/gocode/internal/config"
	"github.com/user/gocode/internal/provider"
	"github.com/user/gocode/internal/server"
	"github.com/user/gocode/internal/tools"
)

var cfgFile string

func main() {
	root := &cobra.Command{
		Use:   "gocode",
		Short: "AI coding agent with server mode",
	}
	root.PersistentFlags().StringVarP(&cfgFile, "config", "c", "config.yaml", "config file path")

	root.AddCommand(serveCmd())
	root.AddCommand(chatCmd())

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func loadConfig() *config.Config {
	cfg, err := config.Load(cfgFile)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid config: %v", err)
	}
	return cfg
}

// --- serve command ---

func serveCmd() *cobra.Command {
	var host string
	var port int

	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the agent server",
		Run: func(cmd *cobra.Command, args []string) {
			cfg := loadConfig()
			if host != "" {
				cfg.Server.Host = host
			}
			if port != 0 {
				cfg.Server.Port = port
			}

			p := provider.NewOpenAI(cfg.Provider.BaseURL, cfg.Provider.APIKey, cfg.Provider.Model)
			workDir, _ := os.Getwd()
			t := tools.NewRegistry(workDir)
			a := agent.New(p, t, cfg.Agent.SystemPrompt, cfg.Agent.MaxIterations, workDir)
			sessions := agent.NewSessionStore()

			srv := server.New(a, sessions)
			addr := server.Addr(cfg.Server.Host, cfg.Server.Port)

			fmt.Printf("\n  gocode server running\n")
			fmt.Printf("  ├─ http://%s\n", addr)
			fmt.Printf("  ├─ model: %s\n", cfg.Provider.Model)
			fmt.Printf("  └─ ws://%s/ws/{sessionID}\n\n", addr)

			if err := srv.ListenAndServe(addr); err != nil {
				log.Fatal(err)
			}
		},
	}
	cmd.Flags().StringVar(&host, "host", "", "server host (overrides config)")
	cmd.Flags().IntVar(&port, "port", 0, "server port (overrides config)")
	return cmd
}

// --- chat command ---

func chatCmd() *cobra.Command {
	var serverAddr string
	var sessionID string

	cmd := &cobra.Command{
		Use:   "chat [message]",
		Short: "Send a message to the agent (interactive REPL if no message given)",
		Args:  cobra.ArbitraryArgs,
		Run: func(cmd *cobra.Command, args []string) {
			if sessionID == "" {
				sessionID = fmt.Sprintf("cli-%d", time.Now().UnixNano())
			}

			// Connect via WebSocket
			u := url.URL{Scheme: "ws", Host: serverAddr, Path: fmt.Sprintf("/ws/%s", sessionID)}
			conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
			if err != nil {
				log.Fatalf("Failed to connect to server at %s: %v", serverAddr, err)
			}
			defer conn.Close()

			// Handle interrupt
			interrupt := make(chan os.Signal, 1)
			signal.Notify(interrupt, os.Interrupt)
			go func() {
				<-interrupt
				fmt.Println("\nBye!")
				conn.Close()
				os.Exit(0)
			}()

			// One-shot mode
			if len(args) > 0 {
				message := strings.Join(args, " ")
				sendAndStream(conn, message)
				return
			}

			// Interactive REPL mode
			fmt.Println("\033[36m  gocode interactive\033[0m")
			fmt.Println("  Type your message and press Enter. Commands:")
			fmt.Println("  /quit     Exit")
			fmt.Println("  /clear    Start a new session")
			fmt.Println("  /session  Show current session ID")
			fmt.Println()

			scanner := bufio.NewScanner(os.Stdin)
			for {
				fmt.Print("\033[32m> \033[0m")
				if !scanner.Scan() {
					break
				}
				input := strings.TrimSpace(scanner.Text())
				if input == "" {
					continue
				}

				// Handle commands
				switch input {
				case "/quit", "/exit", "/q":
					fmt.Println("Bye!")
					return
				case "/clear":
					// Reconnect with new session
					conn.Close()
					sessionID = fmt.Sprintf("cli-%d", time.Now().UnixNano())
					u = url.URL{Scheme: "ws", Host: serverAddr, Path: fmt.Sprintf("/ws/%s", sessionID)}
					conn, _, err = websocket.DefaultDialer.Dial(u.String(), nil)
					if err != nil {
						log.Fatalf("Failed to reconnect: %v", err)
					}
					fmt.Println("\033[90mSession cleared.\033[0m")
					continue
				case "/session":
					fmt.Printf("\033[90mSession: %s\033[0m\n", sessionID)
					continue
				}

				sendAndStream(conn, input)
			}
		},
	}
	cmd.Flags().StringVar(&serverAddr, "server", "127.0.0.1:3000", "server address")
	cmd.Flags().StringVarP(&sessionID, "session", "s", "", "session ID (auto-generated if empty)")
	return cmd
}

// sendAndStream sends a message and prints streamed events until done.
func sendAndStream(conn *websocket.Conn, message string) {
	msg := map[string]string{"type": "message", "content": message}
	if err := conn.WriteJSON(msg); err != nil {
		fmt.Printf("\033[31mFailed to send: %v\033[0m\n", err)
		return
	}

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			fmt.Printf("\033[31mConnection lost: %v\033[0m\n", err)
			return
		}

		var event agent.Event
		if err := json.Unmarshal(raw, &event); err != nil {
			continue
		}

		switch event.Type {
		case "text_delta":
			fmt.Print(event.Content)
		case "tool_call":
			fmt.Printf("\n\033[33m⚡ %s\033[0m(%s)\n", event.ToolName, event.ToolArgs)
		case "tool_result":
			result := event.Content
			if len(result) > 500 {
				result = result[:500] + "..."
			}
			fmt.Printf("\033[90m   → %s\033[0m\n", strings.ReplaceAll(result, "\n", "\n     "))
		case "error":
			fmt.Printf("\n\033[31mError: %s\033[0m\n", event.Content)
		case "done":
			fmt.Println()
			return
		}
	}
}
