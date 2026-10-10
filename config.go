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
				{"data-dir", "string", "私有数据绝对路径；默认位于用户配置目录的 cli-proxy-api/our-free-model。"},
				{"node-path", "string", "Node.js 22.19+ 或 24+ 可执行文件；留空则搜索 PATH 与私有运行时缓存。"},
				{"auto-install-node", "boolean", "缺少合适的 Node 时，下载固定版本并校验 SHA-256；默认开启。"},
				{"auto-install-eac", "boolean", "启用原项目固定版本的 EAC 来源下载，仍需完成原项目授权；默认关闭。"},
				{"eac-source-dir", "string", "可选：可信的本机原项目源码目录，将执行其原有 EAC 独立入口。"},
				{"port", "integer", "OFM 内部回环端口；默认 0 自动分配。远程控制台无需开放此端口。"},
				{"console-port", "integer", "仅供显式本机直连使用的交接端口；默认 0。日常控制台通过 CPA 域名访问。"},
				{"model-prefix", "string", "CPA 模型 ID 前缀，默认 ofm/，避免与其他供应商重名。"},
				{"refresh-models", "boolean", "允许 OFM 自动刷新上游模型目录；默认开启。"},
				{"catalog-revision", "integer", "修改此整数触发 CPA 重新注册模型，无需重启 OFM 服务。"},
			},
		},
		Capabilities: map[string]any{
			"model_provider": true, "model_router": true, "executor": true, "executor_model_scope": "static",
			"request_interceptor": true, "request_lifecycle_plugin": true,
			"response_before_translator": true,
			"executor_input_formats":     []string{"chat-completions"},
			"executor_output_formats":    []string{"chat-completions"}, "management_api": true,
		},
	}
}
