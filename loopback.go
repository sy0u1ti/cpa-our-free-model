package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

const executionHeader = "X-Ofm-Cpa-Execution"

type localCall struct {
	ctx    context.Context
	cancel context.CancelFunc
	model  string
}

var loopbackTransport = func() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return transport
}()

var loopbackClient = &http.Client{
	Transport:     loopbackTransport,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func (p *plugin) needsDirectLoopback() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	proxy := strings.ToLower(strings.TrimSpace(p.proxy))
	return proxy != "" && proxy != "direct" && proxy != "none"
}

// CPA's native HTTP callback inherits its global proxy even for loopback URLs.
// Local service IPC must never send its key to an external proxy. When a global
// proxy is configured, use direct loopback IPC and CPA lifecycle cancellation.
func (p *plugin) localHTTP(request executorRequest, prepared preparedCall) (*http.Response, error) {
	p.mu.Lock()
	call := p.localCalls[request.Headers.Get(executionHeader)]
	p.mu.Unlock()
	if call == nil {
		return nil, problem(503, "request_cancelled", "OFM request lifecycle is missing or already closed")
	}
	httpRequest, err := http.NewRequestWithContext(call.ctx, "POST", prepared.Request.URL, bytes.NewReader(prepared.Request.Body))
	if err != nil {
		return nil, err
	}
	httpRequest.Header = prepared.Request.Headers
	response, err := loopbackClient.Do(httpRequest)
	if err != nil {
		return nil, problem(502, "local_service_error", "OFM local request failed or was cancelled")
	}
	return response, nil
}

func (p *plugin) executeDirect(request executorRequest, prepared preparedCall) (any, error) {
	response, err := p.localHTTP(request, prepared)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, upstreamError(response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024*1024+1))
	if err != nil || len(body) > 64*1024*1024 || !json.Valid(body) {
		return nil, problem(502, "invalid_response", "OFM returned an invalid or oversized completion")
	}
	return executorResponse{Payload: rewriteModel(body, prepared.Model), Headers: responseHeaders(response.Header)}, nil
}

func (p *plugin) streamDirect(cfg config, rt controlRuntime, request executorRequest) (any, error) {
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
	response, err := p.localHTTP(request, prepared)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_ = response.Body.Close()
		return nil, upstreamError(response.StatusCode)
	}
	async = true
	go func() {
		defer p.active.Done()
		defer response.Body.Close()
		message := ""
		defer func() {
			_ = p.call("host.stream.close", map[string]string{"stream_id": request.StreamID, "error": message}, nil)
		}()
		framer := sseFramer{emit: func(payload []byte) error {
			return p.call("host.stream.emit", map[string]any{"stream_id": request.StreamID, "payload": rewriteModel(payload, prepared.Model)}, nil)
		}}
		buf := make([]byte, 32*1024)
		for {
			n, readErr := response.Body.Read(buf)
			if err := framer.push(buf[:n]); err != nil {
				message = "OFM stream delivery failed"
				return
			}
			if framer.done {
				return
			}
			if readErr != nil {
				if readErr != io.EOF || framer.finish() != nil {
					message = "OFM stream was interrupted or cancelled"
				}
				return
			}
		}
	}()
	return map[string]any{"headers": responseHeaders(response.Header)}, nil
}
