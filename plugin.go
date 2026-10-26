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
	lifecycle    sync.Mutex
	mu           sync.Mutex
	active       sync.WaitGroup
	accepting    bool
	config       config
	runtime      controlRuntime
	models       []modelInfo
	operations   map[string]string
	localCalls   map[string]*localCall
	proxy        string
	call         hostCaller
	consoleCalls map[string]context.CancelFunc
	updates      updateCache
	releases     releaseCache
	selection    selectionCache
}

func newPlugin(caller hostCaller) *plugin {
	return &plugin{call: caller, operations: make(map[string]string), localCalls: make(map[string]*localCall), consoleCalls: make(map[string]context.CancelFunc)}
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
	for _, cancel := range p.consoleCalls {
		cancel()
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
		// The workbench's static shell is public code, but its bytes are fetched
		// from the private loopback service with the internal management session.
		if response, ok := p.engineResource(request); ok {
			return response, nil
		}
		// Resource routes contain static code only; all data operations require CPA auth.
		if response, ok := consoleResource(request); ok {
			return response, nil
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
	rows, err := discoverRows(rt)
	p.mu.Lock()
	defer p.mu.Unlock()
	if err != nil {
		if p.models != nil {
			return modelResponse{Provider: pluginID, Models: append([]modelInfo{}, p.models...)}, nil
		}
		return modelResponse{}, err
	}
	// A scope file that cannot be read must not silently re-expose models the
	// user excluded, so it disables discovery instead of degrading to "all".
	hidden, err := p.selection.get(cfg)
	if err != nil {
		return modelResponse{}, err
	}
	skip := selectionSet(hidden)
	models := make([]modelInfo, 0, len(rows))
	seen := make(map[string]bool)
	for _, row := range rows {
		if row.ID == "" || strings.ContainsAny(row.ID, "\r\n\t") || seen[row.ID] {
			continue
		}
		if skip[row.ID] {
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

// discoverRows reads the complete upstream catalog before any sync scope is
// applied, so callers can tell the user what is available as well as what is
// currently synced.
func discoverRows(rt controlRuntime) ([]modelRow, error) {
	var rows []modelRow
	if err := rt.command("models", nil, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// readSelection reports the selectable catalog plus the IDs the user excluded.
// IDs are returned without the CPA prefix so the UI always works on the
// upstream identity, and `hidden` is empty when everything is synced.
func (p *plugin) readSelection(cfg config, rt controlRuntime) (any, error) {
	rows, err := discoverRows(rt)
	if err != nil {
		return nil, err
	}
	hidden, err := p.selection.get(cfg)
	if err != nil {
		return nil, err
	}
	skip := selectionSet(hidden)
	// Only report IDs that still exist upstream; a model that disappeared keeps
	// its saved entry so it stays excluded if the provider brings it back, but
	// the UI should not display phantom rows.
	present := make(map[string]bool, len(rows))
	models := make([]map[string]any, 0, len(rows))
	seen := make(map[string]bool, len(rows))
	for _, row := range rows {
		if row.ID == "" || strings.ContainsAny(row.ID, "\r\n\t") || seen[row.ID] {
			continue
		}
		seen[row.ID] = true
		present[row.ID] = true
		models = append(models, map[string]any{
			"id": row.ID, "name": row.Name, "synced": !skip[row.ID],
			"contextWindow": row.Context, "maxOutput": row.MaxTokens,
		})
	}
	known := make([]string, 0, len(hidden))
	stale := make([]string, 0)
	for _, id := range hidden {
		if present[id] {
			known = append(known, id)
		} else {
			stale = append(stale, id)
		}
	}
	return map[string]any{
		"models": models, "hidden": known, "stale": stale,
		"total": len(models), "syncedCount": len(models) - len(known),
		"modelPrefix": cfg.ModelPrefix,
	}, nil
}

// writeSelection replaces the saved scope. The body carries the IDs to exclude
// (`hidden`) and is validated against the live catalog, so a caller cannot
// persist an entry for a model this service does not offer.
func (p *plugin) writeSelection(cfg config, rt controlRuntime, raw []byte) (any, error) {
	var body struct {
		// A pointer distinguishes an explicit empty list (sync everything) from a
		// request that simply forgot the field, which must not silently widen the
		// scope back to every model.
		Hidden *[]string `json:"hidden"`
	}
	if err := decodeRequest(raw, &body); err != nil {
		return nil, err
	}
	if body.Hidden == nil {
		return nil, problem(400, "invalid_selection", "请求必须包含 hidden 字段；同步全部模型请传空数组。")
	}
	hidden, err := normalizeSelection(*body.Hidden)
	if err != nil {
		return nil, err
	}
	rows, err := discoverRows(rt)
	if err != nil {
		return nil, err
	}
	available := make(map[string]bool, len(rows))
	for _, row := range rows {
		if row.ID != "" {
			available[row.ID] = true
		}
	}
	for _, id := range hidden {
		if !available[id] {
			return nil, problem(400, "unknown_model", "同步范围包含当前目录中不存在的模型："+id)
		}
	}
	if err := p.selection.save(cfg, hidden); err != nil {
		return nil, err
	}
	// Rebuild the CPA catalog now so the change takes effect without waiting for
	// the next discovery cycle.
	models, err := p.discover(cfg, rt)
	if err != nil {
		return nil, err
	}
	return map[string]any{"hidden": hidden, "syncedCount": len(models.Models), "total": len(available)}, nil
}

func managementRegistration() any {
	routes := []map[string]string{}
	for _, item := range [][2]string{{"GET", "status"}, {"POST", "console"}, {"POST", "console-local"}, {"POST", "console-api"}, {"POST", "console-cancel"}, {"GET", "updates"}, {"GET", "releases"}, {"GET", "models"}, {"GET", "selection"}, {"POST", "selection"}} {
		routes = append(routes, map[string]string{"Method": item[0], "Path": "/ofm/" + item[1]})
	}
	resources := []map[string]string{{"Path": "/console", "Menu": "免费模型管理", "Description": "通过当前 CPA 域名管理 OFM，需要 CPA 管理密钥"}}
	for _, path := range consoleResourcePaths() {
		resources = append(resources, map[string]string{"Path": path})
	}
	return map[string]any{"routes": routes, "resources": resources}
}

func pageHeaders() http.Header {
	return http.Header{
		"Content-Type": {"text/html; charset=utf-8"}, "Cache-Control": {"no-store"},
		"Referrer-Policy": {"no-referrer"}, "X-Content-Type-Options": {"nosniff"},
		"Content-Security-Policy": {"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"},
	}
}

func (p *plugin) management(request managementRequest) (any, error) {
	key := request.Method + " " + request.Path
	allowed := map[string]bool{"GET /v0/management/ofm/status": true, "GET /v0/management/ofm/models": true,
		"POST /v0/management/ofm/console": true, "POST /v0/management/ofm/console-local": true,
		"POST /v0/management/ofm/console-api": true, "POST /v0/management/ofm/console-cancel": true,
		"GET /v0/management/ofm/updates": true, "GET /v0/management/ofm/releases": true,
		"GET /v0/management/ofm/selection": true, "POST /v0/management/ofm/selection": true}
	if !allowed[key] {
		return httpResponse{StatusCode: 404, Body: []byte("Not found")}, nil
	}
	if key == "GET /v0/management/ofm/updates" {
		return jsonHTTP(200, p.checkUpdates()), nil
	}
	if key == "GET /v0/management/ofm/releases" {
		return jsonHTTP(200, p.checkRelease()), nil
	}
	if key == "POST /v0/management/ofm/console-cancel" {
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeRequest(request.Body, &body); err != nil {
			return jsonHTTP(400, map[string]string{"error": "无效的取消请求"}), nil
		}
		p.mu.Lock()
		if cancel := p.consoleCalls[body.ID]; cancel != nil {
			cancel()
		}
		p.mu.Unlock()
		return jsonHTTP(200, map[string]bool{"ok": true}), nil
	}
	cfg, rt, err := p.begin()
	if err != nil {
		return nil, err
	}
	defer p.active.Done()
	var value any
	switch key {
	case "GET /v0/management/ofm/selection":
		value, err = p.readSelection(cfg, rt)
	case "POST /v0/management/ofm/selection":
		value, err = p.writeSelection(cfg, rt, request.Body)
	case "GET /v0/management/ofm/models":
		value, err = p.discover(cfg, rt)
	case "GET /v0/management/ofm/status":
		err = rt.command("status", nil, &value)
		if status, ok := value.(map[string]any); ok {
			status["pluginVersion"] = version
			status["sourceRevision"] = sourceRevision
			status["modelPrefix"] = cfg.ModelPrefix
		}
	case "POST /v0/management/ofm/console":
		err = rt.command("eac-warmup", nil, &value)
		value = map[string]any{"url": consoleResourceBase + "/app", "mode": "same-origin", "eacSource": value}
	case "POST /v0/management/ofm/console-api":
		return p.proxyConsole(rt, request.Body), nil
	case "POST /v0/management/ofm/console-local":
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
