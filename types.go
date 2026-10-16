package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

const pluginID = "our-free-model"

// Keep in lockstep with package.json; a release tag must match both.
var version = "0.5.6"

// These wire types intentionally avoid linking a second copy of the CPA server.
// CPA C ABI v1 uses PascalCase for SDK structs and snake_case for RPC envelopes.
type envelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"http_status,omitempty"`
}

func (e *rpcError) Error() string { return e.Message }

func problem(status int, code, message string) error {
	return &rpcError{Code: code, Message: message, HTTPStatus: status}
}

type hostCaller func(method string, request any, result any) error

type metadata struct {
	Name             string
	Version          string
	Author           string
	GitHubRepository string
	Logo             string
	ConfigFields     []configField
}

type configField struct {
	Name        string
	Type        string
	Description string
}

type registration struct {
	SchemaVersion uint32         `json:"schema_version"`
	Metadata      metadata       `json:"metadata"`
	Capabilities  map[string]any `json:"capabilities"`
}

type lifecycleRequest struct {
	ConfigYAML    []byte `json:"config_yaml"`
	SchemaVersion uint32 `json:"schema_version"`
}

type executorRequest struct {
	Model           string
	Format          string
	SourceFormat    string
	Payload         []byte
	OriginalRequest []byte
	Stream          bool
	Headers         http.Header
	Metadata        map[string]any
	StreamID        string `json:"stream_id,omitempty"`
	HostCallbackID  string `json:"host_callback_id,omitempty"`
}

type executorResponse struct {
	Payload []byte
	Headers http.Header
}

type httpResponse struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

type hostRequest struct {
	HostCallbackID string      `json:"host_callback_id,omitempty"`
	OperationID    string      `json:"operation_id,omitempty"`
	Method         string      `json:"method"`
	URL            string      `json:"url"`
	Headers        http.Header `json:"headers"`
	Body           []byte      `json:"body,omitempty"`
}

type httpStreamResponse struct {
	StatusCode int         `json:"status_code"`
	Headers    http.Header `json:"headers"`
	StreamID   string      `json:"stream_id"`
}

type httpStreamChunk struct {
	Payload []byte `json:"payload"`
	Error   string `json:"error"`
	Done    bool   `json:"done"`
}

type modelRow struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Context   int64    `json:"context_window"`
	MaxTokens int64    `json:"max_tokens"`
	Input     []string `json:"input"`
	Efforts   []string `json:"efforts"`
}

type modelInfo struct {
	ID                         string
	Object                     string
	OwnedBy                    string
	Type                       string
	DisplayName                string
	Name                       string
	ContextLength              int64
	MaxCompletionTokens        int64
	InputTokenLimit            int64
	OutputTokenLimit           int64
	SupportedGenerationMethods []string
	SupportedInputModalities   []string
	SupportedOutputModalities  []string
	SupportedParameters        []string
	Thinking                   *thinkingSupport `json:",omitempty"`
	UserDefined                bool
}

type thinkingSupport struct {
	Min            int
	Max            int
	ZeroAllowed    bool
	DynamicAllowed bool
	Levels         []string
}

type modelResponse struct {
	Provider string
	Models   []modelInfo
}

type managementRequest struct {
	Method  string
	Path    string
	Headers http.Header
	Body    []byte
}

func decodeRequest(raw []byte, target any) error {
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return problem(400, "invalid_request", "Invalid plugin request JSON")
	}
	return nil
}

func encodeResult(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode plugin result: %w", err)
	}
	return json.Marshal(envelope{OK: true, Result: raw})
}
