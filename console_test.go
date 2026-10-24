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

// memoryStorageBlock returns the bridge's in-memory Storage shim, so tests can
// assert what may and may not be kept there.
func memoryStorageBlock(script []byte) string {
	const start = "const entries = new Map();"
	const end = "document.documentElement.dataset.cpaEmbedded"
	text := string(script)
	from := strings.Index(text, start)
	if from < 0 {
		return ""
	}
	to := strings.Index(text[from:], end)
	if to < 0 {
		return text[from:]
	}
	return text[from : from+to]
}

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
			if !bytes.Contains(response.Body, []byte(`href="./console-layout.css"`)) {
				t.Fatal("embedded layout stylesheet is missing")
			}
		}
	}
	for _, path := range []string{"/app-assets/../service/runner.mjs", "/app-assets/assets.json", "/app/unknown", "/app-assets/settings.json"} {
		if _, ok := consoleResource(managementRequest{Method: "GET", Path: consoleResourceBase + path}); ok {
			t.Fatalf("unlisted asset served: %s", path)
		}
	}
	if strings.Contains(string(consoleBridgeScript), "Bearer ") || strings.Contains(string(consoleBridgeScript), "managementFixture") {
		t.Fatal("child should not receive the CPA key")
	}
	// The bridge may shadow localStorage with an in-memory Storage, but the shim
	// must stay a dumb key/value store: no credential is seeded into it, and the
	// management key still lives only on the parent page behind postMessage.
	shim := memoryStorageBlock(consoleBridgeScript)
	if shim == "" {
		t.Fatal("in-memory storage shim is missing from the bridge")
	}
	for _, forbidden := range []string{"Bearer", "Authorization", "management"} {
		if strings.Contains(shim, forbidden) {
			t.Fatalf("in-memory storage must not touch credentials (%s)", forbidden)
		}
	}
}

func TestEmbeddedConsoleLayoutStaysScopedAndKeepsNavigation(t *testing.T) {
	for _, selector := range []string{".sidebar", ".console-nav", ".console-sidebar-footer", ".page", ".topbar"} {
		if !bytes.Contains(consoleLayoutStyle, []byte(`:root[data-cpa-embedded="true"] `+selector)) {
			t.Fatalf("missing scoped layout rule for %s", selector)
		}
	}
	if bytes.Contains(managementPage, []byte("100dvh - 104px")) || bytes.Contains(managementPage, []byte("min-height: 560px")) {
		t.Fatal("nested iframe still assumes a fixed toolbar height")
	}
	if !bytes.Contains(managementPage, []byte(`aria-controls="connection-panel"`)) ||
		!bytes.Contains(managementPage, []byte(`rel="noopener noreferrer" hidden>独立打开`)) {
		t.Fatal("missing accessible connection disclosure or isolated external opening")
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
	var body map[string]any
	_ = json.Unmarshal(result.(httpResponse).Body, &body)
	if body["url"] != consoleResourceBase+"/app" || body["mode"] != "same-origin" {
		t.Fatalf("remote URL is not CPA-relative: %+v", body)
	}
}

func TestEACUIHooksMatchOnlyThePinnedBundle(t *testing.T) {
	original, err := serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/channels-HdJ7rqdl.js")
	if err != nil {
		t.Fatal(err)
	}
	response, ok := consoleResource(managementRequest{Method: "GET", Path: consoleResourceBase + "/app-assets/channels-HdJ7rqdl.js"})
	if !ok {
		t.Fatal("missing adapted EAC module")
	}
	for _, patch := range eacConsolePatches {
		if count := bytes.Count(original, []byte(patch[0])); count != 1 {
			t.Fatalf("EAC hook must match exactly once, got %d for %s", count, patch[0])
		}
		if !bytes.Contains(response.Body, []byte(patch[1])) ||
			!strings.Contains(patch[1], patch[0]) && bytes.Contains(response.Body, []byte(patch[0])) {
			t.Fatalf("EAC hook was not applied: %s", patch[0])
		}
	}
}

type eacConsoleFixture struct {
	consoleFixture
	state      string
	connection bool
}

func (r *eacConsoleFixture) command(kind string, payload map[string]any, out any) error {
	if kind == "status" {
		return assign(map[string]any{"eacSource": map[string]string{"state": r.state}}, out)
	}
	if kind == "connection" {
		r.connection = true
	}
	return r.consoleFixture.command(kind, payload, out)
}

func TestEACSourceFailuresRemainDistinctFromGatewayFailures(t *testing.T) {
	p := newPlugin(nil)
	p.accepting = true
	for _, tc := range [][2]string{{"disabled", "eac-disabled"}, {"loading", "eac-loading"}, {"failed", "eac-source-failed"}, {"unavailable", "eac-unavailable"}} {
		for _, route := range []string{"status", "pool", "login/start"} {
			rt := &eacConsoleFixture{state: tc[0]}
			request := consoleProxyRequest{ID: testConsoleID, Path: "/api/management/eac/" + route, Method: "GET"}
			if route == "login/start" {
				request.Method, request.Body = "POST", json.RawMessage(`{}`)
			}
			response := p.proxyConsole(rt, wire(t, request))
			if rt.connection || !bytes.Contains(response.Body, []byte(tc[1])) || bytes.Contains(response.Body, []byte("unreachable")) {
				t.Fatalf("%s %s misclassified or forwarded: %s", tc[0], route, response.Body)
			}
			want := 503
			if route == "status" {
				want = 200
			}
			if response.StatusCode != want {
				t.Fatalf("unexpected status: %d", response.StatusCode)
			}
		}
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
