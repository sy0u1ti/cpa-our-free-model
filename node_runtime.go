package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const nodeVersion = "24.21.0"

// Digests verified directly against the official Node release SHASUMS256.txt.
var nodeHashes = map[string]string{
	"linux-x64":      "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff",
	"linux-arm64":    "724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5",
	"linux-x64-musl": "3d63405fc65a0d2d2976c1f0bc2fd27bb0bd07212469e705aac3f03ae5ab4c9c",
	"darwin-x64":     "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
	"darwin-arm64":   "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
	"windows-x64":    "ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32",
	"windows-arm64":  "dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7",
}

func childEnvironment() []string {
	var env []string
	for _, item := range os.Environ() {
		name, _, _ := strings.Cut(item, "=")
		switch strings.ToUpper(name) {
		case "NODE_OPTIONS", "NODE_PATH", "DSH_HOME", "OFM_HOME":
			continue
		}
		env = append(env, item)
	}
	return env
}

func probeNode(ctx context.Context, binary string) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "--version")
	cmd.Env = childEnvironment()
	hideProcess(cmd)
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(string(out)), "v"), ".")
	if len(parts) != 3 {
		return false
	}
	major, _ := strconv.Atoi(parts[0])
	minor, _ := strconv.Atoi(parts[1])
	return major == 22 && minor >= 19 || major >= 24
}

func nodeTarget() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	target := runtime.GOOS + "-" + arch
	if runtime.GOOS == "linux" {
		if _, err := os.Stat("/etc/alpine-release"); err == nil {
			target += "-musl"
		}
	}
	return target
}

func resolveNode(ctx context.Context, cfg config) (string, error) {
	if cfg.NodePath != "" {
		if probeNode(ctx, cfg.NodePath) {
			located, err := exec.LookPath(cfg.NodePath)
			if err != nil {
				return "", err
			}
			return filepath.Abs(located)
		}
		return "", fmt.Errorf("node-path is not a working Node.js 22.19+ or 24+ executable")
	}
	if binary, err := exec.LookPath("node"); err == nil && probeNode(ctx, binary) {
		return filepath.Abs(binary)
	}
	target := nodeTarget()
	root := filepath.Join(cfg.DataDir, "runtime")
	dir := filepath.Join(root, "node-v"+nodeVersion+"-"+target)
	entry := filepath.Join("bin", "node")
	if runtime.GOOS == "windows" {
		entry = "node.exe"
	}
	binary := filepath.Join(dir, entry)
	if probeNode(ctx, binary) {
		return binary, nil
	}
	if !cfg.AutoInstallNode {
		return "", fmt.Errorf("Node.js 22.19+ or 24+ is required; set node-path or enable auto-install-node")
	}
	hash, supported := nodeHashes[target]
	if !supported {
		return "", fmt.Errorf("automatic Node installation does not support %s; set node-path", target)
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(root, ".node-install-")
	if err != nil {
		return "", err
	}
	defer func() { _ = safeRemoveAll(stage, root) }()
	name := "node-v" + nodeVersion + "-" + target + ".tar.gz"
	if runtime.GOOS == "windows" {
		name = "win-" + strings.TrimPrefix(target, "windows-") + "/node.exe"
	}
	archive := filepath.Join(stage, "download")
	if err := downloadVerified(ctx, "https://nodejs.org/download/release/v"+nodeVersion+"/"+name, archive, hash); err != nil {
		return "", err
	}
	extracted := filepath.Join(stage, "extracted")
	if err := os.Mkdir(extracted, 0700); err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		if err := os.Rename(archive, filepath.Join(extracted, entry)); err != nil {
			return "", err
		}
	} else {
		cmd := exec.CommandContext(ctx, "tar", "-xzf", archive, "--no-same-owner", "--no-same-permissions", "--strip-components=1", "-C", extracted)
		hideProcess(cmd)
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("cannot extract verified Node archive; install tar or set node-path")
		}
	}
	if !probeNode(ctx, filepath.Join(extracted, entry)) {
		return "", fmt.Errorf("downloaded Node cannot run on this OS/libc; install a compatible Node and set node-path")
	}
	if err := os.Rename(extracted, dir); err != nil && !probeNode(ctx, binary) {
		return "", fmt.Errorf("cannot install private Node runtime; remove the incomplete %s directory while CPA is stopped", dir)
	}
	return binary, nil
}

func downloadVerified(ctx context.Context, url, destination, expected string) error {
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("cannot download official Node runtime; check access to nodejs.org or set node-path")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("Node runtime download returned HTTP %d", response.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, 120*1024*1024+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || size > 120*1024*1024 {
		return fmt.Errorf("Node download was incomplete or exceeded its size limit")
	}
	if hex.EncodeToString(hash.Sum(nil)) != expected {
		return fmt.Errorf("Node SHA-256 verification failed; downloaded code was not executed")
	}
	return nil
}
