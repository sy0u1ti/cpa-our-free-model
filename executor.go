package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

type preparedCall struct {
	Request hostRequest
	Model   string
}

const maxInferenceBodyBytes = 8 * 1024 * 1024

func (p *plugin) prepare(cfg config, rt controlRuntime, request executorRequest, stream bool) (preparedCall, error) {
	if len(request.Payload) > maxInferenceBodyBytes {
		return preparedCall{}, problem(413, "request_too_large", "OFM supports request bodies up to 8 MiB")
	}
	if request.Format != "" && request.Format != "openai" && request.Format != "chat-completions" {
		return preparedCall{}, problem(400, "unsupported_format", "CPA must translate this request to Chat Completions")
	}
	model := request.Model
	var effort string
	if strings.HasSuffix(model, ")") {
		if start := strings.LastIndexByte(model, '('); start >= 0 {
			effort, model = model[start+1:len(model)-1], model[:start]
		}
	}
	if !strings.HasPrefix(model, cfg.ModelPrefix) || len(model) == len(cfg.ModelPrefix) {
		return preparedCall{}, problem(404, "model_not_found", "Model is not owned by Our Free Model")
	}
	var body map[string]json.RawMessage
	if err := decodeRequest(request.Payload, &body); err != nil || body == nil {
		return preparedCall{}, problem(400, "invalid_request", "Expected a Chat Completions request object")
	}
	if body["user"] == nil {
		if session, ok := request.Metadata["canonical_session_id"].(string); ok && session != "" {
			scope, _ := request.Metadata["caller_scope"].(string)
			digest := sha256.Sum256([]byte(scope + "\x00" + session))
			body["user"], _ = json.Marshal("cpa-" + hex.EncodeToString(digest[:16]))
		}
	}
	encodedBody, err := json.Marshal(body)
	if err != nil {
		return preparedCall{}, err
	}
	if len(encodedBody) > maxInferenceBodyBytes {
		return preparedCall{}, problem(413, "request_too_large", "Normalized OFM request exceeds 8 MiB")
	}
	args := map[string]any{"model": strings.TrimPrefix(model, cfg.ModelPrefix), "body": body}
	if effort != "" {
		args["effort"] = effort
	}
	var prepared struct {
		Admitted bool            `json:"admitted"`
		Invalid  bool            `json:"invalid"`
		URL      string          `json:"url"`
		Key      string          `json:"key"`
		Body     json.RawMessage `json:"body"`
	}
	if err := rt.command("prepare", args, &prepared); err != nil {
		return preparedCall{}, err
	}
	if !prepared.Admitted {
		return preparedCall{}, problem(404, "model_not_found", "Model is unavailable or disabled; check the OFM console and refresh the CPA catalog")
	}
	if prepared.Invalid {
		return preparedCall{}, problem(400, "invalid_request", "Invalid request or unsupported reasoning effort for this OFM model")
	}
	u, err := url.Parse(prepared.URL)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || prepared.Key == "" {
		return preparedCall{}, problem(502, "invalid_service", "Invalid OFM loopback service connection")
	}
	if err := json.Unmarshal(prepared.Body, &body); err != nil || body == nil {
		return preparedCall{}, problem(502, "invalid_service", "OFM returned an invalid prepared payload")
	}
	body["stream"] = json.RawMessage("false")
	if stream {
		body["stream"] = json.RawMessage("true")
		var options map[string]json.RawMessage
		_ = json.Unmarshal(body["stream_options"], &options)
		if options == nil {
			options = make(map[string]json.RawMessage)
		}
		options["include_usage"] = json.RawMessage("true")
		body["stream_options"], _ = json.Marshal(options)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return preparedCall{}, err
	}
	if len(payload) > maxInferenceBodyBytes {
		return preparedCall{}, problem(413, "request_too_large", "Normalized OFM request exceeds 8 MiB")
	}
	accept := "application/json"
	if stream {
		accept = "text/event-stream"
	}
	return preparedCall{Model: model, Request: hostRequest{
		HostCallbackID: request.HostCallbackID, Method: "POST", URL: prepared.URL + "/v1/chat/completions", Body: payload,
		Headers: http.Header{"Content-Type": {"application/json"}, "Accept": {accept}, "Authorization": {"Bearer " + prepared.Key}},
	}}, nil
}

func (p *plugin) operation(request *hostRequest) (func(), error) {
	var opened struct {
		ID string `json:"operation_id"`
	}
	if err := p.call("host.http.operation_open", map[string]string{"host_callback_id": request.HostCallbackID}, &opened); err != nil {
		return nil, err
	}
	if opened.ID == "" {
		return nil, fmt.Errorf("CPA returned an empty HTTP operation ID")
	}
	request.OperationID = opened.ID
	p.mu.Lock()
	accepting := p.accepting
	if accepting {
		p.operations[opened.ID] = request.HostCallbackID
	}
	p.mu.Unlock()
	var once sync.Once
	finish := func() {
		once.Do(func() {
			_ = p.call("host.http.cancel", map[string]string{"operation_id": opened.ID, "host_callback_id": request.HostCallbackID}, nil)
			p.mu.Lock()
			delete(p.operations, opened.ID)
			p.mu.Unlock()
		})
	}
	if !accepting {
		finish()
		return nil, problem(503, "plugin_stopping", "Our Free Model is stopping")
	}
	return finish, nil
}

func (p *plugin) execute(cfg config, rt controlRuntime, request executorRequest) (any, error) {
	prepared, err := p.prepare(cfg, rt, request, false)
	if err != nil {
		return nil, err
	}
	if p.needsDirectLoopback() {
		return p.executeDirect(request, prepared)
	}
	finish, err := p.operation(&prepared.Request)
	if err != nil {
		return nil, err
	}
	defer finish()
	var response httpResponse
	if err := p.call("host.http.do", prepared.Request, &response); err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, upstreamError(response.StatusCode)
	}
	if !json.Valid(response.Body) {
		return nil, problem(502, "invalid_response", "OFM returned invalid completion JSON")
	}
	return executorResponse{Payload: rewriteModel(response.Body, prepared.Model), Headers: responseHeaders(response.Headers)}, nil
}

func upstreamError(status int) error {
	if status < 400 || status > 599 {
		status = 502
	}
	return problem(status, "upstream_error", fmt.Sprintf("Our Free Model returned HTTP %d; check its local console for details", status))
}

func responseHeaders(headers http.Header) http.Header {
	out := make(http.Header)
	for name, values := range headers {
		switch strings.ToLower(name) {
		case "content-type", "cache-control", "retry-after", "x-request-id", "x-ofm-request-id", "x-accel-buffering":
			out[http.CanonicalHeaderKey(name)] = append([]string{}, values...)
		}
	}
	return out
}

func rewriteModel(raw []byte, model string) []byte {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return raw
	}
	if _, exists := object["model"]; !exists {
		return raw
	}
	object["model"], _ = json.Marshal(model)
	out, err := json.Marshal(object)
	if err != nil {
		return raw
	}
	return out
}

func (p *plugin) executeStream(cfg config, rt controlRuntime, request executorRequest) (result any, err error) {
	if p.needsDirectLoopback() {
		return p.streamDirect(cfg, rt, request)
	}
	async := false
	defer func() {
		if !async {
			p.active.Done()
		}
	}()
	if request.StreamID == "" {
		return nil, problem(400, "invalid_request", "CPA stream_id is required")
	}
	prepared, err := p.prepare(cfg, rt, request, true)
	if err != nil {
		return nil, err
	}
	finish, err := p.operation(&prepared.Request)
	if err != nil {
		return nil, err
	}
	var response httpStreamResponse
	if err := p.call("host.http.do_stream", prepared.Request, &response); err != nil {
		finish()
		return nil, err
	}
	closeUpstream := func() {
		_ = p.call("host.http.stream_close", map[string]string{"stream_id": response.StreamID}, nil)
		finish()
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		closeUpstream()
		return nil, upstreamError(response.StatusCode)
	}
	if response.StreamID == "" {
		closeUpstream()
		return nil, problem(502, "invalid_stream", "CPA did not open an upstream stream")
	}
	async = true
	go func() {
		defer p.active.Done()
		defer closeUpstream()
		streamError := ""
		defer func() {
			_ = p.call("host.stream.close", map[string]string{"stream_id": request.StreamID, "error": streamError}, nil)
		}()
		emit := func(payload []byte) error {
			return p.call("host.stream.emit", map[string]any{"stream_id": request.StreamID, "payload": rewriteModel(payload, prepared.Model)}, nil)
		}
		framer := sseFramer{emit: emit}
		for {
			var chunk httpStreamChunk
			if err := p.call("host.http.stream_read", map[string]string{"stream_id": response.StreamID}, &chunk); err != nil {
				streamError = "OFM stream was interrupted or cancelled"
				return
			}
			if err := framer.push(chunk.Payload); err != nil {
				streamError = "OFM stream delivery failed"
				return
			}
			if framer.done {
				return
			}
			if chunk.Error != "" {
				streamError = "OFM upstream stream failed"
				return
			}
			if chunk.Done {
				if err := framer.finish(); err != nil {
					streamError = "OFM stream ended with an incomplete event"
				}
				return
			}
		}
	}()
	return map[string]any{"headers": responseHeaders(response.Headers)}, nil
}

type sseFramer struct {
	pending []byte
	emit    func([]byte) error
	done    bool
}

func (s *sseFramer) push(chunk []byte) error {
	if s.done {
		return nil
	}
	s.pending = append(s.pending, chunk...)
	for {
		index, width := bytes.Index(s.pending, []byte("\n\n")), 2
		crlf := bytes.Index(s.pending, []byte("\r\n\r\n"))
		if crlf >= 0 && (index < 0 || crlf < index) {
			index, width = crlf, 4
		}
		if index < 0 {
			break
		}
		if index > 8*1024*1024 {
			return fmt.Errorf("SSE event exceeds size limit")
		}
		frame := bytes.Clone(s.pending[:index+width])
		s.pending = s.pending[index+width:]
		if err := s.dispatch(frame); err != nil {
			return err
		}
		if s.done {
			s.pending = nil
			return nil
		}
	}
	if len(s.pending) > 8*1024*1024 {
		return fmt.Errorf("SSE event exceeds size limit")
	}
	return nil
}

func (s *sseFramer) dispatch(frame []byte) error {
	var data [][]byte
	var event string
	for _, line := range bytes.Split(bytes.ReplaceAll(frame, []byte("\r\n"), []byte("\n")), []byte("\n")) {
		field, value, _ := bytes.Cut(line, []byte(":"))
		value = bytes.TrimPrefix(value, []byte(" "))
		switch string(field) {
		case "data":
			data = append(data, value)
		case "event":
			event = string(value)
		}
	}
	if event == "error" {
		return problem(502, "upstream_stream_error", "OFM reported an upstream stream error")
	}
	payload := bytes.TrimSpace(bytes.Join(data, []byte("\n")))
	if len(payload) == 0 {
		return nil
	}
	if bytes.Equal(payload, []byte("[DONE]")) {
		// CPA owns downstream SSE framing and emits its terminal marker on close.
		s.done = true
		return nil
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(payload, &object) != nil || object == nil {
		return problem(502, "invalid_stream", "OFM returned invalid SSE JSON")
	}
	if failure := object["error"]; len(failure) != 0 && string(failure) != "null" {
		return problem(502, "upstream_stream_error", "OFM reported an upstream stream error")
	}
	// Multi-line SSE data is one event; compact it before CPA adds one data line.
	var compact bytes.Buffer
	if err := json.Compact(&compact, payload); err != nil {
		return err
	}
	return s.emit(compact.Bytes())
}

func (s *sseFramer) finish() error {
	if len(bytes.TrimSpace(s.pending)) == 0 {
		return nil
	}
	return fmt.Errorf("incomplete SSE event")
}
