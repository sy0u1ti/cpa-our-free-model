package main

import (
	"bytes"
	"html"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"text/scanner"
)

var pluginIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,47}$`)
var pluginAssetPattern = regexp.MustCompile(`^[A-Za-z0-9._@+-]+(?:/[A-Za-z0-9._@+-]+)*$`)
var pluginHTMLReferencePattern = regexp.MustCompile(`(?i)\b(src|href|poster)\s*=\s*("[^"]*"|'[^']*')`)

func validPluginAsset(name string) bool {
	if len(name) > 200 || !pluginAssetPattern.MatchString(name) || path.Clean(name) != name {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".mjs", ".js", ".css", ".html", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff2", ".json", ".txt":
		return true
	default:
		return false
	}
}

func pluginResourceQuery(request managementRequest) (string, url.Values, bool) {
	if request.Method != "GET" || len(request.Path) > 2048 {
		return "", nil, false
	}
	u, err := url.ParseRequestURI(request.Path)
	if err != nil || u.IsAbs() || u.Host != "" || u.RawPath != "" || u.Fragment != "" {
		return "", nil, false
	}
	if u.Path != consoleResourceBase+"/plugin-cover" && u.Path != consoleResourceBase+"/plugin-asset" {
		return "", nil, false
	}
	query := request.Query
	if query == nil {
		query, err = url.ParseQuery(u.RawQuery)
		if err != nil {
			return "", nil, false
		}
	} else if u.RawQuery != "" {
		return "", nil, false
	}
	for _, values := range query {
		if len(values) != 1 {
			return "", nil, false
		}
	}
	if u.Path == consoleResourceBase+"/plugin-cover" {
		return u.Path, query, len(query) == 1 && pluginIDPattern.MatchString(query.Get("id"))
	}
	return u.Path, query, len(query) == 2 && consoleCallIDPattern.MatchString(query.Get("token")) && validPluginAsset(query.Get("path"))
}

// CPA registers exact resource paths, so each capability's package paths travel
// in the query. Resolve references against the original package file before
// rewriting them; nested stylesheets and ES modules keep their relative base.
func pluginAssetReference(value, token, asset string) string {
	if value == "" || strings.HasPrefix(value, "#") {
		return value
	}
	u, err := url.Parse(value)
	if err != nil || u.IsAbs() || u.Host != "" || u.RawPath != "" || strings.Contains(value, "\\") {
		return value
	}
	var name string
	prefix := "/api/management/plugins/assets/" + token + "/"
	if strings.HasPrefix(u.Path, prefix) {
		name = strings.TrimPrefix(u.Path, prefix)
	} else if strings.HasPrefix(u.Path, "/") {
		return value
	} else {
		name = path.Join(path.Dir(asset), u.Path)
	}
	if !validPluginAsset(name) {
		return value
	}
	result := "./plugin-asset?" + url.Values{"token": {token}, "path": {name}}.Encode()
	if u.Fragment != "" {
		result += "#" + url.PathEscape(u.Fragment)
	}
	return result
}

func rewritePluginHTML(body []byte, token, asset string) []byte {
	return pluginHTMLReferencePattern.ReplaceAllFunc(body, func(match []byte) []byte {
		parts := pluginHTMLReferencePattern.FindSubmatch(match)
		value := string(parts[2])
		value = html.UnescapeString(value[1 : len(value)-1])
		return []byte(string(parts[1]) + `="` + html.EscapeString(pluginAssetReference(value, token, asset)) + `"`)
	})
}

func rewritePluginCSS(body []byte, token, asset string) []byte {
	return engineCSSURLPattern.ReplaceAllFunc(body, func(match []byte) []byte {
		text := string(match)
		value := strings.TrimSpace(text[strings.IndexByte(text, '(')+1 : strings.LastIndexByte(text, ')')])
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[0] == value[len(value)-1] {
			value = value[1 : len(value)-1]
		}
		return []byte(`url("` + pluginAssetReference(value, token, asset) + `")`)
	})
}

func rewritePluginScript(body []byte, token, asset string) []byte {
	var scan scanner.Scanner
	scan.Init(bytes.NewReader(body))
	scan.Error = func(*scanner.Scanner, string) {} // JS single-quoted strings are not Go rune literals.
	var output bytes.Buffer
	last := 0
	declaration, specifier := false, false
	for kind := scan.Scan(); kind != scanner.EOF; kind = scan.Scan() {
		text := scan.TokenText()
		if kind == scanner.Ident {
			switch text {
			case "import":
				declaration, specifier = true, true
			case "export":
				declaration, specifier = true, false
			case "from":
				specifier = declaration
			case "const", "let", "var", "function", "class":
				declaration, specifier = false, false
			default:
				specifier = false
			}
			continue
		}
		if specifier && (kind == scanner.String || kind == scanner.Char) {
			value := text[1 : len(text)-1]
			if !strings.Contains(value, "\\") && (strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../")) {
				start, end := scan.Position.Offset, scan.Pos().Offset
				output.Write(body[last:start])
				output.WriteByte(text[0])
				output.WriteString(pluginAssetReference(value, token, asset))
				output.WriteByte(text[0])
				last = end
			}
			declaration, specifier = false, false
		} else {
			specifier = false
			if kind == ';' || kind == '(' || kind == '.' {
				declaration = false
			}
		}
	}
	output.Write(body[last:])
	return output.Bytes()
}

func (p *plugin) pluginResource(request managementRequest) (httpResponse, bool) {
	route, query, ok := pluginResourceQuery(request)
	if !ok {
		return httpResponse{}, false
	}
	token, asset := query.Get("token"), query.Get("path")
	cover := route == consoleResourceBase+"/plugin-cover"
	target, limit := "/api/management/plugins/assets/"+token+"/"+asset, int64(2*1024*1024)
	if cover {
		target, limit = "/api/management/plugins/cover?id="+url.QueryEscape(query.Get("id")), 192*1024
	}
	response := p.fetchConsoleAsset(target, limit)
	if response.StatusCode != http.StatusOK {
		return response, true
	}
	mediaType, _, err := mime.ParseMediaType(response.Headers.Get("Content-Type"))
	if err != nil {
		return jsonHTTP(502, map[string]string{"error": "plugin asset content type refused"}), true
	}
	if cover {
		ok = mediaType == "image/png" || mediaType == "image/jpeg" || mediaType == "image/webp" || mediaType == "image/svg+xml"
	} else if mediaType == "application/json" && strings.ToLower(path.Ext(asset)) == ".json" || mediaType == "text/plain" && strings.ToLower(path.Ext(asset)) == ".txt" {
		ok = true
	} else {
		_, ok = engineContentType(asset, mediaType)
	}
	if !ok {
		return jsonHTTP(502, map[string]string{"error": "plugin asset content type refused"}), true
	}
	if !cover {
		switch mediaType {
		case "text/html":
			response.Body = rewritePluginHTML(response.Body, token, asset)
		case "text/css":
			response.Body = rewritePluginCSS(response.Body, token, asset)
		case "text/javascript", "application/javascript":
			response.Body = rewritePluginScript(response.Body, token, asset)
		}
	}
	contentType := mediaType
	if strings.HasPrefix(mediaType, "text/") || mediaType == "application/javascript" || mediaType == "application/json" {
		contentType += "; charset=utf-8"
	}
	response.Headers = http.Header{
		"Content-Type": {contentType}, "Cache-Control": {"no-store"},
		"X-Content-Type-Options": {"nosniff"}, "Referrer-Policy": {"no-referrer"},
		// CPA's resource middleware supplies CORS. Emitting it here as well
		// produces "*, *", which browsers reject for opaque-origin modules.
		"Cross-Origin-Resource-Policy": {"cross-origin"},
		"Content-Security-Policy":      {"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"},
	}
	return response, true
}
