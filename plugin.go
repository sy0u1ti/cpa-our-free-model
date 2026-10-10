package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

type controlRuntime interface {
	command(string, map[string]any, any) error
	close()
}

type plugin struct {
	lifecycle  sync.Mutex
	mu         sync.Mutex
	active     sync.WaitGroup
	accepting  bool
	config     config
	runtime    controlRuntime
	models     []modelInfo
	operations map[string]string
	localCalls map[string]*localCall
	proxy      string
	call       hostCaller
}

func newPlugin(caller hostCaller) *plugin {
	return &plugin{call: caller, operations: make(map[string]string), localCalls: make(map[string]*localCall)}
}

func (p *plugin) begin() (config, controlRuntime, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.accepting || p.runtime == nil {
		return config{}, nil, problem(503, "plugin_disabled", "Our Free Model is disabled or stopping")
	}
	p.active.Add(1)
	return p.config, p.runtime, nil
}

func (p *plugin) configure(raw []byte) (any, error) {
	var request lifecycleRequest
	if err := decodeRequest(raw, &request); err != nil {
		return nil, err
	}
	cfg, err := parseConfig(request.ConfigYAML)
	if err != nil {
		return nil, err
	}
	p.lifecycle.Lock()
	defer p.lifecycle.Unlock()
	p.mu.Lock()
	same := p.config == cfg && (p.accepting || !cfg.Enabled)
	p.mu.Unlock()
	if !same {
		p.stop()
		p.mu.Lock()
		p.config = cfg
		p.accepting = cfg.Enabled
		p.runtime = &serviceRuntime{config: cfg}
		p.models = nil
		p.mu.Unlock()
	}
	return pluginRegistration(request.SchemaVersion), nil
}

func (p *plugin) Close() {
	p.lifecycle.Lock()
	defer p.lifecycle.Unlock()
	p.stop()
}

func (p *plugin) stop() {
	p.mu.Lock()
	p.accepting = false
	rt := p.runtime
	operations := make(map[string]string, len(p.operations))
	for id, callback := range p.operations {
		operations[id] = callback
	}
	for id, call := range p.localCalls {
		call.cancel()
		delete(p.localCalls, id)
	}
	p.mu.Unlock()
	for id, callback := range operations {
		_ = p.call("host.http.cancel", map[string]string{"operation_id": id, "host_callback_id": callback}, nil)
	}
	p.active.Wait()
	if rt != nil {
		rt.close()
	}
}

func (p *plugin) Handle(method string, raw []byte) (any, error) {
	switch method {
	case "plugin.register", "plugin.reconfigure":
		return p.configure(raw)
	case "plugin.quiesce", "plugin.shutdown":
		p.Close()
		return map[string]any{}, nil
	case "executor.identifier":
		return map[string]string{"identifier": pluginID}, nil
	case "response.normalize_before":
		var request struct {
			FromFormat, ToFormat, Model string
			Stream                      bool
			Body                        []byte
		}
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		p.mu.Lock()
		owned := p.accepting && p.ownsModelLocked(request.Model)
		if p.accepting && !owned {
			for _, call := range p.localCalls {
				if call.model == request.Model {
					owned = true
					break
				}
			}
		}
		p.mu.Unlock()
		// CPA 8.0.23's OpenAI-to-Claude translator requires a data line, unlike
		// its Chat handler. Restore it only at this converter's input boundary.
		if owned && request.Stream && request.FromFormat == "openai" && request.ToFormat == "claude" &&
			(json.Valid(request.Body) || bytes.Equal(bytes.TrimSpace(request.Body), []byte("[DONE]"))) {
			request.Body = append([]byte("data: "), request.Body...)
		}
		return struct{ Body []byte }{request.Body}, nil
	case "request.intercept_before":
		return map[string]any{}, nil
	case "request.intercept_after":
		var request struct{ RequestID, Model string }
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.accepting && request.RequestID != "" && p.ownsModelLocked(request.Model) {
			if p.localCalls[request.RequestID] == nil {
				ctx, cancel := context.WithCancel(context.Background())
				p.localCalls[request.RequestID] = &localCall{ctx: ctx, cancel: cancel, model: request.Model}
			}
			return map[string]any{"Headers": http.Header{executionHeader: {request.RequestID}}}, nil
		}
		return map[string]any{}, nil
	case "request.complete":
		var request struct{ RequestID string }
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		p.mu.Lock()
		if call := p.localCalls[request.RequestID]; call != nil {
			call.cancel()
			delete(p.localCalls, request.RequestID)
		}
		p.mu.Unlock()
		return map[string]any{}, nil
	case "model.route":
		var request struct{ RequestedModel string }
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.accepting && p.ownsModelLocked(request.RequestedModel) {
			return map[string]any{"Handled": true, "TargetKind": "self"}, nil
		}
		return map[string]bool{"Handled": false}, nil
	case "management.register":
		return managementRegistration(), nil
	case "management.handle":
		var request managementRequest
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		// CPA menu resources are public. Never start a service or mint tickets here.
		if request.Path == "/v0/resource/plugins/"+pluginID+"/console" && request.Method == "GET" {
			return httpResponse{StatusCode: 200, Headers: pageHeaders(), Body: managementPage}, nil
		}
		return p.management(request)
	case "model.static", "model.register":
		var request struct{ Host struct{ ProxyURL string } }
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		p.mu.Lock()
		p.proxy = request.Host.ProxyURL
		p.mu.Unlock()
		cfg, rt, err := p.begin()
		if err != nil {
			return nil, err
		}
		defer p.active.Done()
		return p.discover(cfg, rt)
	case "executor.execute", "executor.execute_stream":
		var request executorRequest
		if err := decodeRequest(raw, &request); err != nil {
			return nil, err
		}
		cfg, rt, err := p.begin()
		if err != nil {
			return nil, err
		}
		if method == "executor.execute_stream" {
			return p.executeStream(cfg, rt, request)
		}
		defer p.active.Done()
		return p.execute(cfg, rt, request)
	case "executor.count_tokens":
		return nil, problem(501, "not_supported", "OFM does not expose an exact token-count endpoint; token usage is returned after inference")
	case "executor.http_request":
		return nil, problem(501, "not_supported", "Arbitrary HTTP forwarding is not supported by this plugin")
	default:
		return nil, problem(400, "unknown_method", "Unsupported Our Free Model plugin method")
	}
}

func (p *plugin) ownsModelLocked(model string) bool {
	if strings.HasSuffix(model, ")") {
		if start := strings.LastIndexByte(model, '('); start >= 0 {
			model = model[:start]
		}
	}
	for _, row := range p.models {
		if row.ID == model {
			return true
		}
	}
	return false
}

func (p *plugin) discover(cfg config, rt controlRuntime) (modelResponse, error) {
	var rows []modelRow
	err := rt.command("models", nil, &rows)
	p.mu.Lock()
	defer p.mu.Unlock()
	if err != nil {
		if p.models != nil {
			return modelResponse{Provider: pluginID, Models: append([]modelInfo{}, p.models...)}, nil
		}
		return modelResponse{}, err
	}
	models := make([]modelInfo, 0, len(rows))
	seen := make(map[string]bool)
	for _, row := range rows {
		if row.ID == "" || strings.ContainsAny(row.ID, "\r\n\t") || seen[row.ID] {
			continue
		}
		seen[row.ID] = true
		model := modelInfo{
			ID: cfg.ModelPrefix + row.ID, Object: "model", OwnedBy: pluginID, Type: "openai",
			Name: row.ID, DisplayName: row.Name, ContextLength: row.Context,
			InputTokenLimit: row.Context, MaxCompletionTokens: row.MaxTokens, OutputTokenLimit: row.MaxTokens,
			SupportedInputModalities: row.Input, SupportedOutputModalities: []string{"text"},
			SupportedGenerationMethods: []string{"chat"},
			SupportedParameters:        []string{"tools", "tool_choice", "temperature", "max_tokens"}, UserDefined: true,
		}
		if len(row.Efforts) > 0 {
			model.Thinking = &thinkingSupport{Levels: row.Efforts}
			for _, level := range row.Efforts {
				if level == "off" || level == "none" || level == "disabled" {
					model.Thinking.ZeroAllowed = true
				}
			}
			model.SupportedParameters = append(model.SupportedParameters, "reasoning_effort")
		}
		models = append(models, model)
	}
	// An authoritative empty result clears the cache; a transport failure does not.
	p.models = models
	return modelResponse{Provider: pluginID, Models: append([]modelInfo{}, models...)}, nil
}

func managementRegistration() any {
	routes := []map[string]string{}
	for _, item := range [][2]string{{"GET", "status"}, {"POST", "console"}, {"GET", "models"}} {
		routes = append(routes, map[string]string{"Method": item[0], "Path": "/ofm/" + item[1]})
	}
	return map[string]any{"routes": routes, "resources": []map[string]string{{
		"Path": "/console", "Menu": "Our Free Model", "Description": "OFM console (CPA management authentication required)",
	}}}
}

func pageHeaders() http.Header {
	return http.Header{
		"Content-Type": {"text/html; charset=utf-8"}, "Cache-Control": {"no-store"},
		"Referrer-Policy": {"no-referrer"}, "X-Content-Type-Options": {"nosniff"},
		"Content-Security-Policy": {"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"},
	}
}

func (p *plugin) management(request managementRequest) (any, error) {
	key := request.Method + " " + request.Path
	if key != "GET /v0/management/ofm/status" && key != "GET /v0/management/ofm/models" && key != "POST /v0/management/ofm/console" {
		return httpResponse{StatusCode: 404, Body: []byte("Not found")}, nil
	}
	cfg, rt, err := p.begin()
	if err != nil {
		return nil, err
	}
	defer p.active.Done()
	var value any
	switch key {
	case "GET /v0/management/ofm/models":
		value, err = p.discover(cfg, rt)
	case "GET /v0/management/ofm/status":
		err = rt.command("status", nil, &value)
	case "POST /v0/management/ofm/console":
		var link string
		err = rt.command("console", nil, &link)
		value = map[string]string{"url": link}
	}
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(value)
	return httpResponse{StatusCode: 200, Headers: http.Header{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}}, Body: body}, err
}
