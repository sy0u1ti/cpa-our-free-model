package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestPluginResourcesRequireExactQueriesAndPackagePaths(t *testing.T) {
	base := consoleResourceBase + "/plugin-asset?token=" + testConsoleID + "&path="
	for _, asset := range []string{"index.html", "page/main.mjs", "page/@icons/logo.svg", "settings.json"} {
		if _, _, ok := pluginResourceQuery(managementRequest{Method: "GET", Path: base + url.QueryEscape(asset)}); !ok {
			t.Errorf("valid package asset refused: %s", asset)
		}
	}
	for _, asset := range []string{"", "../settings.json", "a/../../settings.json", "/index.html", "a\\index.html", "a//index.html", "file.exe", "http://other/index.html", "%2e%2e/settings.json", "main.js?token=other"} {
		if _, _, ok := pluginResourceQuery(managementRequest{Method: "GET", Path: base + url.QueryEscape(asset)}); ok {
			t.Errorf("unsafe package asset accepted: %s", asset)
		}
	}
	for _, suffix := range []string{"&path=other.js", "&token=" + testConsoleID, "&extra=1"} {
		if _, _, ok := pluginResourceQuery(managementRequest{Method: "GET", Path: base + "index.html" + suffix}); ok {
			t.Errorf("ambiguous query accepted: %s", suffix)
		}
	}
	for _, request := range []managementRequest{
		{Method: "POST", Path: base + "index.html"},
		{Method: "GET", Path: base + "index.html", Query: url.Values{"token": {testConsoleID}, "path": {"index.html"}}},
		{Method: "GET", Path: consoleResourceBase + "/plugin-cover?id=../../private"},
		{Method: "GET", Path: consoleResourceBase + "/plugin-cover?id=model-filter&path=private"},
	} {
		if _, _, ok := pluginResourceQuery(request); ok {
			t.Errorf("invalid resource request accepted: %+v", request)
		}
	}
}

func TestPluginAssetReferencesRetainTheirPackageAndProxyPrefix(t *testing.T) {
	source := []byte(`<head><link href='./css/page.css'><script type="module" src="main.mjs"></script><script src="/api/management/plugins/assets/` + testConsoleID + `/__bridge.js"></script></head>`)
	result := string(rewritePluginHTML(source, testConsoleID, "page/index.html"))
	for _, name := range []string{"page/css/page.css", "page/main.mjs", "__bridge.js"} {
		if !strings.Contains(result, "path="+url.QueryEscape(name)+"&amp;token="+testConsoleID) {
			t.Fatalf("package reference lost: %s in %s", name, result)
		}
	}
	if strings.Contains(result, "/api/management/") {
		t.Fatal("a loopback management resource escaped into the browser HTML")
	}
	css := string(rewritePluginCSS([]byte(`.logo{background:url("icons/logo.svg#mark")} .inline{background:url(data:image/png;base64,AA==)}`), testConsoleID, "page/css/main.css"))
	if !strings.Contains(css, "path=page%2Fcss%2Ficons%2Flogo.svg&token="+testConsoleID+"#mark") || !strings.Contains(css, "data:image/png;base64,AA==") {
		t.Fatalf("CSS package base was lost: %s", css)
	}
	js := []byte("import { title } from './labels.mjs';\nexport { value } from '../shared.mjs';\nimport './startup.mjs';\nconst help = \"import './untouched.js'\";\n// import './comment.js'\n")
	rewritten := string(rewritePluginScript(js, testConsoleID, "page/main.mjs"))
	for _, name := range []string{"page/labels.mjs", "shared.mjs", "page/startup.mjs"} {
		if !strings.Contains(rewritten, "path="+url.QueryEscape(name)+"&token="+testConsoleID) {
			t.Fatalf("module reference lost: %s in %s", name, rewritten)
		}
	}
	if !strings.Contains(rewritten, `"import './untouched.js'"`) || !strings.Contains(rewritten, "// import './comment.js'") {
		t.Fatalf("rewriter changed non-module text: %s", rewritten)
	}
	base, _ := url.Parse("https://cpa.example/proxy" + consoleResourceBase + "/app?layout=embedded")
	ref, _ := url.Parse(pluginAssetReference("main.mjs", testConsoleID, "page/index.html"))
	resolved := base.ResolveReference(ref)
	if resolved.Path != "/proxy"+consoleResourceBase+"/plugin-asset" || resolved.Query().Get("path") != "page/main.mjs" {
		t.Fatalf("reverse proxy prefix lost: %s", resolved)
	}
}

func TestPluginStaticProxyUsesPrivateSessionAndEnforcesContentType(t *testing.T) {
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.String())
		if r.Header.Get("Authorization") != "Bearer ofm-private-fixture-key" || r.Header.Get("Cookie") != "ofm_management_fixture=session-token" {
			t.Error("private session was not attached")
		}
		switch r.URL.Path {
		case "/api/management/plugins/cover":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
		case "/api/management/plugins/assets/" + testConsoleID + "/index.html":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<head><script src="main.js"></script></head>`))
		case "/api/management/plugins/assets/" + testConsoleID + "/cookie.js":
			w.Header().Set("Set-Cookie", "private=secret")
			w.Header().Set("Content-Type", "text/javascript")
		case "/api/management/plugins/assets/" + testConsoleID + "/bad.js":
			w.Header().Set("Content-Type", "text/html")
		default:
			http.Redirect(w, r, "/private", http.StatusFound)
		}
	}))
	defer server.Close()
	p := newPlugin(nil)
	p.accepting = true
	p.runtime = &engineStaticFixture{consoleFixture{url: server.URL}}
	get := func(asset string) httpResponse {
		result, ok := p.pluginResource(managementRequest{Method: "GET", Path: consoleResourceBase + "/plugin-asset",
			Query: url.Values{"token": {testConsoleID}, "path": {asset}}})
		if !ok {
			t.Fatal("registered resource refused")
		}
		return result
	}
	page := get("index.html")
	if page.StatusCode != 200 || !bytes.Contains(page.Body, []byte("./plugin-asset?")) || page.Headers.Get("Set-Cookie") != "" {
		t.Fatalf("invalid page response: %+v", page)
	}
	if policy := page.Headers.Get("Content-Security-Policy"); !strings.Contains(policy, "sandbox allow-scripts") || strings.Contains(policy, "allow-same-origin") || !strings.Contains(policy, "connect-src 'none'") {
		t.Fatalf("plugin page lost its sandbox: %s", policy)
	}
	for _, name := range []string{"cookie.js", "bad.js", "redirect.js"} {
		if response := get(name); response.StatusCode != 502 || bytes.Contains(response.Body, []byte("private=secret")) {
			t.Fatalf("unsafe upstream asset accepted: %s, %+v", name, response)
		}
	}
	cover, ok := p.pluginResource(managementRequest{Method: "GET", Path: consoleResourceBase + "/plugin-cover?id=model-filter"})
	if !ok || cover.StatusCode != 200 || !strings.HasPrefix(cover.Headers.Get("Content-Type"), "image/svg+xml") {
		t.Fatalf("signed cover failed: %+v", cover)
	}
	if seen[len(seen)-1] != "/api/management/plugins/cover?id=model-filter" {
		t.Fatalf("cover query changed: %v", seen)
	}
}

func TestPluginManagementRoutesStayBehindConsoleAuthentication(t *testing.T) {
	for _, route := range []string{"plugins", "plugins/pages", "plugins/audit"} {
		if !validateConsoleRequest(consoleProxyRequest{ID: testConsoleID, Path: "/api/management/" + route, Method: "GET"}) {
			t.Errorf("plugin read route refused: %s", route)
		}
	}
	for _, route := range []string{"install", "install-local", "uninstall", "toggle", "config", "secret", "self-test", "page-rpc", "registry/refresh"} {
		request := consoleProxyRequest{ID: testConsoleID, Path: "/api/management/plugins/" + route, Method: "POST", Body: []byte(`{}`)}
		if !validateConsoleRequest(request) || validateEngineRequest(request) {
			t.Errorf("plugin operation crossed its console boundary: %s", route)
		}
	}
	for _, route := range []string{"/api/management/plugins/cover?id=model-filter", "/api/management/plugins/assets/" + testConsoleID + "/index.html", "/api/management/plugins/arbitrary", "/api/management/desktop-update/download"} {
		if validateConsoleRequest(consoleProxyRequest{ID: testConsoleID, Path: route, Method: "GET"}) {
			t.Errorf("non-JSON or host-only route accepted: %s", route)
		}
	}
}
