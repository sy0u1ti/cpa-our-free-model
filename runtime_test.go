package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOversizedPayloadIsRejectedBeforeServiceIPC(t *testing.T) {
	p, rt := fixturePlugin(nil)
	rt.fail = true
	_, err := p.prepare(p.config, rt, executorRequest{
		Model: "ofm/fixture", Payload: []byte(`{"messages":[],"large":"` + strings.Repeat("x", 8*1024*1024) + `"}`),
	}, true)
	failure, ok := err.(*rpcError)
	if !ok || failure.HTTPStatus != 413 {
		t.Fatalf("oversized request reached control IPC instead of returning 413: %v", err)
	}
}

func TestNodePathIsAbsoluteBeforeChangingServiceDirectory(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node is not installed")
	}
	current, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(current, node)
	if err != nil {
		t.Skip("Node is on a different filesystem volume")
	}
	resolved, err := resolveNode(context.Background(), config{NodePath: relative})
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(resolved) {
		t.Fatalf("relative node-path breaks once cmd.Dir is set to the extracted service: %q", resolved)
	}
}

func TestServiceChildProtocolHelper(t *testing.T) {
	if os.Getenv("OFM_PROTOCOL_TEST_HELPER") != "1" {
		return
	}
	_, _ = os.Stdout.WriteString(strings.Repeat("x", 17*1024*1024) + "\n")
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}

func TestOversizedControlReplyDoesNotWedgeChild(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestServiceChildProtocolHelper$")
	cmd.Env = append(os.Environ(), "OFM_PROTOCOL_TEST_HELPER=1")
	hideProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	child := &serviceChild{cmd: cmd, stdin: stdin, done: make(chan struct{}), ready: make(chan runtimeReply, 1), calls: make(map[uint64]chan runtimeReply)}
	t.Cleanup(func() { _ = stdin.Close(); _ = cmd.Process.Kill(); <-child.done })
	go child.read(stdout)
	select {
	case <-child.done:
	case <-time.After(5 * time.Second):
		t.Fatal("control reader stopped but its child stayed alive; all future service commands will time out")
	}
}

func TestControlEnvelopeCanExceedInferenceLimit(t *testing.T) {
	value := map[string]any{"id": 1, "value": map[string]string{"body": strings.Repeat("x", 8*1024*1024)}}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	reply := make(chan runtimeReply, 1)
	// Use the current test binary so the child lifecycle is real; the output
	// payload itself is injected through a reader to exercise scanner limits.
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^$")
	hideProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	child := &serviceChild{cmd: cmd, stdin: stdin, done: make(chan struct{}), ready: make(chan runtimeReply, 1), calls: map[uint64]chan runtimeReply{1: reply}}
	child.read(io.NopCloser(strings.NewReader(string(raw) + "\n")))
	select {
	case value := <-reply:
		if len(value.Value) < 8*1024*1024 {
			t.Fatal("control body was truncated")
		}
	default:
		t.Fatal("valid request body plus control metadata exceeded the scanner limit")
	}
}
