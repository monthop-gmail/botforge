package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Provider ProviderConfig `yaml:"provider"`
	Server   ServerConfig   `yaml:"server"`
	Agent    AgentConfig    `yaml:"agent"`
}

type ProviderConfig struct {
	BaseURL string `yaml:"base_url"`
	APIKey  string `yaml:"api_key"`
	Model   string `yaml:"model"`
}

type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

type AgentConfig struct {
	SystemPrompt  string `yaml:"system_prompt"`
	MaxIterations int    `yaml:"max_iterations"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Host: "127.0.0.1",
			Port: 3000,
		},
		Agent: AgentConfig{
			MaxIterations: 20,
			SystemPrompt:  "You are a helpful coding assistant with access to file and shell tools.",
		},
	}

	// Load config file if it exists (optional)
	if data, err := os.ReadFile(path); err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parsing config: %w", err)
		}
	}

	// Env vars override config file
	if key := os.Getenv("GOCODE_API_KEY"); key != "" {
		cfg.Provider.APIKey = key
	}
	if url := os.Getenv("GOCODE_BASE_URL"); url != "" {
		cfg.Provider.BaseURL = url
	}
	if model := os.Getenv("GOCODE_MODEL"); model != "" {
		cfg.Provider.Model = model
	}

	return cfg, nil
}

func (c *Config) Validate() error {
	if c.Provider.APIKey == "" {
		return fmt.Errorf("provider.api_key is required (or set GOCODE_API_KEY)")
	}
	if c.Provider.Model == "" {
		return fmt.Errorf("provider.model is required")
	}
	return nil
}
