package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type loopbackFixtureRuntime struct {
	*fixtureRuntime
	url string
}

func (r loopbackFixtureRuntime) command(kind string, args map[string]any, result any) error {
	if kind != "prepare" {
		return r.fixtureRuntime.command(kind, args, result)
	}
	var prepared map[string]any
	if err := r.fixtureRuntime.command(kind, args, &prepared); err != nil {
		return err
	}
	prepared["url"] = r.url
	return assign(prepared, result)
}

func TestDirectStreamEmitsOnlyJSONAndClosesOnDone(t *testing.T) {
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(": heartbeat\n\nevent: chunk\ndata: {\"model\":\"fixture\",\"choices\":[{\"delta\":{\"content\":\"direct\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(cancelled)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	emitted := make(chan []byte, 8)
	closed := make(chan string, 1)
	p, rt := fixturePlugin(func(method string, request any, result any) error {
		switch method {
		case "host.stream.emit":
			emitted <- bytes.Clone(request.(map[string]any)["payload"].([]byte))
		case "host.stream.close":
			closed <- request.(map[string]string)["error"]
		default:
			return errors.New("direct loopback must not use a host HTTP callback")
		}
		return nil
	})
	p.proxy = "http://proxy.invalid:8080"
	p.runtime = loopbackFixtureRuntime{fixtureRuntime: rt, url: server.URL}
	p.localCalls["direct-id"] = &localCall{ctx: ctx, cancel: cancel}
	_, err := p.Handle("executor.execute_stream", wire(t, executorRequest{
		Model: "ofm/fixture", Payload: []byte(`{"messages":[]}`), StreamID: "down",
		Headers: http.Header{executionHeader: {"direct-id"}},
	}))
	if err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-closed:
		if message != "" {
			t.Fatal(message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("direct stream waited for EOF after DONE")
	}
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream was not closed on DONE")
	}
	p.Close()
	if len(emitted) != 1 {
		t.Fatalf("expected only one JSON chunk, got %d", len(emitted))
	}
	payload := <-emitted
	if !json.Valid(payload) || !bytes.Contains(payload, []byte(`"model":"ofm/fixture"`)) {
		t.Fatalf("executor payload is framed or malformed: %q", payload)
	}
}

func TestModelRouterOnlyClaimsItsCatalog(t *testing.T) {
	p, _ := fixturePlugin(nil)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		model   string
		handled bool
	}{{"ofm/fixture", true}, {"ofm/fixture(high)", true}, {"fixture", false}, {"ofm/unknown", false}} {
		value, err := p.Handle("model.route", wire(t, map[string]string{"RequestedModel": tc.model}))
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Handled    bool
			TargetKind string
		}
		if err := assign(value, &result); err != nil {
			t.Fatal(err)
		}
		if result.Handled != tc.handled || result.Handled && result.TargetKind != "self" {
			t.Fatalf("route %s = %+v", tc.model, result)
		}
	}
}

func TestDirectLoopbackUsesLifecycleAndNeverFollowsRedirect(t *testing.T) {
	got := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- r.Header.Get("Authorization")
		w.Header().Set("Location", "https://example.invalid/do-not-follow")
		w.WriteHeader(302)
	}))
	defer server.Close()
	p, _ := fixturePlugin(nil)
	if _, err := p.Handle("model.static", nil); err != nil {
		t.Fatal(err)
	}
	_, err := p.Handle("request.intercept_after", wire(t, map[string]string{"RequestID": "test-id", "Model": "ofm/fixture"}))
	if err != nil {
		t.Fatal(err)
	}
	request := executorRequest{Headers: http.Header{executionHeader: {"test-id"}}}
	prepared := preparedCall{Request: hostRequest{URL: server.URL, Headers: http.Header{"Authorization": {"Bearer private"}}, Body: []byte("{}")}}
	response, err := p.localHTTP(request, prepared)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 302 || <-got != "Bearer private" {
		t.Fatal("local HTTP redirect policy failed")
	}
	_, _ = p.Handle("request.complete", wire(t, map[string]string{"RequestID": "test-id"}))
	if _, err := p.localHTTP(request, prepared); err == nil {
		t.Fatal("completed request reused")
	}
}

func TestDirectLoopbackCancellationInterruptsIdleRead(t *testing.T) {
	started := make(chan struct{})
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	p, _ := fixturePlugin(nil)
	ctx, cancel := context.WithCancel(context.Background())
	p.localCalls["cancel-id"] = &localCall{ctx: ctx, cancel: cancel}
	request := executorRequest{Headers: http.Header{executionHeader: {"cancel-id"}}}
	response, err := p.localHTTP(request, preparedCall{Request: hostRequest{URL: server.URL, Headers: http.Header{}, Body: []byte("{}")}})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	<-started
	_, _ = p.Handle("request.complete", wire(t, map[string]string{"RequestID": "cancel-id"}))
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("idle loopback HTTP request was not cancelled")
	}
}

func TestGlobalProxyDetection(t *testing.T) {
	p := newPlugin(nil)
	for _, proxy := range []string{"", "direct", " NONE "} {
		p.proxy = proxy
		if p.needsDirectLoopback() {
			t.Fatalf("unexpected special path for %q", proxy)
		}
	}
	p.proxy = "http://proxy.invalid:8080"
	if !p.needsDirectLoopback() {
		t.Fatal("private IPC would be sent to global proxy")
	}
}

func TestHostStreamHTTPStatusFailures(t *testing.T) {
	for _, status := range []int{401, 403, 404, 429, 503} {
		closed := false
		p, _ := fixturePlugin(func(method string, request any, out any) error {
			switch method {
			case "host.http.operation_open":
				return assign(map[string]string{"operation_id": "op"}, out)
			case "host.http.do_stream":
				return assign(httpStreamResponse{StatusCode: status, StreamID: "up"}, out)
			case "host.http.stream_close":
				closed = true
				return nil
			case "host.http.cancel":
				return nil
			default:
				t.Fatalf("unexpected callback: %s", method)
			}
			return nil
		})
		_, err := p.Handle("executor.execute_stream", wire(t, executorRequest{Model: "ofm/fixture", StreamID: "down", Payload: []byte(`{"messages":[]}`)}))
		failure, ok := err.(*rpcError)
		if !ok || failure.HTTPStatus != status || !closed {
			t.Fatalf("stream status %d: %v closed=%v", status, err, closed)
		}
	}
}

func TestManagementAllowlistAndDisabledRegistration(t *testing.T) {
	p, _ := fixturePlugin(nil)
	for _, route := range []string{"/v0/resource/plugins/our-free-model/console/open", "/v0/management/ofm/console/extra", "/v0/management/ofm/private"} {
		value, err := p.Handle("management.handle", wire(t, managementRequest{Path: route, Method: "GET"}))
		if err != nil || value.(httpResponse).StatusCode != 404 {
			t.Fatalf("management route %s was accepted", route)
		}
	}
	for _, method := range []string{"executor.count_tokens", "executor.http_request"} {
		_, err := p.Handle(method, []byte("{}"))
		if err.(*rpcError).HTTPStatus != 501 {
			t.Fatal("unsupported capability was fabricated")
		}
	}
	config := lifecycleRequest{ConfigYAML: []byte("enabled: false\n"), SchemaVersion: 6}
	_, err := p.Handle("plugin.reconfigure", wire(t, config))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Handle("model.static", nil); err == nil {
		t.Fatal("disabled plugin is active")
	}
}

func TestWireBytesUseBase64(t *testing.T) {
	raw, err := encodeResult(executorResponse{Payload: []byte("{}")})
	if err != nil {
		t.Fatal(err)
	}
	var result envelope
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if !result.OK || !strings.Contains(string(result.Result), `"Payload":"e30="`) {
		t.Fatalf("invalid C ABI byte encoding: %s", raw)
	}
}
