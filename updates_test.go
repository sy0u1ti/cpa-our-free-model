package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type updateFixture struct {
	revision, version string
	status            int
	seen              []string
}

func (f *updateFixture) Do(r *http.Request) (*http.Response, error) {
	f.seen = append(f.seen, r.URL.String())
	if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
		panic("update metadata received credentials")
	}
	body := `{"sha":"` + f.revision + `"}`
	if r.URL.Host == "raw.githubusercontent.com" {
		body = `{"name":"cpa-our-free-model","version":"` + f.version + `"}`
	}
	return &http.Response{StatusCode: f.status, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestUpdateStatusPinsMetadataWithoutExecutingIt(t *testing.T) {
	revision := strings.Repeat("a", 40)
	for _, tc := range []struct {
		current, commit string
		dirty           bool
		want            string
	}{
		{"0.3.0", revision, false, "current"}, {"0.2.1", revision, false, "available"},
		{"0.3.0", strings.Repeat("b", 40), false, "available"}, {"0.3.0", "unknown", false, "version-match"},
		{"0.3.0", revision, true, "development"}, {"0.4.0", revision, false, "development"},
	} {
		client := &updateFixture{revision: revision, version: "0.3.0", status: 200}
		result := fetchUpdateInfo(context.Background(), client, tc.current, tc.commit, tc.dirty)
		if result.State != tc.want {
			t.Fatalf("got %s want %s", result.State, tc.want)
		}
		if len(client.seen) != 2 || !strings.Contains(client.seen[1], "/"+revision+"/package.json") {
			t.Fatal("metadata was not pinned to resolved commit")
		}
	}
}

func TestFailedOrInvalidUpdateChecksNeverClaimLatest(t *testing.T) {
	for _, client := range []*updateFixture{
		{status: 429}, {status: 200, revision: "../other"}, {status: 200, revision: strings.Repeat("a", 40), version: "not-a-version"},
	} {
		if result := fetchUpdateInfo(context.Background(), client, "0.3.0", "unknown", false); result.State != "unavailable" {
			t.Fatalf("failed lookup claimed %s", result.State)
		}
	}
}
