package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type config struct {
	Enabled         bool   `yaml:"enabled"`
	DataDir         string `yaml:"data-dir"`
	NodePath        string `yaml:"node-path"`
	AutoInstallNode bool   `yaml:"auto-install-node"`
	AutoInstallEAC  bool   `yaml:"auto-install-eac"`
	EACSourceDir    string `yaml:"eac-source-dir"`
	Port            int    `yaml:"port"`
	ConsolePort     int    `yaml:"console-port"`
	ModelPrefix     string `yaml:"model-prefix"`
	Refresh         bool   `yaml:"refresh-models"`
}

func parseConfig(raw []byte) (config, error) {
	base := os.Getenv("OFM_CPA_HOME")
	if base == "" {
		user, err := os.UserConfigDir()
		if err != nil {
			return config{}, fmt.Errorf("resolve private data directory: %w", err)
		}
		base = filepath.Join(user, "cli-proxy-api", pluginID)
	}
	cfg := config{
		DataDir: base, NodePath: os.Getenv("OFM_CPA_NODE"), AutoInstallNode: true,
		ModelPrefix: "ofm/", Refresh: true,
	}
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return config{}, problem(400, "invalid_config", "Invalid Our Free Model configuration; check field types")
	}
	if !filepath.IsAbs(cfg.DataDir) {
		return config{}, problem(400, "invalid_config", "data-dir must be an absolute path")
	}
	cfg.DataDir = filepath.Clean(cfg.DataDir)
	if cfg.EACSourceDir != "" && !filepath.IsAbs(cfg.EACSourceDir) {
		return config{}, problem(400, "invalid_config", "eac-source-dir must be an absolute path")
	}
	if cfg.Port < 0 || cfg.Port > 65535 || cfg.ConsolePort < 0 || cfg.ConsolePort > 65535 ||
		cfg.Port != 0 && cfg.Port == cfg.ConsolePort {
		return config{}, problem(400, "invalid_config", "port and console-port must be distinct ports from 0 to 65535 (0 selects a free port)")
	}
	if len(cfg.ModelPrefix) > 80 || strings.ContainsAny(cfg.ModelPrefix, " \t\r\n()\\?#") {
		return config{}, problem(400, "invalid_config", "model-prefix must not contain whitespace, parentheses, URL delimiters or backslashes")
	}
	return cfg, nil
}

func pluginRegistration(schema uint32) registration {
	if schema == 0 || schema > 6 {
		schema = 6
	}
	return registration{
		SchemaVersion: schema,
		Metadata: metadata{
			Name: "Our Free Model", Version: version, Author: "CPA adapter contributors; original OFM contributors",
			GitHubRepository: "https://github.com/sy0u1ti/cpa-our-free-model",
			ConfigFields: []configField{
				{"data-dir", "string", "Private absolute data path. Default: user config/cli-proxy-api/our-free-model."},
				{"node-path", "string", "Node.js 22.19+ or 24+ executable; empty searches PATH and the private runtime cache."},
				{"auto-install-node", "boolean", "Download a pinned, checksum-verified Node runtime if no suitable Node is installed (default true)."},
				{"auto-install-eac", "boolean", "Opt in to the pinned original EAC source download; original GitHub authorization remains required (default false)."},
				{"eac-source-dir", "string", "Optional trusted local OFM source directory. Executes its original standalone EAC entry point."},
				{"port", "integer", "Loopback model/control service port; default 0 selects a free port."},
				{"console-port", "integer", "Loopback one-use browser handoff port; default 0 selects a free port."},
				{"model-prefix", "string", "CPA model ID prefix (default ofm/), preventing collisions with other providers."},
				{"refresh-models", "boolean", "Allow OFM automatic upstream catalog refresh (default true)."},
				{"catalog-revision", "integer", "Change this value to republish the current OFM catalog to CPA without restarting the service."},
			},
		},
		Capabilities: map[string]any{
			"model_provider": true, "model_router": true, "executor": true, "executor_model_scope": "static",
			"request_interceptor": true, "request_lifecycle_plugin": true,
			"executor_input_formats":  []string{"chat-completions"},
			"executor_output_formats": []string{"chat-completions"}, "management_api": true,
		},
	}
}
