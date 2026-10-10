package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

type consoleFixture struct {
	url   string
	calls int
}

func (r *consoleFixture) close() {}
func (r *consoleFixture) command(kind string, payload map[string]any, out any) error {
	r.calls++
	if kind == "connection" {
		return assign(connection{Base: r.url, Key: "ofm-private-fixture-key"}, out)
	}
	return assign(map[string]any{"running": true}, out)
}

const testConsoleID = "0123456789abcdef0123456789abcdef"

func TestSameOriginConsoleAssetsArePublicCodeOnly(t *testing.T) {
	p := newPlugin(nil)
	for _, resource := range append(consoleResourcePaths(), "/console") {
		value, err := p.Handle("management.handle", wire(t, managementRequest{Method: "GET", Path: consoleResourceBase + resource}))
		if err != nil {
			t.Fatal(err)
		}
		response := value.(httpResponse)
		if response.StatusCode != 200 || len(response.Body) == 0 {
			t.Fatalf("resource %s: %d", resource, response.StatusCode)
		}
		if p.runtime != nil {
			t.Fatal("reading public code started a private runtime")
		}
		if resource == "/app" {
			if !strings.Contains(string(response.Body), `src="./console-bridge.js"`) || !strings.Contains(string(response.Body), `src="./app-assets/app.js"`) {
				t.Fatal("app paths do not stay on the CPA origin")
			}
		}
	}
	for _, path := range []string{"/app-assets/../service/runner.mjs", "/app-assets/assets.json", "/app/unknown", "/app-assets/settings.json"} {
		if _, ok := consoleResource(managementRequest{Method: "GET", Path: consoleResourceBase + path}); ok {
			t.Fatalf("unlisted asset served: %s", path)
		}
	}
	if strings.Contains(string(consoleBridgeScript), "Bearer ") || strings.Contains(string(consoleBridgeScript), "localStorage") {
		t.Fatal("child should not receive or persist the CPA key")
	}
}

func TestRemoteConsoleLinkIsRelativeWithoutPublicPort(t *testing.T) {
	p := newPlugin(nil)
	p.accepting = true
	p.runtime = &consoleFixture{}
	result, err := p.Handle("management.handle", wire(t, managementRequest{Method: "POST", Path: "/v0/management/ofm/console"}))
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]string
	_ = json.Unmarshal(result.(httpResponse).Body, &body)
	if body["url"] != consoleResourceBase+"/app" || body["mode"] != "same-origin" {
		t.Fatalf("remote URL is not CPA-relative: %+v", body)
	}
}

func TestAdaptedConsoleModulesRemainValidJavaScript(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node is unavailable for syntax validation")
	}
	for _, name := range consoleAssetNames() {
		if !strings.HasSuffix(name, ".js") {
			continue
		}
		response, ok := consoleResource(managementRequest{Method: "GET", Path: consoleResourceBase + "/app-assets/" + name})
		if !ok {
			t.Fatal(name)
		}
		cmd := exec.Command(node, "--input-type=module", "--check")
		cmd.Stdin = bytes.NewReader(response.Body)
		hideProcess(cmd)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", name, err, output)
		}
	}
}

func TestConsoleLabelsStillMatchPinnedWebBundle(t *testing.T) {
	served := make(map[string][]byte)
	for _, name := range consoleAssetNames() {
		if !strings.HasSuffix(name, ".js") {
			continue
		}
		response, ok := consoleResource(managementRequest{Method: "GET", Path: consoleResourceBase + "/app-assets/" + name})
		if !ok {
			t.Fatal(name)
		}
		served[name] = response.Body
	}
	for _, label := range consoleLabels {
		source, _ := json.Marshal(label[0])
		target, _ := json.Marshal(label[1])
		hits := 0
		for _, body := range served {
			if bytes.Contains(body, source) {
				t.Fatalf("label %q survived adaptation for this upstream build", label[0])
			}
			if bytes.Contains(body, target) {
				hits++
			}
		}
		if hits == 0 {
			t.Fatalf("label %q -> %q no longer matches the pinned web bundle; update consoleLabels", label[0], label[1])
		}
	}
}

func TestConsoleProxyAllowlist(t *testing.T) {
	valid := consoleProxyRequest{ID: testConsoleID, Path: "/api/management/summary", Method: "GET"}
	if !validateConsoleRequest(valid) {
		t.Fatal("summary rejected")
	}
	for _, path := range []string{"https://evil.invalid/api/management/summary", "//evil.invalid/api/management/summary", "/api/management/../summary", "/api/management/%73ummary", "/api/management/session", "/api/management/login/terminal", "/v1/models", "/api/management/summary?url=https://evil.invalid", "/api/management/eac/login/poll?link=a&link=b"} {
		request := valid
		request.Path = path
		if validateConsoleRequest(request) {
			t.Errorf("untrusted path accepted: %s", path)
		}
	}
	valid.Path, valid.Method, valid.Body = "/api/management/settings", "POST", json.RawMessage(`{"enabled":true}`)
	if !validateConsoleRequest(valid) {
		t.Fatal("settings rejected")
	}
	valid.Body = json.RawMessage(`[]`)
	if validateConsoleRequest(valid) {
		t.Fatal("array body accepted")
	}
}

func TestConsoleProxyReplacesSecretsAndPreservesControls(t *testing.T) {
	var seenModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ofm-private-fixture-key" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Forwarded-Host") != "" {
			t.Error("caller secrets crossed console hop")
		}
		if r.Header.Get("Origin") != "http://"+r.Host {
			t.Error("internal origin was not scoped to loopback")
		}
		w.Header().Set("Set-Cookie", "should-not-reach-browser=1")
		var body map[string]any
		if r.Method == "POST" {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		if r.URL.Path == "/api/management/models/test" {
			seenModel, _ = body["model"].(string)
		}
		if body["method"] == "gateway.getEnabled" {
			_, _ = io.WriteString(w, `{"ok":true,"value":{"apiKey":{"value":"ofm-private-fixture-key"},"models":[]}}`)
		} else {
			_, _ = io.WriteString(w, `{"ok":true,"settings":{"enabled":true}}`)
		}
	}))
	defer server.Close()
	p := newPlugin(nil)
	p.accepting = true
	p.config.ModelPrefix = "ofm/"
	rt := &consoleFixture{url: server.URL}
	response := p.proxyConsole(rt, wire(t, consoleProxyRequest{ID: testConsoleID, Path: "/api/management/models/test", Method: "POST", Body: json.RawMessage(`{"model":"ofm/test-model"}`)}))
	if response.StatusCode != 200 || seenModel != "test-model" || response.Headers.Get("Set-Cookie") != "" {
		t.Fatalf("bad proxy result: %+v, model=%s", response, seenModel)
	}
	response = p.proxyConsole(rt, wire(t, consoleProxyRequest{ID: testConsoleID, Path: "/api/management/channels/rpc", Method: "POST", Body: json.RawMessage(`{"method":"gateway.getEnabled","payload":{}}`)}))
	if strings.Contains(string(response.Body), "ofm-private-fixture-key") {
		t.Fatal("internal key disclosed by gateway status")
	}
	before := rt.calls
	response = p.proxyConsole(rt, wire(t, consoleProxyRequest{ID: testConsoleID, Path: "/api/management/key", Method: "GET"}))
	if response.StatusCode != 409 || rt.calls != before {
		t.Fatal("private key route reached upstream")
	}
}

func TestConsoleProxyCancelsOnPluginStop(t *testing.T) {
	started, cancelled := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	}))
	defer server.Close()
	p := newPlugin(nil)
	p.accepting = true
	p.runtime = &consoleFixture{url: server.URL}
	done := make(chan struct{})
	go func() {
		_, _ = p.Handle("management.handle", wire(t, managementRequest{Method: "POST", Path: "/v0/management/ofm/console-api", Body: wire(t, consoleProxyRequest{ID: testConsoleID, Method: "GET", Path: "/api/management/summary"})}))
		close(done)
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("proxy did not start")
	}
	p.Close()
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("proxy not cancelled")
	}
	<-done
}
