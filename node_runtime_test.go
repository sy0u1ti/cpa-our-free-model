package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadVerifierRejectsWrongHashAndRedirect(t *testing.T) {
	redirect := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if redirect {
			w.Header().Set("Location", "https://example.invalid/untrusted")
			w.WriteHeader(302)
			return
		}
		_, _ = w.Write([]byte("fixture-runtime-not-executable"))
	}))
	defer server.Close()
	digest := sha256.Sum256([]byte("fixture-runtime-not-executable"))
	dir := t.TempDir()
	if err := downloadVerified(context.Background(), server.URL, filepath.Join(dir, "good"), hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	if err := downloadVerified(context.Background(), server.URL, filepath.Join(dir, "wrong"), strings.Repeat("0", 64)); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	redirect = true
	if err := downloadVerified(context.Background(), server.URL, filepath.Join(dir, "redirect"), hex.EncodeToString(digest[:])); err == nil {
		t.Fatal("runtime download redirect followed")
	}
}

func TestChildEnvironmentExcludesInjectedLoaders(t *testing.T) {
	for _, key := range []string{"NODE_OPTIONS", "NODE_PATH", "DSH_HOME", "OFM_HOME"} {
		t.Setenv(key, "do-not-inherit")
	}
	for _, item := range childEnvironment() {
		if strings.Contains(item, "do-not-inherit") {
			t.Fatalf("untrusted host runtime setting inherited: %s", item)
		}
	}
}

func TestExplicitNodePathNeverFallsBackToDownload(t *testing.T) {
	dir := t.TempDir()
	_, err := resolveNode(context.Background(), config{DataDir: dir, NodePath: filepath.Join(dir, "missing-node"), AutoInstallNode: true})
	if err == nil || !strings.Contains(err.Error(), "node-path") {
		t.Fatal("invalid explicit Node path was not diagnosed")
	}
	if _, err := os.Stat(filepath.Join(dir, "runtime")); !os.IsNotExist(err) {
		t.Fatal("explicit path triggered automatic installation")
	}
}
