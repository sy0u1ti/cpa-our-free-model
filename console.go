package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
)

const consoleResourceBase = "/v0/resource/plugins/our-free-model"

var assetNamePattern = regexp.MustCompile(`^[\w-]+\.(js|css)$`)
var consoleCallIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var engineAssetPattern = regexp.MustCompile(`^(?:[A-Za-z0-9._~-]+/)*[A-Za-z0-9._~-]+$`)
var engineHTMLURLPattern = regexp.MustCompile(`(?i)(src|href|poster)="([^"]*)"`)
var engineCSSURLPattern = regexp.MustCompile(`(?i)url\([^)]*\)`)

func consoleAssetNames() []string {
	raw, err := serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/assets.json")
	if err != nil {
		return nil
	}
	var names []string
	if json.Unmarshal(raw, &names) != nil {
		return nil
	}
	for _, name := range names {
		if !assetNamePattern.MatchString(name) {
			return nil
		}
	}
	return names
}

func consoleResourcePaths() []string {
	paths := []string{"/manager.js", "/updater.js", "/eac-feedback.js", "/console-layout.css", "/console-bridge.js", "/engine-bridge.js", "/app", "/engine"}
	for _, name := range consoleAssetNames() {
		paths = append(paths, "/app-assets/"+name)
	}
	return paths
}

func consoleResource(request managementRequest) (httpResponse, bool) {
	if request.Method != "GET" {
		return httpResponse{}, false
	}
	headers := pageHeaders()
	var body []byte
	switch request.Path {
	case consoleResourceBase + "/console":
		body = managementPage
	case consoleResourceBase + "/manager.js":
		body = managementScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/updater.js":
		body = updaterScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/eac-feedback.js":
		body = eacFeedbackScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/console-layout.css":
		body = consoleLayoutStyle
		headers.Set("Content-Type", "text/css; charset=utf-8")
	case consoleResourceBase + "/console-bridge.js":
		body = consoleBridgeScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/engine-bridge.js":
		body = engineBridgeScript
		headers.Set("Content-Type", "text/javascript; charset=utf-8")
	case consoleResourceBase + "/app":
		original, err := serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/index.html")
		if err != nil {
			return jsonHTTP(500, map[string]string{"error": "控制台资源不可用"}), true
		}
		body = bytes.ReplaceAll(original, []byte(`="/assets/`), []byte(`="./app-assets/`))
		body = bytes.Replace(body, []byte("<head>"), []byte("<head>\n<script src=\"./eac-feedback.js\"></script>\n<script src=\"./console-bridge.js\"></script>"), 1)
		body = bytes.Replace(body, []byte("</head>"), []byte("<link rel=\"stylesheet\" href=\"./console-layout.css\">\n</head>"), 1)
		body = bytes.ReplaceAll(body, []byte("本地控制台"), []byte("CPA 管理控制台"))
		headers.Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
	case consoleResourceBase + "/engine":
		return httpResponse{}, false
	default:
		name := strings.TrimPrefix(request.Path, consoleResourceBase+"/app-assets/")
		if name == request.Path {
			return httpResponse{}, false
		}
		found := false
		for _, asset := range consoleAssetNames() {
			if name == asset {
				found = true
				break
			}
		}
		if !found {
			return httpResponse{}, false
		}
		var err error
		body, err = serviceAssets.ReadFile("service/vendor/ofm/packages/standalone/web/" + name)
		if err != nil {
			return jsonHTTP(500, map[string]string{"error": "控制台资源不可用"}), true
		}
		if strings.HasSuffix(name, ".js") {
			// Adapt served bytes only. The original pinned vendor files remain intact.
			body = bytes.ReplaceAll(body, []byte(`"/assets/"`), []byte(`(new URL("./",import.meta.url).href)`))
			body = bytes.ReplaceAll(body, []byte(`href:"/"`), []byte(`href:"./app"`))
			for _, label := range consoleLabels {
				from, _ := json.Marshal(label[0])
				to, _ := json.Marshal(label[1])
				body = bytes.ReplaceAll(body, from, to)
			}
			for _, patch := range eacConsolePatches {
				body = bytes.ReplaceAll(body, []byte(patch[0]), []byte(patch[1]))
			}
			for _, patch := range engineConsolePatches {
				body = bytes.ReplaceAll(body, []byte(patch[0]), []byte(patch[1]))
			}
			headers.Set("Content-Type", "text/javascript; charset=utf-8")
		} else {
			headers.Set("Content-Type", "text/css; charset=utf-8")
		}
	}
	return httpResponse{StatusCode: 200, Headers: headers, Body: body}, true
}

func jsonHTTP(status int, value any) httpResponse {
	raw, _ := json.Marshal(value)
	return httpResponse{StatusCode: status, Headers: http.Header{"Content-Type": {"application/json; charset=utf-8"}, "Cache-Control": {"no-store"}, "X-Content-Type-Options": {"nosniff"}}, Body: raw}
}

type consoleProxyRequest struct {
	ID     string          `json:"id"`
	Path   string          `json:"path"`
	Method string          `json:"method"`
	Body   json.RawMessage `json:"body,omitempty"`
	Engine bool            `json:"engine,omitempty"`
}

var consoleAPIRoutes = map[string]bool{
	"GET /api/management/summary": true, "GET /api/management/stats": true,
	"POST /api/management/settings": true, "POST /api/management/models/refresh": true,
	"POST /api/management/models/test": true, "POST /api/management/channels/rpc": true,
	"GET /api/management/eac/status": true, "GET /api/management/eac/pool": true,
	"GET /api/management/eac/login/poll": true, "POST /api/management/eac/login/start": true,
	"POST /api/management/eac/login/cancel": true, "POST /api/management/eac/logout": true,
	"GET /api/management/disclaimer": true, "POST /api/management/disclaimer/ack": true,
	"GET /api/management/providers": true, "POST /api/management/providers/save": true,
	"POST /api/management/providers/remove": true, "POST /api/management/providers/test": true,
	"POST /api/management/providers/discover": true,
	"GET /api/management/library":             true, "POST /api/management/library/profiles/save": true,
	"POST /api/management/library/profiles/apply": true, "POST /api/management/library/profiles/remove": true,
	"POST /api/management/library/resources/save": true, "POST /api/management/library/resources/remove": true,
	"GET /api/management/routing": true, "POST /api/management/routing/save": true,
	"POST /api/management/routing/remove": true, "POST /api/management/routing/preview": true,
	"GET /api/management/workbench": true, "POST /api/management/workbench/clients/save": true,
	"POST /api/management/workbench/clients/launch": true, "POST /api/management/workbench/clients/stop": true,
	"GET /api/management/subscriptions": true, "GET /api/management/subscriptions/discover": true,
	"POST /api/management/subscriptions/import": true, "POST /api/management/subscriptions/import-local": true,
	"POST /api/management/subscriptions/enabled": true, "POST /api/management/subscriptions/remove": true,
	"POST /api/management/subscriptions/quota": true,
	"GET /api/management/engine/status":        true, "POST /api/management/engine/start": true,
	"POST /api/management/engine/refresh": true,
}

// The engine iframe has its own opaque origin and no cookie. Only these
// read/write routes are bridged; process, filesystem, plugin-install, archive
// and session controls stay unreachable from the browser.
var engineAPIRoutes = map[string]bool{
	"GET /api/state": true, "GET /api/providers": true, "GET /api/groups": true,
	"GET /api/settings": true, "GET /api/lanes": true, "GET /api/upstream": true,
	"POST /api/provider/arrange": true, "POST /api/provider/accountmodels": true,
	"POST /api/provider/list": true, "POST /api/provider/test": true,
	"POST /api/provider/models": true, "POST /api/provider/detect": true,
	"POST /api/provider/balance": true, "POST /api/provider/key": true,
	"POST /api/provider/unfetch": true, "POST /api/provider/move": true,
	"POST /api/provider/on": true, "POST /api/provider/off": true,
	"POST /api/provider/save": true, "POST /api/provider/delete": true,
}

// consoleLabels rewrites upstream Chinese copy that implies a local-only DSH
// installation, so the embedded console reads as a CPA-hosted view. Each
// source literal is also asserted against the pinned web bundle by tests.
var consoleLabels = [][2]string{
	{"LOCAL", "同源访问"}, {"WORKSPACE / OVERVIEW", "工作空间 / 概览"}, {"WORKSPACE / MODELS", "工作空间 / 模型"},
	{"WORKSPACE / USAGE", "工作空间 / 用量"}, {"MANAGEMENT / SETTINGS", "管理 / 设置"}, {"API BASE URL", "客户端接入地址"},
	{"CONNECT YOUR TOOLS", "连接你的客户端"}, {"OUR FREE MODEL / LOCAL CONSOLE", "免费模型 / 管理控制台"},
	{"本地模型工作台", "模型管理工作台"}, {"独立本地服务", "CPA 内部服务"}, {"本机", "CPA 服务器"},
	{"本机运行 / 仅监听回环地址", "当前 CPA 域名访问 / 内部回环运行"}, {"本地服务在线", "OFM 服务在线"},
	{"管理会话：本机独立会话", "管理鉴权：CPA 管理密钥"}, {"推理鉴权：Bearer API Key", "推理鉴权：CPA 客户端密钥"},
	{"监听范围：仅回环地址", "访问方式：当前 CPA 域名"}, {" 本地运行 · 由你掌控", " · 数据保存在 CPA 服务器 · 由你掌控"},
}

// These patches target the pinned upstream UI only at the served-byte boundary.
// Keep the original source hashes intact and fail tests if upstream hooks change.
var eacConsolePatches = [][2]string{
	// Login start: the pinned UI discards the cause and prints "unreachable".
	{`catch{E===f.current&&r(o("eac.startFailed").replace("{reason}","unreachable"))}`,
		`catch(error){E===f.current&&r(o("eac.startFailed").replace("{reason}",window.ofmEacFeedback.reason(error)))}`},
	// Logout: same blanket catch, same fix.
	{`catch{r(o("eac.startFailed").replace("{reason}","unreachable"))}finally{s(!1)}},cancel:async()=>{`,
		`catch(error){r(o("eac.startFailed").replace("{reason}",window.ofmEacFeedback.reason(error)))}finally{s(!1)}},cancel:async()=>{`},
	// Login start with a structured error object from the gateway.
	{`r(o("eac.startFailed").replace("{reason}",_.error))`,
		`r(o("eac.startFailed").replace("{reason}",window.ofmEacFeedback.reason(_.error)))`},
	// Polling: the pinned UI narrows every failure to a fixed vocabulary and
	// labels anything unrecognised as a network fault.
	{`const c=/\(([^)]+)\)\s*$/.exec(String(l?.message??""))?.[1]??"";n(c)`,
		`n(window.ofmEacFeedback.reason(l))`},
	// Login polling builds the same "unreachable" fallback, which is why a
	// source-preparation failure during polling used to read as a gateway
	// network fault. `not-writable` keeps its dedicated message.
	{`r(S==="not-writable"?H("eac.saveFailed"):H("eac.pollFailed").replace("{reason}",O))`,
		`r(S==="not-writable"?H("eac.saveFailed"):H("eac.pollFailed").replace("{reason}",window.ofmEacFeedback.reason(D)))`},
	// "No lane" is a composition state, not a network failure.
	{`if(t.available!==!0)return e("p",{className:"ofm_note"},a("eac.noLane"))`,
		`if(t.available!==!0)return e("p",{className:"ofm_note"},window.ofmEacFeedback.reason(t.reason||"no-lane"))`},
	// The EAC page must not paint the summary's stale authorization state before
	// its own query answers.
	{`function _n({summary:ee}){const[te,ae]=X.useState(ee.eacAuth)`,
		`function _n({summary:ee}){const[te,ae]=X.useState(void 0)`},
	// The pinned UI says importing "merges", but the service replaces the whole
	// account pool, model blacklist and permanent-lock table. Say what happens and
	// report how much was written, so an old backup cannot silently drop newer
	// accounts or lock settings.
	{`window.confirm("导入会合并备份中的账号凭据、模型开关和积分锁定设置，确认继续吗？")`,
		`window.confirm("导入会【整体替换】当前账号列表、模型开关和积分锁定设置（不是合并）。备份中缺少的账号与设置会被移除，建议先导出当前备份。确认继续吗？")`},
	// The shared action wrapper appends "已保存。" after every action, which
	// immediately overwrote the import summary. Let an action that reports its
	// own result (by resolving `true`) suppress that generic line.
	{`const V=async P=>{F(!0),q("");try{await P(),await pe(),window.dispatchEvent(new CustomEvent("ofm:channels")),ee.reload?.(),q("已保存。")}catch(Z){q(Z.message)}finally{F(!1)}}`,
		`const V=async P=>{F(!0),q("");try{const ofmResult=await P();await pe(),window.dispatchEvent(new CustomEvent("ofm:channels")),ee.reload?.(),ofmResult!==!0&&q("已保存。")}catch(Z){q(Z.message)}finally{F(!1)}}`},
	{`&&await V(async()=>{await Le("backup.import",{payload:JSON.parse(await Z.text())})})}};`,
		`&&await V(async()=>{const ofmResult=await Le("backup.import",{payload:JSON.parse(await Z.text())});const ofmAccounts=Number(ofmResult?.accountsImported??0),ofmCredentials=Number(ofmResult?.credentialsImported??0),ofmMissing=Number(ofmResult?.missingCredentials??0),ofmExpired=Number(ofmResult?.expiredAccounts??0),ofmMessage=["已整体替换：写入 "+ofmAccounts+" 个账号、"+ofmCredentials+" 条凭据。"];ofmMissing>0&&ofmMessage.push(ofmMissing+" 个账号缺少凭据，需重新登录。");ofmExpired>0&&ofmMessage.push(ofmExpired+" 个账号的凭据已过期，使用时可能自动续期。");ofmResult?.skipped?.length>0&&ofmMessage.push("跳过 "+ofmResult.skipped.length+" 条无效凭据。");q(ofmMessage.join(""));return!0})}};`},
}

// The model workspace is a sandboxed document inside the sandboxed console.
// Both frames have opaque origins, so the upstream engine's same-origin checks
// and contentDocument access cannot work. Keep the sandbox and bridge through
// window identity instead: only the parent console frame can relay requests.
var engineConsolePatches = [][2]string{
	{`c.current?.contentWindow?.postMessage({type:"ofm:engine-theme",variables:E,fontFamily:z.fontFamily,colorScheme:N==="dark"?"dark":"light",externalControls:!0},window.location.origin)`,
		`c.current?.contentWindow?.postMessage({type:"ofm:engine-theme",variables:E,fontFamily:z.fontFamily,colorScheme:N==="dark"?"dark":"light",externalControls:!0},"*")`},
	{`w=C=>c.current?.contentWindow?.postMessage({type:"ofm:engine-action",action:C},window.location.origin)`,
		`w=C=>c.current?.contentWindow?.postMessage({type:"ofm:engine-action",action:C},"*")`},
	{`z.origin!==window.location.origin||z.source!==c.current?.contentWindow||z.data?.type!=="ofm:engine-changed"`,
		`z.source!==c.current?.contentWindow||z.data?.type!=="ofm:engine-changed"`},
	{"src:`${Me}/engine/ui/?mode=window&view=providers`",
		"src:new URL(\"../engine?mode=window&view=providers\",location.href).href"},
	{`onLoad:C=>{d();const z=C.currentTarget.contentDocument;if(!z||z.getElementById("ofm-workspace-layout"))return;const E=z.createElement("style");E.id="ofm-workspace-layout",E.textContent=Lo,z.head.appendChild(E)}}`,
		`onLoad:()=>{d()}}`},
}

// Engine HTML comes from the upstream management server, which injects a
// <base> and a browser bridge for its own same-origin mount. Neither works in
// the sandboxed console. Remove that bridge and serve the CPA bridge and the
// workspace layout that used to be copied through contentDocument.
func adaptEngineHTML(body []byte) []byte {
	html := string(body)
	// Remove upstream's injected browserBridge script, but not the page's own
	// scripts. It is the first inline script after the injected <base>.
	if start := strings.Index(html, "<base "); start >= 0 {
		if closeBase := strings.Index(html[start:], ">"); closeBase >= 0 {
			baseEnd := start + closeBase + 1
			html = html[:start] + html[baseEnd:]
			if scriptStart := strings.Index(html[start:], "<script>"); scriptStart >= 0 {
				scriptStart += start
				if scriptEnd := strings.Index(html[scriptStart:], "</script>"); scriptEnd >= 0 {
					scriptEnd += scriptStart + len("</script>")
					html = html[:scriptStart] + html[scriptEnd:]
				}
			}
		}
	}
	injection := `<script src="./engine-bridge.js"></script><link rel="stylesheet" href="./engine-workspace.css">`
	if strings.Contains(html, "</head>") {
		html = strings.Replace(html, "</head>", injection+"</head>", 1)
	} else {
		html = injection + html
	}
	return rewriteEngineHTML([]byte(html))
}

func adaptEngineCSS(body []byte) []byte {
	return rewriteEngineCSS(body)
}

func engineResourcePath(request managementRequest) (string, bool) {
	if request.Method != "GET" || len(request.Path) > 2048 {
		return "", false
	}
	raw := "index.html"
	query := request.Query
	if query == nil {
		u, err := url.ParseRequestURI(request.Path)
		if err != nil {
			return "", false
		}
		switch {
		case u.Path == consoleResourceBase+"/engine", u.Path == consoleResourceBase+"/engine/":
			query, err = url.ParseQuery(u.RawQuery)
			if err != nil {
				return "", false
			}
		case strings.HasPrefix(u.Path, consoleResourceBase+"/engine/"):
			raw = strings.TrimPrefix(u.Path, consoleResourceBase+"/engine/")
			if u.RawQuery != "" {
				return "", false
			}
		default:
			return "", false
		}
	} else if request.Path != consoleResourceBase+"/engine" && request.Path != consoleResourceBase+"/engine/" {
		return "", false
	}
	for key, values := range query {
		if len(values) != 1 {
			return "", false
		}
		switch key {
		case "path":
			raw = values[0]
		case "mode":
			if values[0] != "window" && values[0] != "panel" {
				return "", false
			}
		case "view":
			if values[0] != "providers" {
				return "", false
			}
		default:
			return "", false
		}
	}
	if raw == "" || strings.ContainsAny(raw, "\\\r\n\x00#") || strings.Contains(raw, "//") {
		return "", false
	}
	decoded := raw
	for attempt := 0; attempt < 3; attempt++ {
		next, err := url.PathUnescape(decoded)
		if err != nil || next == decoded {
			break
		}
		decoded = next
	}
	if decoded != raw {
		return "", false
	}
	if !engineAssetPattern.MatchString(decoded) || path.Clean(decoded) != decoded ||
		strings.HasPrefix(decoded, ".") || strings.Contains(decoded, "/.") ||
		strings.HasPrefix(decoded, "api/") || strings.Contains(decoded, "/api/") {
		return "", false
	}
	return "/" + decoded, true
}

func validEngineSessionQuery(request managementRequest) bool {
	values, err := url.ParseQuery(strings.TrimPrefix(request.Path, consoleResourceBase+"/engine?"))
	if err != nil || request.Path == consoleResourceBase+"/engine" || !strings.HasPrefix(request.Path, consoleResourceBase+"/engine?") {
		return false
	}
	for key, list := range values {
		if len(list) != 1 {
			return false
		}
		switch key {
		case "mode":
			if list[0] != "window" && list[0] != "panel" {
				return false
			}
		case "view":
			if list[0] != "providers" {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func engineHTMLReference(name string) bool {
	return name != "" && engineAssetPattern.MatchString(name) && path.Clean(name) == name &&
		!strings.HasPrefix(name, ".") && !strings.Contains(name, "/.") &&
		!strings.HasPrefix(name, "api/") && !strings.Contains(name, "/api/")
}

func rewriteEngineHTML(html []byte) []byte {
	html = bytes.ReplaceAll(html, []byte(`./engine-bridge.js`), []byte(`cpa-engine-bridge`))
	html = bytes.ReplaceAll(html, []byte(`./engine-workspace.css`), []byte(`cpa-engine-workspace`))
	html = engineHTMLURLPattern.ReplaceAllFunc(html, func(match []byte) []byte {
		text := string(match)
		eq := strings.IndexByte(text, '=')
		if eq < 0 || len(text) < eq+3 {
			return match
		}
		quote := text[eq+1]
		if quote != '"' && quote != '\'' {
			return match
		}
		value := text[eq+2 : len(text)-1]
		name := strings.TrimPrefix(value, "./")
		if split := strings.IndexByte(name, '?'); split >= 0 {
			name = name[:split]
		}
		if !engineHTMLReference(name) {
			return match
		}
		attr := strings.ToLower(text[:eq])
		return []byte(attr + `="./engine?path=` + name + `"`)
	})
	html = bytes.ReplaceAll(html, []byte(`./engine?path=cpa-engine-bridge`), []byte(`./engine-bridge.js`))
	html = bytes.ReplaceAll(html, []byte(`./engine?path=cpa-engine-workspace`), []byte(`./engine-workspace.css`))
	return html
}

func rewriteEngineCSS(css []byte) []byte {
	return engineCSSURLPattern.ReplaceAllFunc(css, func(match []byte) []byte {
		text := string(match)
		start := strings.IndexByte(text, '(')
		end := strings.LastIndexByte(text, ')')
		if start < 0 || end <= start+1 {
			return match
		}
		value := strings.TrimSpace(text[start+1 : end])
		quote := byte(0)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			quote = value[0]
			value = value[1 : len(value)-1]
		}
		if strings.Contains(value, ":") || strings.HasPrefix(value, "//") || strings.ContainsAny(value, "?#\\\r\n\x00") {
			return match
		}
		name := strings.TrimPrefix(value, "./")
		if !engineHTMLReference(name) {
			return match
		}
		replacement := "url(./engine?path=" + name + ")"
		if quote != 0 {
			replacement = "url(" + string(quote) + "./engine?path=" + name + string(quote) + ")"
		}
		return []byte(replacement)
	})
}

func engineContentType(name string, raw string) (string, bool) {
	mediaType, _, err := mime.ParseMediaType(raw)
	if err != nil {
		return "", false
	}
	extension := strings.ToLower(path.Ext(name))
	switch mediaType {
	case "text/html":
		return "text/html; charset=utf-8", extension == ".html" || extension == ".htm"
	case "text/css":
		return "text/css; charset=utf-8", extension == ".css"
	case "text/javascript", "application/javascript":
		return "text/javascript; charset=utf-8", extension == ".js" || extension == ".mjs"
	case "image/svg+xml":
		return mediaType, extension == ".svg"
	case "image/png":
		return mediaType, extension == ".png"
	case "image/jpeg":
		return mediaType, extension == ".jpg" || extension == ".jpeg"
	case "image/gif":
		return mediaType, extension == ".gif"
	case "image/webp":
		return mediaType, extension == ".webp"
	case "image/avif":
		return mediaType, extension == ".avif"
	case "font/woff", "font/woff2", "font/ttf", "font/otf":
		expected := map[string]string{"font/woff": ".woff", "font/woff2": ".woff2", "font/ttf": ".ttf", "font/otf": ".otf"}[mediaType]
		return mediaType, extension == expected
	default:
		return "", false
	}
}

func (p *plugin) engineResource(request managementRequest) (httpResponse, bool) {
	name, ok := engineResourcePath(request)
	if !ok {
		return httpResponse{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, rt, err := p.begin()
	if err != nil {
		return jsonHTTP(503, map[string]string{"error": "engine unavailable"}), true
	}
	defer p.active.Done()
	var conn connection
	if err := rt.command("console-connection", nil, &conn); err != nil {
		return jsonHTTP(503, map[string]string{"error": "engine unavailable"}), true
	}
	if conn.Session == "" {
		return jsonHTTP(503, map[string]string{"error": "engine session unavailable"}), true
	}
	base, err := url.Parse(conn.Base)
	if err != nil || base.Scheme != "http" || base.Hostname() != "127.0.0.1" || base.Port() == "" ||
		base.User != nil || base.Path != "" || base.RawQuery != "" || base.Fragment != "" ||
		conn.Key == "" {
		return jsonHTTP(502, map[string]string{"error": "invalid engine service"}), true
	}
	target := conn.Base + "/api/management/engine/ui" + name
	if name == "/index.html" {
		target = conn.Base + "/api/management/engine/ui/"
	}
	if validEngineSessionQuery(request) {
		target += "?" + strings.TrimPrefix(request.Path, consoleResourceBase+"/engine?")
	}
	upstream, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return jsonHTTP(400, map[string]string{"error": "invalid engine resource"}), true
	}
	upstream.Header = http.Header{
		"Authorization": {"Bearer " + conn.Key}, "Cookie": {conn.Session},
		"Origin": {conn.Base}, "Referer": {conn.Base + "/"}, "Sec-Fetch-Site": {"same-origin"},
		"Accept-Encoding": {"identity"},
	}
	response, err := loopbackClient.Do(upstream)
	if err != nil {
		return jsonHTTP(502, map[string]string{"error": "engine resource failed"}), true
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 || response.Header.Get("Set-Cookie") != "" {
		return jsonHTTP(502, map[string]string{"error": "engine redirect or credential refused"}), true
	}
	if response.StatusCode != http.StatusOK {
		return jsonHTTP(502, map[string]string{"error": "engine resource unavailable"}), true
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
	if err != nil || len(raw) > 8*1024*1024 {
		return jsonHTTP(502, map[string]string{"error": "engine resource is too large"}), true
	}
	contentType, ok := engineContentType(name, response.Header.Get("Content-Type"))
	if !ok {
		return jsonHTTP(502, map[string]string{"error": "engine content type refused"}), true
	}
	if strings.HasPrefix(contentType, "text/html") {
		raw = adaptEngineHTML(raw)
	} else if strings.HasPrefix(contentType, "text/css") {
		raw = adaptEngineCSS(raw)
	}
	headers := http.Header{
		"Content-Type": {contentType}, "Cache-Control": {"no-store"}, "X-Content-Type-Options": {"nosniff"},
		"Content-Security-Policy": {"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"},
	}
	return httpResponse{StatusCode: 200, Headers: headers, Body: raw}, true
}

func validateConsoleRequest(request consoleProxyRequest) bool {
	if !consoleCallIDPattern.MatchString(request.ID) || len(request.Path) > 2048 {
		return false
	}
	u, err := url.ParseRequestURI(request.Path)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || u.RawPath != "" {
		return false
	}
	if !consoleAPIRoutes[request.Method+" "+u.Path] {
		return false
	}
	if len(request.Body) > maxInferenceBodyBytes {
		return false
	}
	if request.Method == "POST" && (len(bytes.TrimSpace(request.Body)) == 0 || bytes.TrimSpace(request.Body)[0] != '{' || !json.Valid(request.Body)) {
		return false
	}
	if request.Method == "GET" && len(request.Body) != 0 {
		return false
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for key, values := range query {
		if key != "link" || len(values) != 1 || len(values[0]) > 256 ||
			(u.Path != "/api/management/eac/login/poll" && u.Path != "/api/management/eac/login/cancel") {
			return false
		}
	}
	return true
}

func validateEngineRequest(request consoleProxyRequest) bool {
	if !consoleCallIDPattern.MatchString(request.ID) || len(request.Path) > 2048 {
		return false
	}
	if strings.ContainsAny(request.Path, "\\\r\n\x00") || strings.Contains(request.Path, "//") {
		return false
	}
	u, err := url.ParseRequestURI(request.Path)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || u.RawPath != "" {
		return false
	}
	clean := strings.TrimSuffix(u.Path, "/")
	if u.Path == "" || !engineAPIRoutes[request.Method+" "+clean] || len(request.Body) > maxInferenceBodyBytes {
		return false
	}
	if request.Method == "POST" {
		body := bytes.TrimSpace(request.Body)
		if len(body) == 0 || body[0] != '{' || !json.Valid(body) {
			return false
		}
	} else if len(request.Body) != 0 {
		return false
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for key, values := range query {
		if len(values) != 1 || len(key) > 64 || len(values[0]) > 512 ||
			strings.ContainsAny(key+values[0], "\r\n\x00") {
			return false
		}
	}
	return true
}

func (p *plugin) proxyConsole(rt controlRuntime, raw []byte) httpResponse {
	bad := func(status int, message string) httpResponse {
		return jsonHTTP(status, map[string]string{"error": message})
	}
	if len(raw) > maxInferenceBodyBytes+4096 {
		return bad(413, "请求内容超过 8 MiB 限制")
	}
	var request consoleProxyRequest
	if json.Unmarshal(raw, &request) != nil {
		return bad(400, "控制台请求格式错误")
	}
	if !request.Engine && (request.Path == "/api/management/key" || request.Path == "/api/management/key/rotate") {
		return bad(409, "远程访问请使用页面顶部的 CPA 地址及 CPA 客户端密钥，无需读取或轮换 OFM 内部密钥。")
	}
	if request.Engine && !validateEngineRequest(request) || !request.Engine && !validateConsoleRequest(request) {
		return bad(400, "不支持的控制台操作或路径")
	}
	if request.Engine {
		request.Path = strings.TrimSuffix(request.Path, "/")
		if request.Path == "" || request.Path == "/api" {
			return bad(400, "不支持的控制台操作或路径")
		}
	}
	eacPath := !request.Engine && strings.HasPrefix(request.Path, "/api/management/eac/")
	if eacPath {
		var state struct {
			Source struct {
				State string `json:"state"`
			} `json:"eacSource"`
		}
		if err := rt.command("status", nil, &state); err != nil {
			return bad(503, "eac-loading")
		}
		reason := map[string]string{
			"disabled": "eac-disabled", "loading": "eac-loading",
			"failed": "eac-source-failed", "unavailable": "eac-unavailable",
		}[state.Source.State]
		// Logout/cancel must remain usable for existing local authorization.
		if reason != "" && request.Path != "/api/management/eac/logout" &&
			!strings.HasPrefix(request.Path, "/api/management/eac/login/cancel") {
			if request.Path == "/api/management/eac/status" {
				return jsonHTTP(200, map[string]any{"available": false, "authorized": false, "login": "", "reason": reason, "sourceState": state.Source.State})
			}
			return bad(503, reason)
		}
	}
	if !request.Engine && request.Path == "/api/management/models/test" {
		var body map[string]json.RawMessage
		_ = json.Unmarshal(request.Body, &body)
		var model string
		_ = json.Unmarshal(body["model"], &model)
		p.mu.Lock()
		prefix := p.config.ModelPrefix
		p.mu.Unlock()
		if prefix != "" && strings.HasPrefix(model, prefix) {
			body["model"], _ = json.Marshal(strings.TrimPrefix(model, prefix))
			request.Body, _ = json.Marshal(body)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	p.mu.Lock()
	if !p.accepting || len(p.consoleCalls) >= 32 || p.consoleCalls[request.ID] != nil {
		p.mu.Unlock()
		cancel()
		return bad(429, "控制台正在停止或请求过多，请稍后重试")
	}
	p.consoleCalls[request.ID] = cancel
	p.mu.Unlock()
	defer func() { cancel(); p.mu.Lock(); delete(p.consoleCalls, request.ID); p.mu.Unlock() }()
	var conn connection
	if err := rt.command("console-connection", nil, &conn); err != nil {
		return bad(503, "无法连接 OFM 内部服务，请检查插件状态")
	}
	u, err := url.Parse(conn.Base)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" || conn.Key == "" {
		return bad(502, "OFM 内部服务地址不合法")
	}
	upstream, err := http.NewRequestWithContext(ctx, request.Method, conn.Base+request.Path, bytes.NewReader(request.Body))
	if err != nil {
		return bad(400, "无效的控制台请求")
	}
	// The caller's management key, cookies and forwarding headers never cross this hop.
	headers := http.Header{"Authorization": {"Bearer " + conn.Key}, "Content-Type": {"application/json"}, "Origin": {conn.Base}, "Sec-Fetch-Site": {"same-origin"}}
	if conn.Session != "" {
		headers.Set("Cookie", conn.Session)
	}
	if request.Engine {
		headers.Set("Referer", conn.Base+"/")
		headers.Set("Accept-Encoding", "identity")
	}
	upstream.Header = headers
	response, err := loopbackClient.Do(upstream)
	if err != nil {
		return bad(502, "控制台请求失败、超时或已取消")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 16*1024*1024+1))
	if err != nil || len(body) > 16*1024*1024 || response.StatusCode != http.StatusNoContent && !json.Valid(body) {
		return bad(502, "控制台返回了无效或过大的响应")
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return bad(502, "控制台不允许重定向到其他地址")
	}
	if !request.Engine && request.Path == "/api/management/channels/rpc" {
		var action struct {
			Method string `json:"method"`
		}
		_ = json.Unmarshal(request.Body, &action)
		if action.Method == "gateway.getEnabled" || action.Method == "gateway.setEnabled" {
			var result map[string]any
			if json.Unmarshal(body, &result) == nil {
				if value, ok := result["value"].(map[string]any); ok {
					value["apiKey"] = map[string]any{"value": "", "path": "由 CPA 管理，不向浏览器提供内部密钥", "fromEnv": true}
					body, _ = json.Marshal(result)
				}
			}
		}
	}
	headers = jsonHTTP(200, nil).Headers
	if request.Engine {
		for _, name := range []string{"Retry-After", "X-Magpie-Reading", "X-Request-ID"} {
			if value := response.Header.Get(name); value != "" {
				headers.Set(name, value)
			}
		}
	}
	return httpResponse{StatusCode: response.StatusCode, Headers: headers, Body: body}
}
