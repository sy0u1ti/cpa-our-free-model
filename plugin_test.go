package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fixtureRuntime struct {
	rows  []modelRow
	fail  bool
	allow bool
}

func (r *fixtureRuntime) command(kind string, args map[string]any, result any) error {
	if r.fail {
		return errors.New("fixture unavailable")
	}
	var value any
	switch kind {
	case "models":
		value = r.rows
	case "prepare":
		body := args["body"].(map[string]json.RawMessage)
		body["model"], _ = json.Marshal(args["model"])
		value = map[string]any{"admitted": r.allow, "url": "http://127.0.0.1:18900", "key": "local-fixture-key", "body": body}
	case "console":
		value = "http://127.0.0.1:18901/open/fixture-ticket"
	case "status":
		value = map[string]any{"running": true}
	default:
		return fmt.Errorf("unexpected control command %s", kind)
	}
	raw, _ := json.Marshal(value)
	return json.Unmarshal(raw, result)
}
func (*fixtureRuntime) close() {}

func fixturePlugin(call hostCaller) (*plugin, *fixtureRuntime) {
	rt := &fixtureRuntime{allow: true, rows: []modelRow{{ID: "fixture", Name: "Fixture", Context: 128000, MaxTokens: 8192, Input: []string{"text", "image"}, Efforts: []string{"light", "balanced", "deep"}}}}
	p := newPlugin(call)
	p.runtime, p.config, p.accepting = rt, config{Enabled: true, ModelPrefix: "ofm/"}, true
	return p, rt
}

func wire(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assign(value, out any) error {
	raw, _ := json.Marshal(value)
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func TestConfigAndRegistration(t *testing.T) {
	cfg, err := parseConfig([]byte("enabled: true\n"))
	if err != nil || !cfg.Enabled || cfg.ModelPrefix != "ofm/" || cfg.AutoInstallEAC || !cfg.AutoInstallNode {
		t.Fatalf("defaults: %+v, %v", cfg, err)
	}
	for _, raw := range []string{"port: -1", "port: 18900\nconsole-port: 18900", "data-dir: relative", "model-prefix: bad(prefix", "auto-install-node: not-a-bool"} {
		if _, err := parseConfig([]byte(raw)); err == nil {
			t.Errorf("accepted invalid config %q", raw)
		}
	}
	reg := pluginRegistration(1)
	if reg.SchemaVersion != 1 || reg.Capabilities["executor_model_scope"] != "static" {
		t.Fatalf("registration: %+v", reg)
	}
	if reg.Metadata.GitHubRepository == "" {
		t.Fatal("CPA requires source metadata for registration")
	}
	if reg.Capabilities["auth_provider"] == true || reg.Capabilities["frontend_auth_provider"] == true {
		t.Fatal("plugin must not replace CPA authentication")
	}
}

func TestModelDiscoveryCacheAndEmpty(t *testing.T) {
	p, rt := fixturePlugin(nil)
	result, err := p.Handle("model.static", []byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	model := result.(modelResponse).Models[0]
	if model.ID != "ofm/fixture" || model.ContextLength != 128000 || model.MaxCompletionTokens != 8192 || model.Thinking.Levels[1] != "balanced" || model.SupportedInputModalities[1] != "image" {
		t.Fatalf("model mapping: %+v", model)
	}
	rt.fail = true
	result, err = p.Handle("model.static", nil)
	if err != nil || len(result.(modelResponse).Models) != 1 {
		t.Fatal("discovery must retain cache on failure")
	}
	rt.fail, rt.rows = false, []modelRow{}
	result, err = p.Handle("model.static", nil)
	if err != nil || len(result.(modelResponse).Models) != 0 {
		t.Fatal("empty successful catalog must clear stale models")
	}
}

func TestPrepareNeverForwardsCallerSecrets(t *testing.T) {
	p, rt := fixturePlugin(nil)
	request := executorRequest{Model: "ofm/fixture(high)", Format: "openai", Payload: []byte(`{"model":"malicious-override","messages":[],"tools":[{"type":"function","function":{"name":"lookup"}}]}`), Headers: http.Header{"Authorization": {"caller-secret"}, "Cookie": {"caller-session"}, "X-Api-Key": {"caller-api-key"}}}
	prepared, err := p.prepare(p.config, rt, request, true)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Request.Headers.Get("Authorization") != "Bearer local-fixture-key" || prepared.Request.Headers.Get("Cookie") != "" || prepared.Request.Headers.Get("X-Api-Key") != "" {
		t.Fatal("caller headers crossed trust boundary")
	}
	if !bytes.Contains(prepared.Request.Body, []byte(`"model":"fixture"`)) || !bytes.Contains(prepared.Request.Body, []byte(`"include_usage":true`)) || !bytes.Contains(prepared.Request.Body, []byte("lookup")) {
		t.Fatalf("invalid payload: %s", prepared.Request.Body)
	}
	rt.allow = false
	if _, err := p.prepare(p.config, rt, request, true); err == nil {
		t.Fatal("disabled model admitted")
	}
	request.Model = "other/fixture"
	if _, err := p.prepare(p.config, rt, request, true); err == nil {
		t.Fatal("unowned model admitted")
	}
}

func TestNonstreamHeadersModelAndErrors(t *testing.T) {
	status := 200
	callback := func(method string, request any, result any) error {
		switch method {
		case "host.http.operation_open":
			return assign(map[string]string{"operation_id": "op"}, result)
		case "host.http.cancel":
			return nil
		case "host.http.do":
			return assign(httpResponse{StatusCode: status, Body: []byte(`{"model":"fixture","choices":[],"usage":{"prompt_tokens":4}}`), Headers: http.Header{"Content-Type": {"application/json"}, "Set-Cookie": {"sensitive"}, "Content-Length": {"99"}, "Retry-After": {"3"}}}, result)
		default:
			return fmt.Errorf("unexpected callback %s", method)
		}
	}
	p, _ := fixturePlugin(callback)
	req := wire(t, executorRequest{Model: "ofm/fixture", Payload: []byte(`{"messages":[]}`), HostCallbackID: "cb"})
	result, err := p.Handle("executor.execute", req)
	if err != nil {
		t.Fatal(err)
	}
	response := result.(executorResponse)
	if !bytes.Contains(response.Payload, []byte(`"model":"ofm/fixture"`)) || response.Headers.Get("Set-Cookie") != "" || response.Headers.Get("Content-Length") != "" || response.Headers.Get("Retry-After") != "3" {
		t.Fatalf("response hygiene: %+v", response)
	}
	for _, code := range []int{401, 403, 404, 429, 503} {
		status = code
		_, err := p.Handle("executor.execute", req)
		var rpc *rpcError
		if !errors.As(err, &rpc) || rpc.HTTPStatus != code {
			t.Fatalf("status %d lost: %v", code, err)
		}
	}
}

func TestSSEFramingAllSplits(t *testing.T) {
	raw := []byte("data: {\"model\":\"fixture\",\"choices\":[]}\r\n\r\n: ping\n\ndata: [DONE]\n\n")
	for split := 0; split <= len(raw); split++ {
		var frames [][]byte
		framer := sseFramer{emit: func(frame []byte) error { frames = append(frames, frame); return nil }}
		if err := framer.push(raw[:split]); err != nil {
			t.Fatal(err)
		}
		if err := framer.push(raw[split:]); err != nil {
			t.Fatal(err)
		}
		if err := framer.finish(); err != nil {
			t.Fatal(err)
		}
		if len(frames) != 3 || !bytes.Contains(rewriteSSEModel(frames[0], "ofm/fixture"), []byte(`"model":"ofm/fixture"`)) {
			t.Fatalf("split %d, frames=%q", split, frames)
		}
	}
	framer := sseFramer{emit: func([]byte) error { return nil }}
	_ = framer.push([]byte("data: incomplete"))
	if framer.finish() == nil {
		t.Fatal("incomplete stream accepted")
	}
	if checkSSEError([]byte("data: {\"error\":{\"message\":\"private upstream detail\"}}\n\n")) == nil {
		t.Fatal("upstream SSE error must become a host stream error for protocol converters")
	}
}

func TestAsyncStreamingDoesNotBufferUntilEnd(t *testing.T) {
	chunks := make(chan httpStreamChunk)
	emitted := make(chan []byte, 8)
	closed := make(chan struct{})
	var once sync.Once
	callback := func(method string, request any, result any) error {
		switch method {
		case "host.http.operation_open":
			return assign(map[string]string{"operation_id": "op"}, result)
		case "host.http.do_stream":
			return assign(httpStreamResponse{StatusCode: 200, StreamID: "upstream", Headers: http.Header{"Content-Type": {"text/event-stream"}}}, result)
		case "host.http.stream_read":
			return assign(<-chunks, result)
		case "host.stream.emit":
			emitted <- request.(map[string]any)["payload"].([]byte)
			return nil
		case "host.stream.close":
			once.Do(func() { close(closed) })
			return nil
		case "host.http.cancel", "host.http.stream_close":
			return nil
		default:
			return fmt.Errorf("unexpected callback: %s", method)
		}
	}
	p, _ := fixturePlugin(callback)
	_, err := p.Handle("executor.execute_stream", wire(t, executorRequest{Model: "ofm/fixture", Payload: []byte(`{"messages":[]}`), StreamID: "downstream", HostCallbackID: "cb"}))
	if err != nil {
		t.Fatal(err)
	}
	chunks <- httpStreamChunk{Payload: []byte("data: {\"model\":\"fixture\",\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n")}
	select {
	case frame := <-emitted:
		if !bytes.Contains(frame, []byte("first")) {
			t.Fatal(string(frame))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first token buffered")
	}
	chunks <- httpStreamChunk{Payload: []byte("data: [DONE]\n\n"), Done: true}
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("stream never closed")
	}
	p.Close()
}

func TestPublicMenuNeverCreatesCredentials(t *testing.T) {
	p := newPlugin(nil)
	result, err := p.Handle("management.handle", wire(t, managementRequest{Method: "GET", Path: "/v0/resource/plugins/our-free-model/console"}))
	if err != nil {
		t.Fatal(err)
	}
	response := result.(httpResponse)
	if response.StatusCode != 200 || !strings.Contains(string(response.Body), "CPA management key") || response.Headers.Get("Cache-Control") != "no-store" {
		t.Fatal("invalid public landing page")
	}
	if p.runtime != nil {
		t.Fatal("public landing started a private runtime")
	}
	for _, forbidden := range []string{"localStorage", "sessionStorage", "local-fixture-key", "fixture-ticket"} {
		if bytes.Contains(response.Body, []byte(forbidden)) {
			t.Fatalf("public resource contains %s", forbidden)
		}
	}
}

func TestEmbeddedExtractionIntegrity(t *testing.T) {
	dir := t.TempDir()
	root, err := extractService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "runner.mjs")); err != nil {
		t.Fatal(err)
	}
	again, err := extractService(dir)
	if err != nil || again != root {
		t.Fatal("verified cache not reused")
	}
	if err := os.WriteFile(filepath.Join(root, "runner.mjs"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := extractService(dir); err == nil {
		t.Fatal("tampered cached code executed")
	}
	if err := safeRemoveAll(dir, dir); err == nil {
		t.Fatal("allowed removal of staging root")
	}
}
