package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type releaseFixture struct {
	status int
	body   any
}

func (f releaseFixture) Do(request *http.Request) (*http.Response, error) {
	if request.URL.String() != "https://api.github.com/repos/sy0u1ti/cpa-our-free-model/releases/latest" ||
		request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" {
		panic("release check must only fetch public metadata from its fixed repository")
	}
	body, _ := json.Marshal(f.body)
	return &http.Response{StatusCode: f.status, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
}

func releaseFixtureBody() map[string]any {
	asset := func(name string) map[string]any {
		return map[string]any{"name": name, "state": "uploaded", "size": 1024,
			"browser_download_url": sourceRepository + "/releases/download/v0.4.0/" + name}
	}
	return map[string]any{
		"tag_name": "v0.4.0", "html_url": sourceRepository + "/releases/tag/v0.4.0",
		"assets": []map[string]any{asset("our-free-model_0.4.0_windows_amd64.zip"), asset("checksums.txt")},
	}
}

func TestReleaseCheckDistinguishesInstallableBuildsFromSource(t *testing.T) {
	for _, tc := range []struct {
		name, current, goos, want string
		dirty                     bool
		status                    int
	}{
		{"available", "0.3.0", "windows", "available", false, 200},
		{"current", "0.4.0", "windows", "current", false, 200},
		{"development", "0.5.0", "windows", "development", false, 200},
		{"dirty", "0.3.0", "windows", "development", true, 200},
		{"missing-platform", "0.3.0", "linux", "unpackaged", false, 200},
		{"no-release", "0.3.0", "windows", "unpublished", false, 404},
		{"rate-limit", "0.3.0", "windows", "unavailable", false, 429},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := fetchReleaseInfo(context.Background(), releaseFixture{tc.status, releaseFixtureBody()}, tc.current, tc.dirty, tc.goos, "amd64")
			if info.State != tc.want || info.RegistryURL != updateRegistryURL || info.Platform != tc.goos+"/amd64" {
				t.Fatalf("unexpected release state: %+v", info)
			}
			if info.State == "available" && (info.Tag != "v0.4.0" || info.Archive != "our-free-model_0.4.0_windows_amd64.zip") {
				t.Fatal("release is not pinned to the native host package naming contract")
			}
		})
	}
}

func TestReleaseCheckRejectsUnsafeOrIncompleteMetadata(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(map[string]any)
		want string
	}{
		{"draft", func(body map[string]any) { body["draft"] = true }, "unavailable"},
		{"prerelease", func(body map[string]any) { body["prerelease"] = true }, "unavailable"},
		{"invalid-tag", func(body map[string]any) { body["tag_name"] = "../0.4.0" }, "unavailable"},
		{"foreign-release", func(body map[string]any) { body["html_url"] = "https://evil.invalid/release" }, "unavailable"},
		{"missing-checksum", func(body map[string]any) { body["assets"] = body["assets"].([]map[string]any)[:1] }, "unpackaged"},
		{"foreign-asset", func(body map[string]any) {
			body["assets"].([]map[string]any)[0]["browser_download_url"] = "https://evil.invalid/asset"
		}, "unavailable"},
		{"wrong-tag-asset", func(body map[string]any) {
			body["assets"].([]map[string]any)[0]["browser_download_url"] = sourceRepository + "/releases/download/v0.3.0/our-free-model_0.4.0_windows_amd64.zip"
		}, "unavailable"},
		{"empty-asset", func(body map[string]any) { body["assets"].([]map[string]any)[0]["size"] = 0 }, "unavailable"},
		{"oversized-asset", func(body map[string]any) { body["assets"].([]map[string]any)[0]["size"] = 129 * 1024 * 1024 }, "unavailable"},
		{"upload-in-progress", func(body map[string]any) { body["assets"].([]map[string]any)[0]["state"] = "new" }, "unavailable"},
		{"duplicate-asset", func(body map[string]any) {
			assets := body["assets"].([]map[string]any)
			body["assets"] = append(assets, assets[0])
		}, "unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := releaseFixtureBody()
			tc.edit(body)
			info := fetchReleaseInfo(context.Background(), releaseFixture{200, body}, "0.3.0", false, "windows", "amd64")
			if info.State != tc.want {
				t.Fatalf("got %s, want %s", info.State, tc.want)
			}
		})
	}
}
