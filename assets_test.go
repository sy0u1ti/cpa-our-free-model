package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEmbeddedFilesMatchExplicitDistributionManifest(t *testing.T) {
	allowed := map[string]bool{}
	for _, name := range []string{
		"service/package.json", "service/runner.mjs", "service/upstream-eac.json",
		"service/src/catalog.mjs", "service/src/console-tickets.mjs", "service/src/eac-provider.mjs",
		"service/vendor/CPA_LICENSE", "service/vendor/YAML_LICENSE", "service/vendor/WEB_LICENSES.txt", "service/vendor/WEB_LICENSE_SOURCES.json",
		"service/vendor/ofm/UPSTREAM.json",
	} {
		allowed[name] = true
	}
	raw, err := serviceAssets.ReadFile("service/vendor/ofm/UPSTREAM.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Files []struct {
			Path string `json:"path"`
		} `json:"files"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, file := range manifest.Files {
		allowed["service/vendor/ofm/"+file.Path] = true
	}
	files, _, err := assetFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(allowed) {
		t.Fatalf("embedded file count: got %d want %d", len(files), len(allowed))
	}
	for _, name := range files {
		if !allowed[name] {
			t.Errorf("unexpected embedded file: %s", name)
		}
		delete(allowed, name)
	}
	for name := range allowed {
		t.Errorf("missing embedded file: %s", name)
	}
}

func TestEmbedDirectivesCannotCaptureLocalSecrets(t *testing.T) {
	source, err := os.ReadFile("assets.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(source), "\n") {
		if !strings.HasPrefix(line, "//go:embed ") {
			continue
		}
		for _, pattern := range strings.Fields(strings.TrimPrefix(line, "//go:embed ")) {
			if strings.HasPrefix(pattern, "all:") || strings.ContainsAny(pattern, "*?[") {
				t.Fatalf("recursive/glob embed can bundle ignored credentials: %q", pattern)
			}
			info, err := os.Stat(filepath.FromSlash(pattern))
			if err != nil || !info.Mode().IsRegular() {
				t.Fatalf("embed must name a regular file: %q", pattern)
			}
		}
	}
}

func TestAssetVerificationRejectsOversizedCacheFile(t *testing.T) {
	dir := t.TempDir()
	root, err := extractService(dir)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(root, "runner.mjs"), os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(100 * 1024 * 1024); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	_ = file.Close()
	files, _, err := assetFiles()
	if err != nil {
		t.Fatal(err)
	}
	if verifyAssets(root, files) {
		t.Fatal("oversized cached file was accepted")
	}
}

func TestAssetRenameRetriesOnlyTransientPermissionFailures(t *testing.T) {
	for _, tc := range []struct {
		name         string
		failures     int
		failure      error
		calls, waits int
	}{
		{"temporary", 2, os.ErrPermission, 3, 2},
		{"persistent", 10, os.ErrPermission, 6, 5},
		{"other", 2, os.ErrNotExist, 1, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls, waits := 0, 0
			err := renameAssetDirectory("stage", "target", func(source, target string) error {
				if source != "stage" || target != "target" {
					t.Fatal("rename changed paths")
				}
				calls++
				if calls <= tc.failures {
					return &os.PathError{Op: "rename", Path: source, Err: tc.failure}
				}
				return nil
			}, func(time.Duration) { waits++ })
			if calls != tc.calls || waits != tc.waits {
				t.Fatalf("calls=%d waits=%d", calls, waits)
			}
			if tc.name == "temporary" && err != nil {
				t.Fatal(err)
			}
			if tc.name != "temporary" && !errors.Is(err, tc.failure) {
				t.Fatalf("original failure lost: %v", err)
			}
		})
	}
}
