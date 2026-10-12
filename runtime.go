package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type connection struct {
	Base string `json:"url"`
	Key  string `json:"key"`
}

type runtimeReply struct {
	Type  string          `json:"type"`
	ID    uint64          `json:"id"`
	Value json.RawMessage `json:"value"`
	Error string          `json:"error"`
}

type serviceRuntime struct {
	config config
	mu     sync.Mutex
	child  *serviceChild
}

type serviceChild struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	done    chan struct{}
	ready   chan runtimeReply
	writeMu sync.Mutex
	mu      sync.Mutex
	calls   map[uint64]chan runtimeReply
	next    atomic.Uint64
}

func (r *serviceRuntime) ensure() (*serviceChild, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.child != nil {
		select {
		case <-r.child.done:
			r.child = nil
		default:
			return r.child, nil
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	if err := os.MkdirAll(r.config.DataDir, 0700); err != nil {
		return nil, err
	}
	root, err := extractService(r.config.DataDir)
	if err != nil {
		return nil, err
	}
	node, err := resolveNode(ctx, r.config)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(node, filepath.Join(root, "runner.mjs"))
	cmd.Env = childEnvironment()
	cmd.Dir = root
	hideProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	// Do not send vendor logs, possibly containing credentials, to the CPA log.
	cmd.Stderr = io.Discard
	child := &serviceChild{cmd: cmd, stdin: stdin, done: make(chan struct{}), ready: make(chan runtimeReply, 1), calls: make(map[uint64]chan runtimeReply)}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("could not start the private Node service")
	}
	go child.read(stdout)
	settings := map[string]any{
		"dataDir": r.config.DataDir, "port": r.config.Port, "consolePort": r.config.ConsolePort,
		"refresh": r.config.Refresh, "autoInstallEac": r.config.AutoInstallEAC,
		"parentPid": os.Getpid(),
	}
	if r.config.EACSourceDir != "" {
		settings["eacSourceDir"] = r.config.EACSourceDir
	}
	if err := child.write(settings); err != nil {
		child.close()
		return nil, err
	}
	select {
	case reply := <-child.ready:
		if reply.Type != "ready" {
			child.close()
			return nil, fmt.Errorf("OFM service startup failed: %s", reply.Error)
		}
	case <-child.done:
		child.close()
		return nil, fmt.Errorf("OFM service exited during startup; check private configuration and Node version")
	case <-ctx.Done():
		child.close()
		return nil, fmt.Errorf("OFM service startup timed out")
	}
	r.child = child
	return child, nil
}

func (c *serviceChild) read(stdout io.ReadCloser) {
	scanner := bufio.NewScanner(stdout)
	// Control envelopes wrap the same 8 MiB inference payload, plus metadata.
	scanner.Buffer(make([]byte, 4096), 16*1024*1024)
	for scanner.Scan() {
		var reply runtimeReply
		if json.Unmarshal(scanner.Bytes(), &reply) != nil {
			continue
		}
		if reply.Type == "ready" || reply.Type == "error" {
			select {
			case c.ready <- reply:
			default:
			}
		} else if reply.ID != 0 {
			c.mu.Lock()
			ch := c.calls[reply.ID]
			delete(c.calls, reply.ID)
			c.mu.Unlock()
			if ch != nil {
				ch <- reply
			}
		}
	}
	_ = stdout.Close()
	_ = c.stdin.Close()
	if scanner.Err() != nil {
		// A broken reader cannot service any future command. Do not leave a
		// live process parked behind an open stdin and a never-closed done channel.
		_ = c.cmd.Process.Kill()
	}
	watchdog := time.AfterFunc(5*time.Second, func() { _ = c.cmd.Process.Kill() })
	_ = c.cmd.Wait()
	watchdog.Stop()
	close(c.done)
}

func (c *serviceChild) write(value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return json.NewEncoder(c.stdin).Encode(value)
}

func (r *serviceRuntime) command(kind string, payload map[string]any, result any) error {
	c, err := r.ensure()
	if err != nil {
		return err
	}
	id := c.next.Add(1)
	if payload == nil {
		payload = make(map[string]any)
	}
	payload["id"], payload["type"] = id, kind
	reply := make(chan runtimeReply, 1)
	c.mu.Lock()
	c.calls[id] = reply
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.calls, id); c.mu.Unlock() }()
	if err := c.write(payload); err != nil {
		return fmt.Errorf("OFM service control pipe closed")
	}
	timer := time.NewTimer(15 * time.Second)
	if kind == "models" || kind == "eac-warmup" {
		timer.Reset(45 * time.Second)
	}
	defer timer.Stop()
	select {
	case value := <-reply:
		if value.Error != "" {
			return fmt.Errorf("%s", value.Error)
		}
		if result == nil {
			return nil
		}
		return json.Unmarshal(value.Value, result)
	case <-c.done:
		return fmt.Errorf("OFM service stopped")
	case <-timer.C:
		return fmt.Errorf("OFM service control request timed out")
	}
}

func (r *serviceRuntime) connection() (connection, error) {
	var result connection
	if err := r.command("connection", nil, &result); err != nil {
		return result, err
	}
	u, err := url.Parse(result.Base)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || result.Key == "" {
		return connection{}, fmt.Errorf("OFM service returned an invalid loopback connection")
	}
	return result, nil
}

func (c *serviceChild) close() {
	_ = c.stdin.Close()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-c.done:
	case <-timer.C:
		_ = c.cmd.Process.Kill()
		<-c.done
	}
}

func (r *serviceRuntime) close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.child != nil {
		r.child.close()
		r.child = nil
	}
}
